# Fusión de Conocimiento — Lo mejor de los 3 Jarvis

> Referencia técnica enlazada desde PRD.md §11 (Roadmap). Plan para acercar jarvis-codex
> a la meta "todo lo que me imagine que pueda hacer, que lo haga", fusionando ideas de los
> tres Jarvis estudiados (sesión 2026-06-14).

## Los tres repos de origen

| Repo | Qué es | Aporta |
|---|---|---|
| `C:\proyectos\jarvis-companion` | Jarvis original de Daniel (Node, Gemini, ElevenLabs). **Probado en producción.** | Meta-planner Fase 0, struggle-detector, router semántico de prompts |
| `C:\proyectos\investigacion\jarvis` | `@usejarvis/brain` de vierisid (Bun/TS + sidecar Go). Producto maduro. | Knowledge graph (vault), modelo daemon+sidecar, authority engine, 9 roles |
| `C:\proyectos\investigacion\mark-xxxix` | `Mark-XXXIX` de FatihMakes (Python, Gemini Live). | Agente autónomo planner/executor/error-handler con auto-fix |

## Decisión de licencias (NO negociable)

- `jarvis-companion` → de Daniel. **Copia de código libre.**
- `investigacion/jarvis` → **RSALv2 (Source Available, no open source)**. Restringe uso comercial.
  El autor vende hosting de su propio Jarvis (opencove.host). codex se vende white-label.
- `investigacion/mark-xxxix` → **CC BY-NC 4.0 (No Comercial)**.

**Regla:** de inv/jarvis y mark-xxxix se toman **ideas, arquitectura y esquemas de datos**
(no protegibles) y se **reimplementan** en el stack de codex (vanilla JS, CommonJS, ES modules).
NO se copia código literal de esos dos. De companion sí.

## Hallazgo sobre el "memory handle" de inv/jarvis

Es un **knowledge graph** (entidades → hechos → relaciones → commitments) con extracción LLM
automática post-respuesta e inyección al prompt. **Pero** su búsqueda vectorial es un stub
(`vectors.ts:findSimilar()` devuelve `[]`, TODO de sqlite-vec); el retrieval real es keyword
matching con `LIKE` + stopwords. Es complementario —no rival— de lo que codex ya tiene:

| | codex (hoy) | inv/jarvis |
|---|---|---|
| Estados de memoria (candidate→verified), curaduría | Sí | No |
| Invariantes de aprendizaje (autoridad/procedencia) | Sí | No |
| Contexto por tiers, persona-core | Sí | No |
| Grafo entidad–hecho–relación | **No** | Sí |
| Extracción estructurada post-respuesta | parcial | Sí |
| Commitments con vencimiento | No | Sí |
| Búsqueda vectorial real | No | No (stub) |

El merge correcto es **agregar la capa de grafo encima del sistema de estados de codex**, no
reemplazar nada.

## Secuencia de implementación (ordenada por dependencias y riesgo)

> Estado: **A hecha** · **B descartada (redundante)** · **C audit hecho** · **D hecha** (resto de C, y E, F pendientes).

### Fase A — Memory Knowledge Graph ✅ IMPLEMENTADA (2026-06-14)
Reimplementación propia de la idea (no copia) en `src/memory/knowledge-graph.js` +
`src/memory/graph-extractor.js`. Persistencia JSON atómica en `local_data/memory/graph.json`.
- **Modelo:** `entities` (person/project/tool/place/concept/event/org) → `facts` (predicate/object
  con confidence + source + **state** reusando candidate→verified) → `relationships` tipadas →
  `commitments` (pending/active/completed/failed/cancelled, con vencimiento y prioridad).
- **Fusión con la curaduría de codex:** lo que el usuario afirma directo entra `verified`; lo que
  infiere el extractor LLM entra `candidate`. Reobservar un hecho lo refuerza (sube `observations`
  y asciende a `verified`). Dedup por tipo+nombre normalizado y por (sujeto, predicado, objeto).
- **Extracción:** paso 4 de `scheduleBackgroundLearning` en `conversation-runtime.js` — tras cada
  turno, el LLM extrae y deposita en background (nunca rompe el camino en vivo).
- **Inyección:** sección `[grafo de conocimiento]` en `context-assembler.js` (entidades relevantes
  al mensaje + compromisos abiertos), con control de presupuesto y self-query detection.
- **Tools:** `memory.graph_query` (¿qué sabes de X?), `memory.graph_remember` (registro explícito
  verificado), `memory.commitments` (listar/cerrar compromisos).
