const { google } = require('googleapis');

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function formatPerson(person) {
  return {
    resourceName: person.resourceName,
    name: person.names?.[0]?.displayName || '',
    emails: (person.emailAddresses || []).map((e) => e.value),
    phones: (person.phoneNumbers || []).map((p) => p.value),
    company: person.organizations?.[0]?.name || null,
    notes: person.biographies?.[0]?.value || null
  };
}

// Busca un contacto por nombre en la libreta completa. Devuelve resourceName o lanza error.
async function resolveContact(people, query) {
  const q = normalize(query);
  const response = await people.people.connections.list({
    resourceName: 'people/me',
    personFields: 'names,emailAddresses,phoneNumbers,organizations',
    pageSize: 500
  });

  const matches = (response.data.connections || []).filter((p) => {
    const name = normalize(p.names?.[0]?.displayName || '');
    const emails = (p.emailAddresses || []).map((e) => normalize(e.value)).join(' ');
    return (name + ' ' + emails).includes(q);
  });

  if (matches.length === 0) throw new Error(`CONTACT_NOT_FOUND: ${query}`);
  if (matches.length > 1) {
    const names = matches.slice(0, 5).map((p) => p.names?.[0]?.displayName).join(', ');
    throw new Error(`CONTACT_AMBIGUOUS: encontré ${matches.length} contactos para "${query}": ${names}. Sé más específico.`);
  }
  return matches[0].resourceName;
}

