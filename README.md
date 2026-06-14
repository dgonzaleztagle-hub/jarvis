# Jarvis Codex

Runtime local-first para Jarvis: asistente operativo con memoria, herramientas gobernadas,
agentes automáticos, voz, HUD y canales (Telegram, WhatsApp).

La fuente de verdad del producto (visión, roadmap, decisiones) es **[PRD.md](PRD.md)**.
Los documentos en `docs/` son referencia técnica puntual enlazada desde el PRD;
`docs/archive/` guarda auditorías e hitos históricos ya superados.

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

## Estado actual (resumen)

- **Runtime core**: event bus, task runtime, tool registry, policy engine, memory store
  (estados candidate/verified/...), credential vault local.
- **HUD**: Vader 3D (Three.js), paneles de workspace/actividad/agentes, dock de comandos,
  artefactos modulares, briefing matutino.
- **Modelo**: BYOK — Anthropic (Haiku por defecto) o Gemini.
- **Google Workspace**: Gmail, Calendar, Docs, Contacts, Sheets, Tasks.
- **Voz**: ElevenLabs / Edge TTS, STT (Gemini), espejo de voz en Telegram.
- **Canales**: Telegram (con espejo de voz), WhatsApp personal (Baileys, QR).
- **Agentes automáticos**: recetas declarativas (`agents.*`) con scheduler, presupuesto
  diario, panel HUD y validación automática al crear (corre la misión una vez y,
  si falla por la propia misión, puede corregirla con `agents.update_goal`).
- **Conexiones MCP**: clientes a dashboards externos vía `connections.*` (genérico,
  sin conectores a medida por cliente).
- **Investigación**: evaluador de calidad de fuentes, web fetch.
- **Visión**: lectura de QR/imágenes.

## Endpoints principales

- `GET /` — HUD
- `GET /health`, `GET /state`, `GET /events`, `GET /events/stream`, `GET /logs`
- `GET /tools`, `GET /tasks`, `GET /tasks/:id`, `POST /tasks/tool`, `POST /tasks/:id/confirm`
- `POST /chat`
- `GET /memory`, `POST /memory`, `POST /memory/:id/state`
- `GET /vault`, `POST /vault/import-legacy`
- `GET /auth/google`, `GET /auth/google/status`, `POST /auth/google/disconnect`
- `GET /calendar/today`, `GET /emails/digest`, `GET /morning-briefing`
- `GET/POST /voice/*`, `GET /config/voice`
- `GET /agents`, `POST /agents/run`, `POST /agents/toggle`, `POST /agents/delete`, `GET /agents/notifications`
- `GET/POST /channels/telegram/*`
- `GET /youtube/search`, `GET /model/usage`, `GET /trust-mode`

## Nota de seguridad

Los secretos viven en `local_data/vault` (gitignored). No se commitean credenciales
ni `.env` de clientes — las integraciones de negocio se conectan vía MCP
(`connections.*`), nunca con conectores a medida en este repo.
