# Fase 0 - Auditoria del Prototipo Actual

## Alcance

Auditoria inicial del proyecto existente en `C:\proyectos\jarvis-companion` para decidir que piezas pueden alimentar Jarvis Codex y que partes conviene reconstruir como arquitectura definitiva.

## Diagnostico General

El prototipo actual es funcional como laboratorio local. Tiene muchas capacidades reales ya conectadas, especialmente:

- Chat central con Gemini.
- Fallback de modelos Gemini.
- Voz con ElevenLabs.
- Google Calendar, Gmail, Drive/Docs y Contacts.
- Memoria local en archivos JSON.
- HUD web local.
- Agentes autonomos basicos.
- Automatizacion web con Puppeteer.
- Automatizacion de escritorio y OCR.
- Telegram.
- Manejo de archivos.
- Control basico de PC.
- Confirmaciones para algunas acciones peligrosas.

La conclusion es clara: no es un proyecto descartable. Hay material valioso. Pero no debe convertirse directamente en la base definitiva sin una separacion fuerte de responsabilidades.

## Problema Principal

La mayor deuda no es que falten capacidades. La mayor deuda es que las capacidades estan acopladas alrededor de un servidor monolitico y prompts grandes.

Hoy el flujo dominante es:

1. El usuario habla o escribe.
2. Se arma un prompt grande con capacidades.
3. Gemini responde JSON.
4. El servidor ejecuta acciones segun `action`.
5. El HUD muestra resultado.

Esto funciona para prototipo, pero para Jarvis Codex necesitamos:

- Tool registry formal.
- Contratos de herramientas.
- Policy engine independiente.
- Task runtime persistente.
- Eventos de progreso.
- Memoria con estados y confianza.
- Vault cifrado.
- Separacion clara entre UI, cerebro, herramientas y datos.

## Hallazgos Tecnicos

### Proyecto

- No hay repositorio Git activo en `jarvis-companion`.
- Es una app Node/Express CommonJS.
- `server.js` concentra muchas responsabilidades.
- No hay tests configurados.
- `package.json` tiene `npm test` como placeholder.
- El proyecto contiene estado local, archivos generados y tokens.

### Secretos

Variables detectadas:

- `GEMINI_API_KEY`
- `ELEVENLABS_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_ID`

Tambien existe `.google-tokens.json` en la raiz del prototipo.

Para producto real esto debe pasar a:

- Credential vault local.
- Cifrado por usuario/maquina.
- Redaccion de secretos en logs.
- Revocacion por conector.
- Exportacion/importacion segura.

### Backend

`server.js` sirve UI, maneja seguridad, endpoints, auth, chat, confirmaciones, memoria, agentes, voz, diagnosticos y goals.

Endpoints detectados:

- `/api/handshake`
- `/api/confirm`
- `/api/status`
- `/api/setup`
- `/api/diagnostics`
- `/api/auth/google`
- `/api/auth/google/callback`
- `/api/auth/google/status`
- `/api/calendar/events`
- `/api/agents`
- `/api/agents/spawn`
- `/api/agents/kill`
- `/api/memory/index`
- `/api/memory/node/:id`
- `/api/speak`
- `/api/chat`
- `/api/struggle-status`
- `/api/startup-greeting`
- `/api/goals`
- `/api/goals/create`
- `/api/goals/score`
- `/api/goals/check`
- `/api/goals/replan/:id`

### Frontend

El HUD actual tiene identidad visual fuerte, pero esta demasiado cargado para el producto final.

Piezas rescatables:

- Visualizador central.
- Chat principal.
- Paneles satelitales.
- Estado del sistema.
- Widget de agenda.
- Mapa cerebral como concepto.
- Voz y manos libres.

Piezas a replantear:

- Texto excesivamente tecnico/ficcional.
- Saturacion de controles en primera pantalla.
- Dependencia estetica de Stark Industries.
- Uso visible de conceptos internos.
- Paneles que mezclan demo, diagnostico y operacion real.

### Memoria