function createGoogleContactsTools({ authFactory }) {
  async function searchContacts(input = {}) {
    const query = normalize(input.query || '');
    if (!query) throw new Error('CONTACT_QUERY_REQUIRED');

    const auth = authFactory.getClient();
    const people = google.people({ version: 'v1', auth });
    const response = await people.people.connections.list({
      resourceName: 'people/me',
      personFields: 'names,emailAddresses,phoneNumbers,organizations',
      pageSize: Math.min(Number(input.pageSize || 200), 500)
    });

    const matches = (response.data.connections || []).filter((person) => {
      const haystack = normalize([
        person.names?.[0]?.displayName || '',
        ...(person.emailAddresses || []).map((e) => e.value),
        ...(person.phoneNumbers || []).map((p) => p.value),
        person.organizations?.[0]?.name || ''
      ].join(' '));
      return haystack.includes(query);
    });

    return { matches: matches.map(formatPerson) };
  }

  async function createContact(input = {}) {
    if (!input.name) throw new Error('CONTACT_NAME_REQUIRED');
    const auth = authFactory.getClient();
    const people = google.people({ version: 'v1', auth });

    const nameParts = String(input.name).trim().split(/\s+/);
    const resource = {
      names: [{
        givenName: nameParts[0] || input.name,
        familyName: nameParts.slice(1).join(' ') || '',
        displayName: input.name
      }]
    };

    const emails = [].concat(input.email || input.emails || []).filter(Boolean);
    if (emails.length) resource.emailAddresses = emails.map((v) => ({ value: v }));

    const phones = [].concat(input.phone || input.phones || []).filter(Boolean);
    if (phones.length) resource.phoneNumbers = phones.map((v) => ({ value: v }));

    if (input.company || input.organization) {
      resource.organizations = [{ name: input.company || input.organization }];
    }

    if (input.notes) {
      resource.biographies = [{ value: input.notes, contentType: 'TEXT_PLAIN' }];
    }

    const response = await people.people.createContact({ requestBody: resource });
    return formatPerson(response.data);
  }

  async function updateContact(input = {}) {
    if (!input.name && !input.resourceName) throw new Error('CONTACT_NAME_OR_RESOURCE_NAME_REQUIRED');
    const auth = authFactory.getClient();
    const people = google.people({ version: 'v1', auth });

    const resourceName = input.resourceName || await resolveContact(people, input.name);

    // Leer el contacto actual para hacer merge de campos
    const current = await people.people.get({ resourceName, personFields: 'names,emailAddresses,phoneNumbers,organizations,biographies,metadata' });
    const etag = current.data.etag;

    const resource = {
      etag,
      names: current.data.names || []
    };

    if (input.newName) {
      const parts = String(input.newName).trim().split(/\s+/);
      resource.names = [{ givenName: parts[0], familyName: parts.slice(1).join(' '), displayName: input.newName }];
    }

    const emails = [].concat(input.email || input.emails || []).filter(Boolean);
    resource.emailAddresses = emails.length
      ? emails.map((v) => ({ value: v }))
      : (current.data.emailAddresses || []);

    const phones = [].concat(input.phone || input.phones || []).filter(Boolean);
    resource.phoneNumbers = phones.length
      ? phones.map((v) => ({ value: v }))
      : (current.data.phoneNumbers || []);

    if (input.company !== undefined || input.organization !== undefined) {
      resource.organizations = [{ name: input.company || input.organization || '' }];
    } else {
      resource.organizations = current.data.organizations || [];
    }

    if (input.notes !== undefined) {
      resource.biographies = [{ value: input.notes, contentType: 'TEXT_PLAIN' }];
    } else {
      resource.biographies = current.data.biographies || [];
    }

    const updatePersonFields = ['names', 'emailAddresses', 'phoneNumbers', 'organizations', 'biographies'].join(',');
    const response = await people.people.updateContact({ resourceName, updatePersonFields, requestBody: resource });
    return formatPerson(response.data);
  }

  async function deleteContact(input = {}) {
    if (!input.name && !input.resourceName) throw new Error('CONTACT_NAME_OR_RESOURCE_NAME_REQUIRED');
    const auth = authFactory.getClient();
    const people = google.people({ version: 'v1', auth });

    const resourceName = input.resourceName || await resolveContact(people, input.name);
    await people.people.deleteContact({ resourceName });
    return { ok: true, deleted: resourceName };
  }

  return [
    {
      name: 'google.contacts.search',
      description: 'Buscar contactos de Google por nombre, email o teléfono.',
      risk: 'medium',
      permissions: ['google:contacts:read'],
      required: ['query'],
      aliases: { query: ['q', 'name', 'nombre', 'contact', 'contacto', 'search'] },
      execute: searchContacts
    },
    {
      name: 'google.contacts.create',
      description: 'Crear un contacto nuevo en Google Contacts. Input: { name (requerido), email?, phone?, company?, notes? }. Devuelve el contacto creado con su resourceName.',
      risk: 'medium',
      permissions: ['google:contacts:write'],
      required: ['name'],
      aliases: {
        name: ['nombre', 'displayName', 'display_name'],
        email: ['correo', 'emails', 'mail'],
        phone: ['telefono', 'teléfono', 'phones', 'cel'],
        company: ['empresa', 'organization', 'organización'],
        notes: ['notas', 'notes', 'observaciones']
      },
      execute: createContact
    },
    {
      name: 'google.contacts.update',
      description: 'Actualizar datos de un contacto existente. Input: { name: "nombre actual para buscarlo" } más cualquiera de { newName, email, phone, company, notes }. Los campos que no se pasan mantienen su valor actual.',
      risk: 'medium',
      permissions: ['google:contacts:write'],
      aliases: {
        name: ['nombre', 'contact', 'contacto'],
        resourceName: ['resource_name', 'id'],
        newName: ['new_name', 'nuevo_nombre'],
        email: ['correo', 'emails', 'mail'],
        phone: ['telefono', 'teléfono', 'phones'],
        company: ['empresa', 'organization'],
        notes: ['notas', 'observaciones']
      },
      execute: updateContact
    },
    {
      name: 'google.contacts.delete',
      description: 'Eliminar un contacto de Google Contacts. Input: { name: "nombre del contacto" }. Si hay ambigüedad se solicita más precisión antes de borrar.',
      risk: 'high',
      permissions: ['google:contacts:write'],
      aliases: {
        name: ['nombre', 'contact', 'contacto'],
        resourceName: ['resource_name', 'id']
      },
      execute: deleteContact
    }
  ];
}

module.exports = { createGoogleContactsTools };
