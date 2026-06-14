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

### Fase B — Meta-planner Fase 0 *(barato, de companion, mejora todo)*
Copiar/adaptar de companion: antes de actuar, un primer paso decide si la orden requiere datos
reales (web/archivos/correos), detecta brechas cognitivas (falta hora, falta lenguaje) y genera
directivas de calidad. Es código propio → copia directa, adaptada al pipeline de codex.

### Fase C — Authority Engine + audit trail *(gobernanza ANTES de dar manos)*
Reimplementar de inv/jarvis sobre el `policy-engine` existente: audit trail completo de toda
ejecución de tool, aprobaciones multi-canal (chat/Telegram), y aprendizaje de reglas de
auto-aprobación por repetición. Va antes de las Fases D/E porque esas dan capacidades peligrosas.

### Fase D — Agente autónomo multi-paso *(sobre la plataforma de agentes existente)*
Reimplementar de mark-xxxix: trío `planner → executor → error_handler`. Planifica en pasos,
ejecuta uno a uno inyectando contexto entre pasos, y si algo falla, analiza el error y genera el
parche (auto-fix) antes de reintentar. Encaja con el scheduler/recetas que ya existen y conecta
con la validación-al-crear de `agents.create` ya implementada.

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
