# Voice Experience - Jarvis Codex

## Objetivo

Jarvis debe sentirse vivo: escuchar, responder, avisar progreso y cerrar tareas.

## Modos

- Boton de hablar.
- Manos libres.
- Push-to-talk.
- Modo silencioso.
- Modo solo texto.
- Modo notificaciones.

## Flujo de Voz

1. Usuario habla.
2. Jarvis transcribe.
3. Confirma recepcion si la tarea no es instantanea.
4. Ejecuta.
5. Reporta progreso si demora.
6. Avisa resultado final.
7. Pregunta seguimiento si corresponde.

## Tareas Largas

Jarvis no debe quedarse callado cuando una tarea tiene multiples pasos. Debe emitir eventos de estado aunque la accion ocurra en segundo plano.

Ejemplo de una auditoria SEO:

- Recepcion: confirma que entendio.
- Inicio: avisa que empezo a revisar.
- Progreso: informa cuando captura informacion clave.
- Artefacto: avisa si creo un documento.
- Cierre: resume hallazgos y deja claro donde esta el resultado.
- Seguimiento: pregunta si el usuario quiere que ejecute mejoras.

## Reglas

- No hablar de mas.
- No quedarse mudo en tareas largas.
- Permitir interrupcion.
- No leer listas largas en voz.
- Usar voz para resumen, estado y cierre.
- Usar pantalla para detalles.

## Eventos que deben poder hablar

- `task_started`
- `task_progress`
- `task_needs_confirmation`
- `artifact_created`
- `task_completed`
- `task_failed`
- `task_waiting_external_service`
- `task_resumed`
- `task_synced`

## Ejemplo

Usuario: "Audita el SEO de biocrom.cl"

Jarvis:

- "Entendido. Revisare el sitio y preparare un informe."
- "Ya capture la pagina principal. Estoy revisando estructura y metadatos."
- "Auditoria completada. Cree el informe y deje el resumen en pantalla."
