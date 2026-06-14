# Jarvis Codex

Runtime local-first para construir Jarvis como asistente operativo, con memoria, herramientas gobernadas, tareas, eventos, conectores y canales.

## Ejecutar

```powershell
npm install
npm start
```

URL local:

```text
http://127.0.0.1:3417/
```

## Probar

```powershell
npm test
```

## Estado Actual

- Core runtime local.
- Event bus.
- Task runtime.
- Tool registry.
- Policy engine.
- Memory store con estados.
- Credential vault local.
- Importador de credenciales heredadas.
- Gemini provider.
- Google Calendar.
- Google Docs.
- ElevenLabs voice tool.
- Telegram channel.
- HUD minimo.
- Evaluador de calidad de fuentes.

## Endpoints Principales

- `GET /`
- `GET /health`
- `GET /events`
- `GET /events/stream`
- `GET /logs`
- `GET /tools`
- `GET /tasks`
- `GET /tasks/:id`
- `POST /tasks/tool`
- `POST /tasks/:id/confirm`
- `POST /chat`
- `GET /memory`
- `POST /memory`
- `POST /memory/:id/state`
- `GET /vault`
- `POST /vault/import-legacy`
- `GET /channels/telegram/status`
- `POST /channels/telegram/start`
- `POST /channels/telegram/stop`

## Nota de Seguridad

Los secretos deben vivir en `local_data/vault`. Durante la migracion, el runtime puede usar el `.env` heredado de `jarvis-companion` como fallback, pero la direccion correcta es operar desde vault.
