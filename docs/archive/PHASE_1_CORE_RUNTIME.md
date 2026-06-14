# Fase 1 - Jarvis Core Local Runtime

## Objetivo

Crear una base nueva, local-first, separada del prototipo `jarvis-companion`, donde Jarvis Codex pueda crecer sin heredar el acoplamiento del laboratorio inicial.

## Estado Inicial

Se creo un runtime minimo en `C:\proyectos\jarvis-codex` con:

- Event bus.
- Task runtime.
- Tool registry.
- Policy engine.
- Memory store v1.
- Credential vault v0.
- Gemini provider wrapper.
- Servidor HTTP local basico.
- Tests con `node:test`.
- Google Calendar como primer conector migrado desde el prototipo.
- Google Docs, Gmail y Contacts como conectores gobernados.
- Gemini como modelo externo gobernado.
- Voz ElevenLabs como herramienta aislada.
- Flujo conversacional minimo con cierre post-herramienta.
- Telegram como canal migrado con continuidad de credenciales.
- Importador de credenciales heredadas al Credential Vault.
- HUD minimo servido desde el runtime local.
- Evaluador local de calidad de fuentes.
- Presenter registry inicial para respuestas deterministicas por dominio.

## Principio de Construccion

El prototipo viejo demuestra capacidades. El runtime nuevo define contratos.

Cada capacidad futura debe entrar por:

1. Tool registry.
2. Policy engine.
3. Task runtime.
4. Event bus.
5. Logs/auditoria.

## Endpoints Iniciales

- `GET /health`
- `GET /events`
- `GET /events/stream`
- `GET /tools`
- `GET /tasks`
- `GET /tasks/:id`
- `POST /tasks/tool`
- `POST /tasks/:id/confirm`
- `POST /chat`
- `GET /memory`
- `POST /memory`
- `GET /vault`
- `GET /channels/telegram/status`
- `POST /channels/telegram/start`
- `POST /channels/telegram/stop`
- `GET /`
- `GET /public/*`

## Siguiente Paso

Preparar canales y experiencia.

Recomendacion:

1. Crear puente HUD minimo para consumir `/chat`, `/events/stream`, `/tasks`.
2. Migrar Google Docs/Drive como siguiente conector.
3. Agregar Credential Vault migration para sacar secretos de archivos planos.
4. Diseñar panel de confirmaciones para tareas `waiting_confirmation`.

Calendar debe ser primero porque agenda es columna vertebral del producto.

## Verificacion Real

Estado verificado:

- `npm test`: 11 tests pasando.
- `GET /tools`: muestra herramientas base, Google Calendar, Gemini y voz.
- `google.calendar.list_events`: ejecutado con credenciales heredadas del prototipo, tarea completada.
- `google.calendar.create_event`: queda en `waiting_confirmation` por riesgo alto; no crea eventos sin confirmacion.
- `/chat`: conversa usando Gemini real desde el runtime nuevo.
- Cierre post-herramienta: Jarvis vuelve a responder con resultado final despues de ejecutar Calendar.
- Confirmacion de tareas: una tarea `waiting_confirmation` puede reanudarse con `POST /tasks/:id/confirm`.
- `voice.speak`: testeado con provider inyectado para no gastar ElevenLabs en pruebas.
- Telegram: detecta credenciales heredadas, queda apagado por defecto y filtra usuario autorizado.
- Eventos en vivo: `/events/stream` expone eventos SSE para HUD/canales.
- Credential Vault: importacion real de 10 credenciales heredadas sin exponer valores.
- Providers: Gemini, Google, ElevenLabs y Telegram prefieren vault y usan `.env` heredado solo como fallback.
- HUD minimo: carga HTML, consume herramientas, tareas, eventos y chat.
- Research: `research.evaluate_source` evalua autoridad, vigencia, dominio y sensibilidad antes de memoria.
- Google Workspace: Calendar, Docs, Gmail y Contacts registrados con permisos/riesgos.
- Presenters: Google Calendar, Gmail y Contacts salen de `ConversationRuntime` hacia `PresenterRegistry`.

## Flujo Conversacional Actual

El flujo minimo ya no replica el executor monolitico anterior. Ahora opera asi:

1. Usuario envia mensaje.
2. Gemini decide respuesta y tool calls.
3. Task runtime crea eventos.
4. Tool registry ejecuta herramientas permitidas.
5. Policy engine bloquea o pide confirmacion si corresponde.
6. Gemini genera cierre final usando resultados reales.
7. El canal recibe `speak`, `visual` y `toolResults`.

Esto resuelve una falla importante del prototipo anterior: Jarvis ya no debe quedarse callado despues de terminar una accion.

## Continuidad de Credenciales

Durante la migracion inicial, Jarvis Codex puede leer la configuracion heredada de `jarvis-companion` para no romper el Jarvis ya conectado.

Esto aplica especialmente a:

- Google OAuth.
- Telegram bot token.
- Telegram allowed user.
- Gemini API key.

La meta final no es depender de archivos planos, sino migrar esos secretos al Credential Vault local.
