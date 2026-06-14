# Auditoria del repo de investigacion Jarvis

Fuente revisada: `C:\proyectos\investigacion\jarvis`
Fecha: 2026-06-01

## Veredicto corto

Este repo no es solo una referencia lateral: contiene varias piezas que deberian influir directamente en Jarvis Codex.

No conviene importarlo entero. Es demasiado grande, orientado a daemon/plataforma, con workflows tipo Activepieces, sidecar multi-maquina, rooms completas y muchas superficies que podrian adelantar complejidad innecesaria. Pero varias ideas son mejores que lo que tenemos ahora y deben portarse selectivamente.

La conclusion principal: Jarvis Codex debe quedarse local-first y liviano, pero tomar de este repo sus patrones de memoria, personalidad, autoridad, aprobaciones, sidecar y HUD modular.

## Piezas valiosas

### 1. Vault como grafo de conocimiento

Archivos clave:

- `src/vault/schema.ts`
- `src/vault/entities.ts`
- `src/vault/facts.ts`
- `src/vault/relationships.ts`
- `src/vault/commitments.ts`
- `src/vault/observations.ts`
- `src/vault/vectors.ts`
- `src/vault/retrieval.ts`
- `src/vault/extractor.ts`

Lo bueno:

- Usa SQLite local.
- Separa entidades, hechos, relaciones, compromisos, observaciones y vectores.
- Tiene indices por tipo, nombre, predicado, relaciones y estado.
- Ya piensa en busqueda semantica futura mediante tabla de vectores.
- Tiene recuperacion antes de responder: busca memoria relevante y la inyecta en prompt.

Decision para Jarvis Codex:

Portar el concepto, no copiar la implementacion Bun/SQLite tal cual si no calza. Nuestro `MemoryStore` actual debe evolucionar hacia un Vault local con estados de memoria.

Mejor modelo combinado:

- `entities`
- `facts`
- `relationships`
- `observations`
- `commitments`
- `memory_states`
- `source_refs`
- `vectors` opcional/futuro

La diferencia critica: Jarvis Codex debe conservar estados como `candidate`, `verified`, `conflicting`, `sensitive`, `obsolete`, etc. El repo de investigacion tiene buena estructura, pero le falta suficiente gobierno de veracidad.

### 2. Extractor de conocimiento

Archivo clave:

- `src/vault/extractor.ts`

Lo bueno:

- Extrae entidades, facts, relaciones y compromisos desde `userMessage` + `assistantResponse`.
- Usa JSON estricto.
- Deduplica entidades existentes.
- Guarda compromisos detectados.

Critica:

- Es demasiado confiado: extrae y guarda directo.
- No distingue lo declarado por el usuario, lo inferido y lo derivado por herramienta con suficiente fuerza.
- No filtra suficientemente basura contextual, promos o snippets truncados.

Decision para Jarvis Codex:

Crear un extractor propio inspirado en este, pero con politica:

- todo entra como candidato salvo evidencia fuerte
- guardar evidencia textual
- detectar sensibilidad
- detectar contradicciones
- no guardar basura operacional
- no guardar resumenes malos como conocimiento

### 3. Personality Engine

Archivos clave:

- `src/personality/model.ts`
- `src/personality/learner.ts`
- `src/personality/adapter.ts`
- `docs/PERSONALITY_ENGINE.md`

Lo bueno:

- Aprende preferencias de comunicacion.
- Se adapta por canal: WhatsApp, Telegram, Email, Terminal, WebSocket.
- Modela verbosidad, formalidad, humor, uso de emojis y formato preferido.
- Esto responde directamente al problema que vimos: Jarvis debe aprender como entregar valor, no solo que herramienta usar.

Decision para Jarvis Codex:

Agregar una memoria de preferencias comunicacionales separada de la memoria factual.

Ejemplos que debe aprender:

- el usuario prefiere listas cuando pide varios elementos
- no quiere parrafos largos para correos o auditorias
- quiere que las respuestas indiquen valor y accion sugerida
- quiere critica real, no optimismo automatico
- quiere generalizar bugs, no parches especificos

### 4. Authority Engine

Archivos clave:

- `src/authority/engine.ts`
- `src/authority/approval.ts`
- `src/authority/audit.ts`
- `src/authority/tool-action-map.ts`

Lo bueno:

- Clasifica acciones por categoria.
- Maneja niveles de autoridad.
- Tiene categorias gobernadas que requieren aprobacion.
- Tiene overrides, reglas contextuales, auditoria y estado de emergencia.
- Las aprobaciones son persistentes, no botones efimeros.

Decision para Jarvis Codex:

Nuestro sistema actual de confirmacion funciona para pruebas, pero es minimo. Debe evolucionar a:

- approval request persistido
- payload exacto visible
- estado `pending/approved/denied/executed/expired`
- auditoria
- expiracion
- historial
- decision explicable

Esto previene el loop que vimos al enviar correo y evita que el HUD muestre botones duplicados o procesos internos.

### 5. Orquestador de agentes

Archivo clave:

- `src/agents/orchestrator.ts`

Lo bueno:

- Ejecuta bucles LLM -> tool -> LLM.
- Tiene limite de iteraciones.
- Recorta resultados de herramientas para controlar contexto.
- Soporta subagentes con autoridad reducida.
- Integra aprobaciones y auditoria.

Critica:

- `MAX_TOOL_ITERATIONS = 200` es demasiado generoso para nuestro estado actual.
- La jerarquia de agentes puede agregar complejidad antes de que el agente principal sea confiable.

Decision para Jarvis Codex:

Portar la disciplina, no la complejidad:

