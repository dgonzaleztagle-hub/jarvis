# Auditoria de memoria Jarvis 1.0

Fecha: 2026-06-01

## Veredicto corto

El modelo de memoria de Jarvis 1.0 estaba bien encaminado y tiene ideas que conviene conservar. No era una memoria plana: tenia un indice cerebral, nodos especializados, conexiones entre entidades y un extractor de hechos en segundo plano. Conceptualmente es mas cercano a una memoria viva que el modelo inicial de Jarvis Codex.

La decision correcta no es copiarlo tal cual, sino portarlo con gobierno: estados, evidencia, sensibilidad, revision y confirmacion.

## Lo que estaba muy bien

### Indice cerebral

Jarvis 1.0 usa un `brain_index.json` con nodos, etiquetas, resumenes y conexiones. Esto permite consultar memoria sin cargar todo el historial.

Este enfoque es clave para Jarvis Codex porque evita gastar tokens y permite que la memoria crezca localmente sin contaminar cada prompt.

### Recuperacion quirurgica

`retrieveMemoryContext(message)` normaliza el texto, busca coincidencias contra etiquetas/resumenes/sinapsis y carga solo los archivos de memoria relevantes.

Esto coincide con la vision del producto: usar menos modelo externo a medida que el conocimiento local mejora.

### Memoria por nodos

`writeMemory(targetMemory)` crea archivos separados por nodo y actualiza el indice. Esto escala mejor que guardar todo en una sola memoria enorme.

### Extractor asincrono de hechos

`facts-extractor.js` procesa `userMessage` + `assistantResponse` y extrae:

- entidades
- hechos
- relaciones
- compromisos

Esto es exactamente el tipo de aprendizaje que Jarvis necesita: no esperar que el usuario diga "guarda esto", sino detectar conocimiento reusable.

### Filtro de basura

El extractor incluye reglas para ignorar contenido trivial, promocional o spam. Esto es especialmente importante para correos, navegacion web e investigacion inicial por nicho.

### Relaciones

El sistema intenta conectar entidades entre si. Ejemplo: una persona, un correo y una relacion como esposa/cliente/proveedor.

Este punto es importante porque el usuario no quiere solo recordar datos, quiere que Jarvis entienda contexto.

### Compromisos

El extractor detecta compromisos y los conecta con un motor de accountability. Esto es valioso para agenda, seguimiento, reuniones, pendientes y promesas hechas por el usuario.

## Lo que no conviene copiar sin cambios

### Veracidad demasiado rapida

Jarvis 1.0 puede escribir hechos extraidos como si fueran memoria valida. Para Jarvis Codex, todo hecho nuevo debe tener estado:

- `candidate`
- `verified`
- `conflicting`
- `low_confidence`
- `sensitive`
- `rejected`
- `obsolete`

Ejemplo: si el usuario dice "mi esposa es X y su correo es Y", Jarvis puede guardarlo como candidato fuerte, pero debe saber que usarlo para enviar correos sigue requiriendo confirmacion.

### Falta evidencia persistente

El indice antiguo guarda resumenes y conexiones, pero no siempre conserva suficiente evidencia: de donde salio el dato, en que conversacion, con que confianza, si fue inferido o declarado.

Jarvis Codex debe guardar:

- fuente
- fecha
- texto o referencia que justifica el dato
- confianza
- si fue declarado por el usuario, inferido por el modelo o importado desde una herramienta

### Busqueda semantica limitada

La recuperacion por keywords es util y barata, pero puede fallar con sinonimos o contexto. Debe mantenerse como base por costo, pero quedar preparada para agregar embeddings locales o busqueda vectorial despues.

### Conexiones con poca semantica

Las conexiones existen, pero necesitamos que cada borde tenga tipo, direccion, confianza y evidencia.

Ejemplo:

```json
{
  "from": "user",
  "to": "contact:persona_x",
  "type": "spouse",
  "confidence": 0.96,
  "evidence": "El usuario dijo: mi esposa..."
}
```

### Sin panel de revision

Una memoria viva necesita una forma de revisar, corregir y olvidar. Esto no debe ser parte visible del HUD principal, pero si debe existir como herramienta de administracion.

### Riesgo en compromisos automaticos

Detectar compromisos es bueno; ejecutar acciones por compromisos extraidos requiere politica. Jarvis puede proponer seguimiento, pero no debe crear acciones sensibles sin confirmacion.

## Modelo recomendado para Jarvis Codex

Jarvis Codex debe fusionar lo mejor de Jarvis 1.0 con el modelo seguro actual.

### 1. Memory Graph Index

Un indice local que contenga solo lo necesario para recuperar memoria:

- id
- tipo
- nombre legible
- resumen
- etiquetas
- conexiones
- estado
- sensibilidad
- confianza
- fecha de ultima actualizacion

### 2. Memory Nodes

Cada nodo vive en su propio archivo local, con contenido completo y evidencia.

Tipos iniciales:

- `person`
- `organization`
- `project`
- `preference`
- `credential_ref`
- `business_context`
- `task_pattern`
- `tool_pattern`
- `domain_knowledge`
- `commitment`

### 3. Fact Extractor Backjob

Despues de cada conversacion o herramienta importante, Jarvis ejecuta una extraccion:

- que aprendio
- si es reusable
- si es sensible
- si contradice algo anterior
- si debe guardarse como candidato o verificado

### 4. Curated Write

Por defecto, lo aprendido entra como `candidate`. Puede pasar a `verified` si:

- el usuario lo declaro explicitamente
- fue confirmado en una accion
- fue usado exitosamente varias veces
- viene de una fuente autorizada por el usuario

### 5. Retrieval antes de razonar

Antes de responder o ejecutar, Jarvis debe buscar memoria relevante y pasar al modelo solo el contexto necesario.

Debe distinguir claramente:

- memoria verificada
- memoria candidata
- memoria conflictiva
- memoria sensible

### 6. Contactos y acciones externas

Si Jarvis aprende el correo de una persona importante, puede usarlo como sugerencia futura.

Pero si la accion es externa, como enviar correo, modificar calendario, publicar, borrar o comprar, debe mostrar confirmacion con el payload exacto.

### 7. Limpieza de basura

El filtro anti-basura de Jarvis 1.0 debe conservarse y reforzarse:

- no guardar promociones
- no guardar snippets truncados como conocimiento
- no guardar ruido de emails
- no guardar inferencias fragiles como verdad
- no mezclar conocimiento medico/legal/financiero sin fuentes fuertes

## Decision de producto

La memoria de Jarvis Codex no debe ser solo una base de datos. Debe ser un sistema de aprendizaje local con:

- indice
- nodos
- relaciones
- evidencia
- estados
- recuperacion economica
- revision
- olvido

Jarvis 1.0 ya tenia una intuicion correcta. Jarvis Codex debe convertir esa intuicion en una arquitectura confiable.