- **Tests:** `test/knowledge-graph.test.js` (9 casos). Validado E2E: un mensaje sobre Vikram/Rishtedar
  llenó el grafo por ambos caminos (tool + extractor) sin duplicar, con refuerzo y estados correctos.

### Fase B — Meta-planner Fase 0 ❌ DESCARTADA (redundante en codex)
Al bajar al código se confirmó que el meta-planner de companion resolvía un problema que codex
ya tiene resuelto mejor: el system prompt ya instruye preguntar ante datos faltantes / no inventar
("Si faltan datos obligatorios, pregunta solo por los datos faltantes"; "Antes de agents.create
REVISA tu catálogo"), y el **tool loop de 3 rondas** ya busca datos reales antes de responder —
justo lo que el pre-pase de companion forzaba por tener arquitectura de "una acción JSON". Copiarlo
sería un llamado LLM extra por turno que duplica el tool loop y rompe el cache del system prompt y
la latencia (crítica). No se implementa.

### Fase C — Authority Engine + audit trail *(gobernanza ANTES de dar manos)*
**Audit trail ✅ IMPLEMENTADO (2026-06-14)** — `src/security/audit-trail.js`. Registro auditable
en `local_data/logs/audit.jsonl` de TODA ejecución de tool (herramienta, riesgo, decisión de
política, resultado ok/error/denied/confirmation_required, canal, input redactado+truncado),
enganchado en el punto único `tool-registry.execute`. Tool `audit.query` ("¿qué hiciste hoy?") +
endpoint `GET /audit`. `consecutiveApprovals()` deja la semilla para el aprendizaje de
auto-aprobación. Tests en `test/audit-trail.test.js` (5). Validado E2E.
**Pendiente de C:** aprobaciones multi-canal (Telegram/Discord) y el aprendizaje de reglas de
auto-aprobación por repetición (sugerir auto-aprobado tras N aprobaciones seguidas).

### Fase D — Agente autónomo multi-paso ✅ IMPLEMENTADA (2026-06-14)
Reimplementación propia de la idea de mark-xxxix (planner→executor→error-handler) en
`src/agents/task-executor.js`, adaptada a la gobernanza de codex:
- **Planifica** el objetivo en pasos (1 llamado LLM) usando solo tools reales del registry.
- **Ejecuta** paso a paso vía `toolRegistry.execute` (respeta policy + audit), encadenando los
  resultados al contexto del auto-fix.
- **Auto-fix:** ante un error real, un llamado LLM propone input corregido o tool alternativa y
  reintenta UNA vez (no loops infinitos).
- **Techo de autonomía:** un paso de alto riesgo NO se auto-confirma — se marca `needs_approval`
  y el ejecutor se detiene (`paused_for_approval`). Coherente con Fase C.
- **Anti-recursión:** policy rule bloquea que una tarea autónoma lance otra (o desde channel agent).
- Devuelve datos estructurados (sin resumen LLM extra); el tool loop existente los presenta.
- Tool `tasks.run_autonomous` (el modelo la invoca para tareas complejas). Tests en
  `test/task-executor.test.js` (6). Validado E2E: el modelo la usó para una tarea de clima+nota,
  planificó y ejecutó `web.fetch` reales, y reportó honestamente la limitación sin alucinar.
**Nota:** reemplaza la idea del `replan` de mark-xxxix por un auto-fix por paso + parada gobernada,
más simple y seguro que re-planificar el objetivo completo en bucle.

### Fase E — Manos remotas: daemon + sidecar *(la más grande; requiere C lista)*
Reimplementar de inv/jarvis: arquitectura daemon-central + sidecar liviano que se conecta por
WebSocket y expone desktop/browser/terminal/clipboard de cada máquina. Resuelve de forma limpia
"controlar pestañas/apps sin meter computer-use pesado en el core" (ver PRD §4 P2). De mark-xxxix:
`browser_control` con perfil real del navegador (abre las pestañas del usuario con su sesión).

### Fase F — Awareness + struggle-detector *(proactividad; usa captura de la Fase E)*
Adaptar de companion: vigilar la pantalla (captura del sidecar de Fase E + OCR) y ofrecer ayuda
proactiva cuando detecta que el usuario está atascado (trial-and-error, undo/revert, bajo
progreso), con ventana de gracia y cooldown.

## Fuera de alcance (por ahora)

- Fork de Activepieces de inv/jarvis (1497 archivos, workflows visuales): enorme y desalineado
  con la filosofía "tools genéricas > builder" del PRD.
- Los 9 roles especialistas de inv/jarvis: inspiración para persona-core, no código.