- limite de iteraciones bajo y configurable
- trazabilidad de cada tool call
- resultados resumidos antes de reinyectar al modelo
- subagentes despues de estabilizar memoria/autoridad

### 6. Workflows tipo Activepieces

Archivos clave:

- `docs/WORKFLOW_AUTOMATION.md`
- `src/workflows/*`

Lo bueno:

- Integra piezas, conexiones, triggers, waitpoints, logs, ejecucion versionada.
- Tiene runtime separado/sandboxed.
- Las credenciales de conexiones se cifran.

Critica:

- Es una plataforma grande dentro del producto.
- Para Jarvis Codex podria ser demasiado pronto.

Decision para Jarvis Codex:

No portar ahora. Tomar como norte futuro para "superpoderes" y automatizaciones, pero partir con un catalogo modular simple:

- tool modules
- skill definitions
- approval policies
- logs
- tests por modulo

### 7. Sidecar

Archivos clave:

- `docs/sidecar/SIDECAR_PROTOCOL.md`
- `sidecar/*`
- `src/actions/app-control/*`

Lo bueno:

- Modelo brain <-> sidecar por WebSocket.
- RPC con correlacion por id.
- Eventos espontaneos desde desktop.
- Manejo de binarios: base64 chico, frames binarios grandes.
- Identidad de sidecar ligada a conexion.
- Validacion de payload, limites y defensa contra payloads malos.

Decision para Jarvis Codex:

Muy relevante para futuro desktop real:

- controlar apps
- observar pantalla
- gestos/camara despues
- manejar multiples maquinas si algun dia se necesita

Pero para nuestra vision local-first, el sidecar puede vivir como proceso local del paquete, no como arquitectura cloud.

### 8. Awareness y Struggle Detector

Archivos clave:

- `src/awareness/struggle-detector.ts`
- `src/awareness/context-tracker.ts`
- `src/awareness/suggestion-engine.ts`

Lo bueno:

- Detecta patrones de esfuerzo: ensayo/error, undo/revert, output repetido y bajo progreso.
- Clasifica apps: editor, terminal, browser, creativo, puzzle, general.
- Tiene cooldown y gracia antes de interrumpir.

Decision para Jarvis Codex:

Muy valioso para el Jarvis "real":

- no solo espera comandos
- observa si el usuario esta atascado
- ofrece ayuda con contexto

Debe ser opt-in y con controles claros de privacidad local.

### 9. HUD modular: Thread + Rooms + Voice Rail

Archivos clave:

- `ui/src/v2/shell/AppShell.tsx`
- `ui/src/v2/rooms/RoomShell.tsx`
- `ui/src/v2/rooms/*`
- `ui/src/v2/palette/*`
- `ui/src/v2/voice/*`

Lo bueno:

- No intenta meter todo dentro del chat.
- Usa thread central para conversacion.
- Usa rooms para herramientas grandes: memoria, tareas, calendario, logs, workflows, authority, settings.
- Tiene command palette.
- Tiene voice rail y estados de voz.
- Soporta ventanas flotantes/minimizables/expandibles.

Decision para Jarvis Codex:

Este es probablemente el mejor insumo para rediseñar el HUD.

Principio a portar:

- Chat = conversacion y decisiones.
- Rooms = superficies de trabajo.
- Reportes largos = artifact/room, no burbuja interminable.
- Procesos internos = logs de desarrollo o room tecnica, no HUD final.
- Confirmaciones = cards claras dentro del thread, con payload visible.

## Gaps del repo de investigacion

Aunque es fuerte, no todo esta listo para nuestra vision.

### Falta gobierno fuerte de memoria

Tiene confidence, pero no un ciclo completo de:

- candidate
- verified
- rejected
- conflicting
- sensitive
- obsolete

### Puede ser demasiado cloud/daemon

Su README empuja daemon siempre activo, sidecars y hosting. Nuestra vision actual es local-first con APIs externas solo para modelos e integraciones autorizadas.

### Riesgo de sobrearquitectura

Workflows, Activepieces, sidecar, rooms, agentes, autoridad y vault juntos son potentes, pero si se portan todos ahora, Jarvis Codex puede volverse dificil de estabilizar.

### UX todavia debe adaptarse

Las rooms son buena idea, pero el estilo visual debe ser nuestro Jarvis, no dashboard generico ni panel tecnico.

## Que deberiamos hacer ahora

Orden recomendado:

1. Portar modelo de memoria inspirado en Vault + Jarvis 1.0.
2. Agregar extractor de aprendizaje post-turno con estados y evidencia.
3. Inyectar memoria recuperada antes de razonar.
4. Crear personality/preferences memory para formato, tono y decisiones de presentacion.
5. Reforzar approvals con persistencia y payload visible.
6. Convertir HUD en thread + artifacts/rooms.
7. Despues, catalogo de superpoderes modular.
8. Mas adelante, sidecar/desktop awareness.
9. Mucho mas adelante, workflows complejos tipo Activepieces.

## Decision practica para Jarvis Codex

El siguiente bloque de construccion deberia ser memoria, no HUD.

Razon: el HUD esta feo, pero el problema que acabamos de descubrir es mas profundo. Jarvis necesita aprender:

- hechos
- relaciones
- preferencias
- patrones de accion
- patrones de presentacion

Sin eso, cualquier HUD bonito solo mostrara mejor una inteligencia todavia poco persistente.

La memoria nueva debe nacer con:

- grafo local
- extractor post-turno
- estados
- evidencia
- recuperacion antes del prompt
- filtro anti-basura
- aprendizaje de preferencias