La memoria actual guarda JSON por nodo e indice `brain_index.json`.

Fortalezas:

- Es local.
- Es legible.
- Tiene indice.
- Permite recuperar contexto por coincidencias.

Limitaciones:

- No hay estados `candidate`, `verified`, `conflicting`, `sensitive`, etc.
- No hay scoring de fuente.
- No hay caducidad.
- No hay separacion clara entre usuario, negocio, fuente, skill y procedimiento.
- No hay migraciones/versionado.
- La recuperacion es por keyword simple, no por contratos de memoria.

### Google

Hay integraciones reales y utiles:

- Calendar.
- Gmail.
- People/Contacts.
- Drive/Docs.

Esto debe conservarse conceptualmente, pero reescribirse como conectores con contrato y permisos.

### Agentes

Hay un orquestador basico de agentes con bucle ReAct, logs, progreso y cancelacion.

Fortalezas:

- Buen concepto de agentes en segundo plano.
- Logs visibles.
- Progreso.
- Roles.
- Cancelacion.

Limitaciones:

- Max steps fijo.
- Herramientas embebidas en prompt.
- Permisos basados en texto de rol.
- Sin budget formal.
- Sin task runtime compartido.
- Sin sandbox fuerte.
- Sin evaluadores de salida.

### Browser / Computer Use

Existe `web-automation.js` con Puppeteer visible/headless y perfil persistente.

Fortalezas:

- Navegador controlable.
- Sesion persistente.
- Navegacion, click, type, screenshot, extract.

Riesgos:

- Flags como `--disable-web-security`.
- Perfil persistente puede guardar sesiones sensibles.
- Falta politica por dominio.
- Falta modo observador.
- Falta confirmacion contextual antes de acciones sensibles.

### File Manager

Hay manejo de archivos con papelera reversible y protecciones basicas.

Fortalezas:

- Evita borrar rutas criticas.
- Mueve a papelera local en vez de borrar directo.

Riesgos:

- Reglas hardcodeadas.
- Falta policy engine central.
- Falta auditoria unificada.

## Que Conservar

Conservar como referencia o migrar por piezas:

- Integraciones Google.
- Concepto de HUD + voz.
- Chat-service/audio-service como base conceptual.
- Memoria local como semilla.
- Fallback de modelos Gemini.
- Agentes en segundo plano como prototipo.
- Web automation con Puppeteer, pero gobernada.
- Confirmaciones para acciones peligrosas.
- Telegram como canal opcional.
- Struggle detector como idea de autoreparacion/alerta.

## Que Rehacer

Rehacer como arquitectura definitiva:

- Orquestador central.
- Prompt monolitico.
- Action executor.
- Memoria.
- Vault.
- Tool registry.
- Policy engine.
- Task runtime.
- Event bus.
- Skill lifecycle.
- MCP manager.
- Computer-use governance.
- Onboarding.

## Primera Construccion Recomendada

No empezar por redisenar todo el HUD. Empezar por el nucleo que hara posible que el HUD no sea una maqueta.

Primera pieza real:

`Jarvis Core Local Runtime`

Debe incluir:

- Config local.
- Event bus.
- Task runtime.
- Tool registry.
- Policy engine minimo.
- Model provider Gemini BYOK.
- Memory store v1 con estados.
- Credential vault v0.
- API local limpia para el HUD.

## Estrategia de Migracion

1. Mantener `jarvis-companion` como laboratorio/reference.
2. Crear base nueva para Jarvis Codex.
3. Migrar capacidades una por una.
4. Envolver cada capacidad en contrato de herramienta.
5. Probar cada herramienta con entradas/salidas controladas.
6. Conectar HUD cuando el runtime ya emita eventos.

## Decision

El prototipo actual esta bien encaminado como prueba ambiciosa. Es funcional, demuestra muchas capacidades reales y confirma que la vision es tecnicamente alcanzable por capas.

Pero para construir el producto serio, conviene tratarlo como cantera: sacar piedra buena, no vivir dentro de la mina.
