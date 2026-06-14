const { google } = require('googleapis');

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function createGoogleContactsTools({ authFactory }) {
  async function searchContacts(input = {}) {
    const query = normalize(input.query || '');
    if (!query) throw new Error('CONTACT_QUERY_REQUIRED');

    const auth = authFactory.getClient();
    const people = google.people({ version: 'v1', auth });
    const response = await people.people.connections.list({
      resourceName: 'people/me',
      personFields: 'names,emailAddresses,phoneNumbers',
      pageSize: Math.min(Number(input.pageSize || 200), 500)
    });

    const matches = [];
    for (const person of response.data.connections || []) {
      const name = person.names?.[0]?.displayName || '';
      const haystack = normalize([
        name,
        ...(person.emailAddresses || []).map((email) => email.value),
        ...(person.phoneNumbers || []).map((phone) => phone.value)
      ].join(' '));

      if (haystack.includes(query)) {
        matches.push({
          name,
          emails: (person.emailAddresses || []).map((email) => email.value),
          phones: (person.phoneNumbers || []).map((phone) => phone.value)
        });
      }
    }

    return { matches };
  }

  return [
    {
      name: 'google.contacts.search',
      description: 'Search Google Contacts by name, email or phone.',
      risk: 'medium',
      permissions: ['google:contacts:read'],
      required: ['query'],
      aliases: {
        query: ['q', 'name', 'nombre', 'contact', 'contacto', 'search']
      },
      execute: searchContacts
    }
  ];
}

module.exports = {
  createGoogleContactsTools
};
