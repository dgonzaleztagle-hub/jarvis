# JARVIS — Product Requirements Document

> **Versión consolidada.** Este archivo reemplaza los ~40 documentos fragmentados anteriores.  
> Todo cambio de visión, decisión técnica o roadmap se edita aquí.  
> Los archivos en `docs/` son referencia histórica/legacy — si contradicen este PRD, manda el PRD.
> Última actualización: 2026-06-10 (agentes v1, SLOs de latencia, gobernanza de costos, builder en Fase 8).

---

## 1. Visión

Jarvis es un asistente operativo que vive en la computadora del usuario.  
No es un chatbot. No es SaaS. Es software local que piensa, recuerda, aprende y ejecuta trabajo real.

**La metáfora central:** un niño Einstein — muy inteligente desde el inicio, pero que todavía es un niño. Aprende del dueño, crece con el uso, y mantiene personalidad propia. Si se equivoca y el humano lo corrige, no lo vuelve a repetir.

**Marca blanca:** Jarvis no tiene un solo dueño tipo. Lo compra un dentista y aprende que es dentista. Lo compra una agencia y aprende que es agencia. El onboarding lo moldea. El uso lo afina.

---

## 2. Propuesta de Valor

| Lo que hacen los demás | Lo que hace Jarvis |
|---|---|
| Viven en la nube | Vive en tu computadora |
| Olvidan todo entre sesiones | Aprende y recuerda |
| Requieren suscripción | BYOK: traes tu propia API key |
| Caja negra | Gobernado: ves qué puede hacer y qué riesgo tiene |
| Chat solamente | Voz, escritorio, agentes, workflows |
| Genérico | Se especializa en tu rubro en el onboarding |

**Decisiones no negociables:**
- **Local-first**: datos, memoria y pensamiento en la máquina del usuario. Sin nube propietaria.
- **BYOK**: el usuario paga su API key (Gemini recomendado, Anthropic/OpenAI compatibles). Jarvis no cobra por pensar.
- **Gobernado**: cada herramienta tiene contrato, permisos y nivel de riesgo visible.
- **Curadería rigurosa**: una memoria pequeña y confiable > una memoria grande con ruido.
- **Degraded mode**: si algo falla (sin internet, cuota agotada, conector roto), Jarvis sigue siendo útil.

---

## 3. Usuario Objetivo

**Primary:** profesional independiente o dueño de pequeño negocio en Latinoamérica que usa Google Workspace, quiere automatizar trabajo repetitivo, y valora que sus datos no salgan de su computadora.

**Verticales iniciales:**
- Dentistas / profesionales de salud
- Restaurantes
- Agencias de marketing / diseño
- Abogados / contadores

**Perfil técnico:** no desarrollador. Instala como app. No abre terminales. No edita archivos de configuración.

---

## 4. Capacidades (Qué hace)

### P0 — Tiene que funcionar en v1

| Capacidad | Descripción |
|---|---|
| Chat conversacional | Responde, ejecuta, avisa progreso. Nunca se queda callado en tareas largas. |
| Voz | Habla y escucha. Modo manos libres, push-to-talk, modo silencioso. |
| Agenda | Revisar agenda del día/semana, crear eventos, briefing pre-reunión. |
| Correo | Revisar correos recientes, redactar respuestas, enviar. |
| Documentos | Crear documentos en Google Docs, resumir, exportar. |
| Memoria local | Recuerda lo que aprendió del dueño. No mezcla lo verificado con lo débil. |
| Onboarding guiado | Aprende el rubro, conecta Google, configura sin tecnicismos. |
| HUD modular | Interfaz visual tipo Iron Man — paneles que aparecen/desaparecen, no apilados. |
| Telegram | Canal paralelo desde el celular: texto, fotos/documentos a la bandeja local, y **espejo de voz** (nota de voz entra → nota de voz sale). |

### P1 — Siguiente iteración

| Capacidad | Descripción |
|---|---|
| Web research | Investiga con fuentes verificadas, guarda solo lo confiable. |
| SEO audit | Analiza sitios web con checklist y severidad. |
| Reportes | Genera reportes estructurados en Google Docs/Sheets. |
| Control de navegador | Navega, llena formularios, extrae información. |
| Desktop automation | Abre apps, controla ventanas, OCR de pantalla. |
| Struggle detection | Detecta cuando el usuario está atascado y ofrece ayuda proactiva. |
| Deep research | Investigación en profundidad con múltiples fuentes. |
| YouTube | Busca y abre videos por nombre/tema. |
| Archivos locales | Busca, mueve, organiza archivos. |
| Notetaker de reuniones | Bot que entra al Meet/Zoom, transcribe, genera minuta y acuerdos en Docs. |

### P2 — Futuro

- Workflows visuales (tipo n8n)
- Multi-agente orquestado (Researcher, Analyst, Critic, Operator, Archivist)
- Skill lifecycle: detecta tareas repetidas y propone convertirlas en skills
- Verticales especializados (packs por rubro)
- Conectores: Notion, CRMs, analytics, Shopify
- Autoreparación: error monitor, sandbox, rollback
- **Control por gestos** — navegación del HUD sin teclado ni voz (MediaPipe vía microservicio Python)
- **Delegado de reuniones** — Jarvis habla EN la reunión en nombre del usuario (requiere notetaker maduro + clonación de voz + guardrails de identidad; nunca sin que los demás participantes sepan que es un asistente)
- **Control total del escritorio (computer-use, opt-in)** — capa de automatización visual (screenshot + click/teclado) como techo final de capacidad: lanzar cualquier app, jugar, manejar cualquier ventana o sitio sin API. Por su alcance (ve y controla todo lo que hay en pantalla) debe ser un modo explícito que el usuario activa a conciencia, no la vía por defecto. Capa previa más liviana y de menor riesgo: extensión de navegador propia (`browser.list_tabs` / `browser.focus_tab`) para el caso común de "enfoca la pestaña donde tengo X abierto" sin necesitar visión de pantalla completa.

### Agentes Automáticos — v1 IMPLEMENTADA (adelantada de roadmap)

Jarvis crea agentes recurrentes conversando con el usuario. No genera código: genera **recetas declarativas** validadas.

**Lo que existe hoy (`src/agents/`):**
- `agent-store.js` — recetas en disco: name, goal autosuficiente, schedule (daily/interval/manual), presupuesto duro `maxRunsPerDay`
- `agent-scheduler.js` — tick 60s, candado anti-paralelo, corte automático al agotar presupuesto diario; cada corrida usa el pipeline conversacional completo (canal `agent`, no contamina historial del HUD)
- Tools: `agents.create` (risk high → confirmación formal), `list`, `run_now`, `set_enabled`, `delete`
- **Discovery anti-alucinación**: antes de crear, el modelo revisa su catálogo de tools (no rechaza lo viable, no crea zombis), hace máx 2 preguntas si la misión es ambigua, nunca inventa horarios, y sugiere qué conector faltaría si la capacidad no existe
- Panel HUD de agentes vivos: estado, agenda, última corrida, pausar/ejecutar — se abre al arrancar si hay agentes

**Pendiente de la plataforma de agentes:**
- Notificación de corridas programadas (voz HUD + Telegram) — hoy el resultado queda en disco/evento
- Presupuesto en dólares por agente (hoy solo corridas/día) usando usage-meter por agentId
- Namespace de memoria por agente (un agente-tutor no debe contaminar la memoria principal)
- Guardrail anti-injection: agente desatendido que procesa contenido externo (web.fetch) no ejecuta tools de escritura de alto riesgo — deja aprobación pendiente
- Escalera de autonomía: L1 usuario pide (hoy) → L2 Jarvis propone desde patrones observados → L3 crea solo con presupuesto → L4 (agentes creando agentes) BLOQUEADO por diseño

### Decisión arquitectónica documentada: por qué los paneles son modulares

La modularización del HUD (paneles que aparecen/desaparecen independientemente, no una pantalla monolítica) fue diseñada con gestos en mente desde el inicio. Cada panel es una unidad activable/desactivable que puede mapearse a un gesto específico:

- Gesto → abrir panel de correo
- Gesto → cerrar artefacto activo
- Gesto → cambiar entre Workspace y ActivityPanel
- Gesto → confirmar acción pendiente

Si se agrega control por gestos, el runtime recomendado es Python + MediaPipe como microservicio separado que publica eventos al servidor Node.js vía WebSocket o HTTP interno. Node.js sigue siendo el core — Python solo maneja la visión por computadora.

---

## 5. El HUD (Cómo se ve)

El HUD no es una pantalla llena de texto. Es una **shell de trabajo** con 4 zonas funcionales:

```
┌─────────────────────────────────────────────────────┐
│  WORKSPACE — artefactos, reportes, agenda, docs     │
│  (paneles internos movibles, ventanas satélite)     │
├──────────────────────────┬──────────────────────────┤
│  COMANDO                 │  ACTIVIDAD               │
│  - Entrada texto/voz     │  - Tareas activas        │
│  - Respuesta corta       │  - Aprobaciones pendientes│
│  - Historial compacto    │  - Progreso y errores    │
├──────────────────────────┴──────────────────────────┤
│  DOCK — accesos rápidos configurables               │
│  [Agenda] [Correos] [YouTube] [Memoria] [Permisos]  │
└─────────────────────────────────────────────────────┘
```

**Reglas de enrutamiento visual:**
- Cabe en 3 frases → chat
- Tiene listas, tablas, secciones → artefacto en Workspace
- Requiere aprobación → ActivityPanel
- Es configuración → panel especializado
- Es debugging → solo modo operador

**Tipos de artefacto:**

| Tipo | Contenido |
|---|---|
| `email_digest` | Lista de correos con remitente, fecha, asunto, resumen |
| `calendar_briefing` | Timeline de eventos + preparación |
| `report` | Visor con secciones, exportación |
| `web_research` | Fuentes, hallazgos, nivel de confianza |
| `seo_audit` | Checklist, severidad, acciones |
| `memory_review` | Conocimiento guardado + confianza |
| `approval` | Decisión pendiente del usuario |
| `task_log` | Pasos, eventos, errores |

**Principio clave:** El HUD debe verse bien **vacío**. Los paneles aparecen cuando hay algo que mostrar. No hay información apilada permanentemente.

---

## 6. Aprendizaje y Memoria

La memoria de Jarvis tiene **dos tracks independientes** que crecen en paralelo:

| Track | Qué guarda | Cambia cuando |
|---|---|---|
| **Conocimiento** | Hechos, contexto, datos del negocio | El mundo cambia (nuevo horario, nuevo contacto) |
| **Personalidad** | Cómo le gusta al usuario que Jarvis se comporte | El usuario corrige una interacción o pide un ajuste |

Ambos tracks son un **índice de memorias pequeñas** — no un bloque monolítico. Cada recuerdo es granular, tiene scope definido, y puede actualizarse o descartarse independientemente.

---

### Track 1 — Memoria de Conocimiento

#### Estados de un recuerdo

```
candidate → verified → mature
         ↓           ↓
    low_confidence  obsolete
         ↓
      rejected
         
(siempre posible: conflicting, sensitive)
```

**Umbrales de entrada:**
- Dato operativo general: confianza mínima media
- Dato de negocio local: fuente verificable + fecha reciente
- Dato médico/legal/financiero: fuente alta O revisión humana obligatoria
- Dato contradictorio: guardar como `conflicting`, nunca como verdad

**Evaluación de fuentes (antes de guardar):**
- Autoridad (institución, autor, especialidad)
- Vigencia (fecha de publicación)
- Dominio correcto (corresponde al rubro del usuario)
- Sesgo comercial (¿vende algo?)
- Consistencia con otras fuentes

---

### Track 2 — Memoria de Personalidad y Comportamiento

Este track define quién es Jarvis para este usuario específico. Empieza vacío y crece con cada corrección, feedback o instrucción explícita. Es lo que hace que Jarvis se sienta como un niño que aprende a relacionarse — no solo que acumula datos.

#### Tipos de recuerdos de personalidad

| Tipo | Descripción | Ejemplo |
|---|---|---|
| `behavior_rule` | Cómo ejecutar cierto tipo de acción | "En salidas visuales (tarjetas, tablas), mostrar resultado correcto, no instrucciones de contexto conversacional" |
| `personality_trait` | Rasgo de carácter ajustable | "Ser más crítico — señalar fallas antes de ejecutar si la confianza es > 0.6" |
| `output_preference` | Cómo presentar resultados | "Preferir listas concisas sobre párrafos explicativos" |
| `interaction_style` | Tono y cadencia | "No pedir confirmación para cada paso pequeño — asumir que puede implementar directo" |
| `proactive_rule` | Cuándo intervenir sin que lo pidan | "Si el usuario parece ineficiente en una tarea, señalarlo directamente" |

#### Mecanismo de extracción de principios

Cuando el usuario hace una corrección, Jarvis no solo guarda el hecho — extrae el principio generalizable:

```
Corrección recibida
        ↓
¿Es un dato incorrecto?    → corregir en Track 1 (conocimiento)
¿Es un patrón de output?   → behavior_rule en Track 2
¿Es un rasgo de carácter?  → personality_trait en Track 2
¿Es una preferencia?       → output_preference o interaction_style
        ↓
Extraer scope: ¿dónde aplica esta regla?
  → output:visual  (tarjetas, tablas, artefactos)
  → output:voice   (respuestas habladas)
  → output:chat    (mensajes de texto)
  → interaction:*  (toda interacción)
  → domain:google  (solo operaciones con Google)
  → global         (todo)
```

**Ejemplo real — el caso Rossie:**
```
Usuario dice: "no pongas Rossie con doble s en la tarjeta — 
               te lo dije en contexto, no para que aparezca así"

Jarvis extrae:
  tipo: behavior_rule
  scope: output:visual
  regla: "las instrucciones de contexto conversacional no se 
          reflejan literalmente en salidas visuales — mostrar 
          el dato correcto final, no el proceso de corrección"
  aplica a: tarjetas de contacto, tablas, artefactos, docs generados
```

**Ejemplo — ajuste de personalidad:**
```
Usuario dice: "eres demasiado complaciente, critícame más"

Jarvis extrae:
  tipo: personality_trait
  scope: global
  regla: "si el usuario propone algo con fallas evidentes, 
          señalarlas antes de ejecutar"
  threshold: 0.5  (antes esperaba alta confianza para dar feedback crítico)

Usuario dice: "si me ves ineficiente, rátatme"

Jarvis extrae:
  tipo: proactive_rule
  scope: interaction:*
  regla: "detectar cuando el usuario da muchas vueltas para hacer 
          algo simple y ofrecer ruta directa sin que lo pida"
```

#### Principio clave: generalizar, no memorizar

La regla de oro del Track 2: **una corrección específica genera un principio general, no un caso especial**. Jarvis no recuerda "con Rosie usa doble s" — recuerda "instrucciones de contexto no aparecen en output visual". La primera regla aplica una vez. La segunda aplica siempre.

#### Invariantes estructurales del aprendizaje (implementados 2026-06)

El aprendizaje en background tiene un riesgo de diseño: **auto-envenenamiento** — el modelo alucina una limitación ("no tengo acceso a tu computador"), el pipeline la guarda como memoria verificada, y el contexto se la reinyecta en cada turno reforzando la falsedad. Caso real detectado y resuelto. La solución no fue borrar la memoria mala (parche), sino dos invariantes en `memory-learning.js` que cierran la clase completa de fallas:

1. **Invariante de AUTORIDAD**: ninguna afirmación sobre las capacidades o limitaciones del propio asistente es aprendible desde conversación. La fuente de verdad de lo que Jarvis puede hacer es el tool registry, no lo que el modelo dijo de sí mismo. Filtro `isAssistantSelfClaim` descarta estos ítems siempre.
2. **Invariante de PROCEDENCIA**: solo las palabras del usuario fundan una memoria `verified`. Todo ítem extraído por el modelo debe traer `evidence` textual que calce con lo que el usuario escribió; si no calza, se degrada a `candidate` con confianza ≤ 0.6.

Complemento: las lecciones verificadas se inyectan en tier 0 **ordenadas por confianza + recencia** antes del corte (las reglas más fuertes y nuevas nunca quedan fuera por orden de inserción), y las memorias `rejected` jamás entran al prompt.

#### Identidad arquitectónica (implementada 2026-06)

Causa raíz complementaria del envenenamiento: el prompt nunca le decía a Jarvis qué es. Ahora el system prompt abre con su identidad arquitectónica: corre **localmente** en el computador del dueño; HUD, Telegram y voz son caras del mismo sistema; la bandeja de archivos es local. Reglas derivadas: nunca afirmar "no tengo acceso a tu computador", nunca declarar una limitación sin intentar primero. Resultado verificado: "súbeme la foto al HUD" por Telegram pasó de "no puedo" a ejecutar `files.list_inbox` + `hud.show_file`.

---

### Arquitectura de Contexto — Crecer por dentro, ser liviano por fuera

**El problema:** a medida que Jarvis aprende, el índice de memorias crece. Si todo va al prompt, el costo de tokens se dispara y el modelo se confunde con ruido.

**La solución:** el contexto *disponible* crece ilimitado; el contexto *enviado* en cada prompt es siempre mínimo suficiente.

#### Ensamblado dinámico de contexto

Antes de cada llamada al modelo, el `ContextAssembler` selecciona qué memorias incluir:

```
Tier 0 — Siempre incluido (~150 tokens)
  → Identidad del usuario (nombre, rubro, idioma)
  → Personalidad activa (behavior_rules y traits más relevantes)
  → Fecha y contexto temporal

Tier 1 — Incluido si hay espacio (~400 tokens)
  → Correcciones recientes (últimos 7 días)
  → Proyectos activos y prioridades
  → Preferencias operativas frecuentes

Tier 2 — Solo si es relevante para la intención detectada (~600 tokens)
  → Conocimiento del dominio que coincide con la tarea actual
  → Contactos o contexto de negocio mencionados en el mensaje
  → Skills activos relacionados

Tier 3 — Nunca en prompt automático
  → Memorias históricas o de baja confianza
  → Conocimiento de otros dominios
  → Accesible solo si el usuario lo pide explícitamente
```

**Budget máximo de contexto inyectado:** ~1200 tokens por defecto (configurable). Si el Tier 2 supera el budget, se priorizan las memorias con mayor relevancia semántica al mensaje actual.

#### Crecimiento del contexto disponible

Cada interacción puede generar nuevas memorias en ambos tracks. Con el tiempo:
- El Tier 0 se vuelve más preciso (personalidad afinada)
- El Tier 2 tiene más conocimiento especializado disponible
- El modelo recibe siempre un contexto pequeño pero cada vez más certero

Jarvis no se vuelve más caro con el uso — se vuelve más inteligente con el mismo presupuesto de tokens.

---

### Skill Lifecycle

Una tarea repetida se convierte en skill automáticamente cuando:
- Se repite (mínimo 2-3 veces)
- Tiene pasos estables
- Produce valor claro
- Tiene parámetros identificables

**Estados:** `idea → draft → sandbox → testing → approved → active → mature → deprecated`

Cada skill tiene contrato formal: qué puede hacer, qué parámetros acepta, qué riesgo tiene, qué aprobación requiere.

---

## 6b. Google Workspace — La Base

Google no es un conector más. Es la columna vertebral operativa del usuario target. Si Google falla o se siente torpe, Jarvis falla. La integración tiene que ser impecable.

### Capacidades por servicio

| Servicio | Capacidades requeridas |
|---|---|
| **Gmail** | Leer bandeja, buscar por remitente/fecha/asunto, ver hilo completo, redactar, enviar, responder, borradores, etiquetar |
| **Calendar** | Ver día/semana/mes, crear evento, invitar personas, cancelar, mover, briefing pre-reunión, minuta post-reunión |
| **Docs** | Crear, leer, resumir, editar secciones, exportar PDF, compartir |
| **Sheets** | Leer datos de rangos, escribir celdas, crear hoja nueva, leer fórmulas como valores |
| **Contacts** | Buscar, leer datos de contacto, crear/actualizar |
| **Tasks** | Ver tareas pendientes, crear, completar, asignar fecha |
| **Drive** | Buscar archivos por nombre/tipo/fecha, listar carpeta, mover, crear carpeta |

### Operaciones cruzadas (lo que hace la diferencia)

Estas son operaciones que el usuario pide como una sola cosa pero requieren múltiples servicios:

- "Manda el resumen de la reunión de hoy" → Calendar (busca evento) + Docs (crea doc) + Gmail (manda correo)
- "Agenda reunión con Vikram y mándale invite" → Contacts (busca email) + Calendar (crea evento con invite)
- "Qué tengo pendiente para esta semana y con quién tengo que hablar" → Calendar + Gmail + Tasks
- "Crea un doc con los puntos de la reunión de ayer" → Calendar (busca reunión) + Docs (crea con estructura)

### Definición de "impecable"

**Auth resilience:** si el token expira en mitad de una tarea, Jarvis no falla — pausa, re-autentica en background, y continúa desde donde estaba. El usuario lo ve como máximo como un aviso breve, no como un error.

**Rate limits:** todas las llamadas a Google APIs tienen backoff exponencial y cola. Nunca "falló la conexión" por rate limiting.

**Cache proactivo:** Calendar y Gmail se sincronizan en background cada N minutos. Cuando el usuario pregunta "qué tengo hoy", la respuesta es inmediata — no espera la API.

**Degraded mode:** si Google no está disponible, Jarvis trabaja con cache local y encola las operaciones para cuando vuelva la conexión.

**Errores con dignidad:** si algo genuinamente falla, Jarvis explica qué pasó y qué puede hacer igual (no simplemente "error 403").

**Estado actual (implementado):** auth autocurativa al arranque (healthCheck promueve el mejor token al vault, nunca falla en silencio), flujo disconnect/reconnect con marcador persistente que impide resurrección de cuentas viejas (cambio de cuenta personal → empresa), status endpoint basado en verificación real.

**REQUISITO DE PRODUCCIÓN (bloqueante para vender licencias):** la app OAuth de Google está en modo "Testing" — los refresh tokens expiran a los ~7 días. Antes de la primera licencia: publicar la app + proceso de verificación de Google para scopes sensibles de Gmail. Sin esto, cada cliente pierde conexión semanalmente.

---

## 7. Onboarding

El onboarding no es configuración técnica. Es una conversación guiada:

1. Bienvenida e identidad de Jarvis
2. Nombre del usuario / negocio
3. Rubro principal (dentista, restaurante, agencia, etc.)
4. **Conectar Jarvis**: elegir proveedor de modelo, crear API key (guía paso a paso), probar conexión
5. **Conectar Google**: OAuth guiado para Calendar, Gmail, Docs
6. Definir permisos (qué puede leer, qué puede enviar, qué requiere confirmación)
7. Investigación inicial del nicho: Jarvis busca fuentes, crea candidatos de memoria
8. Revisión de memoria inicial con el usuario
9. Activación del HUD completo

**Lenguaje del usuario (no técnico):**
- "Conectar Jarvis" (no "configurar API key")
- "Abrir guía" (no "ver documentación")
- "Revisar memoria" (no "memory store inspector")
- "Permisos" (no "policy engine")
- "Superpoderes" (no "tool registry")

---

## 8. Voz

**Regla cardinal:** Jarvis no se queda callado en tareas largas.

| Evento | Jarvis dice |
|---|---|
| `task_started` | "Entendido, estoy revisando tu agenda..." |
| `task_progress` | "Ya capturé la página, estoy analizando..." |
| `artifact_created` | "Dejé el resumen en pantalla" |
| `task_completed` | Resumen final breve |
| `task_failed` | Qué pasó y qué hacer |
| `task_waiting` | "Esperando respuesta de Google..." |

**Reglas de voz:**
- No hablar de más (no leer listas largas en voz)
- Usar voz para resumen, estado, cierre
- Usar pantalla para detalles
- Permitir interrupción en cualquier momento

**Modos disponibles:** botón de hablar / manos libres / push-to-talk / silencioso / solo texto / solo notificaciones

### Registro conversacional — campo `depth` (implementado)

Cada respuesta del modelo declara `depth: brief | expanded`:
- **brief** (default): tareas, datos, confirmaciones — directo y al grano
- **expanded**: solo cuando el usuario quiere conversar/pensar (explícito: "explayate", "qué opinas"; implícito: tema abierto de discusión). Desarrolla con hilo propio, sin recitar fuentes crudas
- Regla anti-turno-fantasma: la respuesta es el ÚNICO turno — nunca anunciar contenido ("voy a analizar...") sin entregarlo completo en la misma respuesta
- Opinión/conversación sin datos estructurables → todo en `speak`, `visual` vacío (evita doble lectura por voz). `speak` jamás lleva markdown
- **Contrato anti-duplicación (enforced en código, no solo en prompt):** si el modelo entrega `speak` y `visual` casi idénticos, el runtime colapsa a uno solo antes de enviar a cualquier canal; si uno quedó truncado por tope de tokens y el otro completo, gana el completo (`collapseDuplicateSpeakVisual` en conversation-runtime)

### Espejo de voz Telegram (implementado 2026-06)

Nota de voz entrante → STT (Gemini multimodal, usa la GEMINI_API_KEY existente) → pipeline conversacional normal → respuesta como **nota de voz nativa**: Edge TTS (MP3) → ffmpeg-static a OGG/Opus 48k mono → `sendVoice`. El `visual` estructurado no se lee en voz alta: va como mensaje de texto aparte. Si cualquier eslabón falla, cae a texto — nunca silencio. Componentes: `src/voice/stt-gemini.js`, `src/voice/audio-convert.js`, `src/channels/telegram-channel.js`.

---

## 9. Gobernanza y Seguridad

### Credential Vault
- Cifrado local, separado por usuario/instancia
- Nunca envía secretos a servidores propios
- Soporte para rotación, revocación, auditoría
- El usuario ve qué permiso tiene cada conector

### Política de Confirmación

| Tipo de acción | Confirmación |
|---|---|
| Lectura | Sin confirmación |
| Escritura reversible (no habitual) | Confirmar |
| Escritura sensible | Confirmar siempre |
| Acción irreversible | Confirmar + trazabilidad |
| Acción financiera/legal/médica | Confirmar + revisión humana |

### Presupuestos de Rendimiento y Costo

**SLOs de latencia (medibles en `/model/usage` → `latency` por propósito):**

| Interacción | Objetivo p95 |
|---|---|
| Decisión conversacional (brief) | < 4s |
| Respuesta expandida | < 9s |
| Turno con 1 ronda de tools | < 12s |
| Corrida de agente (sin SLA de UI) | < 60s |

**Hallazgo medido (2026-06):** la latencia la domina la generación de output (~60-70 tok/s en Haiku), no el procesamiento del prompt. Palancas en orden: (1) sacar contenido largo del JSON a llamada de texto plano, (2) streaming para time-to-first-word, (3) prompt caching (infra lista; Haiku exige mín 4096 tokens cacheables y el prefijo actual es menor — se activa con Gemini, mín 1024, o crecimiento natural del catálogo).

**Gobernanza de costos (BYOK + agentes = riesgo de boleta sorpresa):**
- Medición por propósito y modelo: implementada (usage-meter)
- Tope diario configurable de gasto total: PENDIENTE
- Tope en dólares por agente con corte automático: PENDIENTE (hoy solo corridas/día)
- Alerta visible en HUD al cruzar umbral: PENDIENTE
- Disclaimer de gasto BYOK en onboarding + límites duros por defecto: el disclaimer solo no defiende; el corte automático sí

### Degraded Mode (obligatorio)

| Escenario | Comportamiento |
|---|---|
| Sin internet | Memoria local, historial, skills locales, borradores |
| Cuota agotada | Fallback de modelo, reducir profundidad, pedir confirmación |
| Google no disponible | Cache local, cola de envío, sincronizar después |
| Voz no disponible | Cambiar a texto, mostrar estado claro |
| Conector roto | Diagnosticar, probar auth, sugerir reparación, mantener resto |

---

## 10. Arquitectura Técnica

### Stack

- **Runtime**: Node.js (base actual) → evaluar Bun + TypeScript en v2
- **UI**: vanilla JS (ES modules) + CSS puro — DECISIÓN: sin frameworks pesados; la modularidad se logra con módulos ES, no con React
- **DB**: JSON files local (actual) → SQLite con AES-256-GCM en v2
- **Modelo**: Gemini (recomendado por costo/accesibilidad) + Anthropic + fallback automático
- **Voz**: Edge TTS (gratuito) + ElevenLabs (premium)
- **Distribución**: Electron para instalable .exe / .dmg

### Módulos Core (ya implementados)

```
src/core/
  event-bus.js          Pub/Sub para toda la arquitectura
  policy-engine.js      Control de permisos y riesgos
  tool-registry.js      Registro centralizado de herramientas
  task-runtime.js       Ejecución de tareas persistentes
  working-memory.js     Memoria de corta duración

src/memory/
  memory-store.js       Almacén persistente con estados
  memory-learning.js    Aprendizaje automático

src/security/
  credential-vault.js   Bóveda local cifrada

src/model/
  gemini-provider.js
  anthropic-provider.js
  model-tools.js

src/connectors/
  google-calendar.js
  google-gmail.js
  google-docs.js
  google-contacts.js

src/voice/
  edge-tts-provider.js
  elevenlabs-provider.js

src/channels/
  telegram-channel.js
```

### Estructura de Módulo (contrato)

```
src/modules/<nombre>/
  manifest.js     id, name, tools, permissions, risks
  tools.js        implementación de herramientas
  presenter.js    cómo presentar resultados
  policies.js     confirmaciones, validaciones
  artifacts.js    tipos de resultado largo
  tests.js        pruebas
```

### Flujo Conversacional

```
1. Usuario envía mensaje
2. ConversationRuntime normaliza (detecta intención)
3. Modelo genera respuesta + tool calls
4. TaskRuntime crea eventos (task_started)
5. ToolRegistry ejecuta herramientas permitidas
6. PolicyEngine bloquea o pide confirmación
7. Modelo genera cierre final con resultados reales
8. Canal recibe: speak (voz) + visual (chat) + toolResults (datos)
9. HUD abre artefacto si resultado es largo
```

---

## 11. Roadmap

### Fase 1 — Fundación ✅
- [x] Event bus, Policy engine, Tool registry, Task runtime
- [x] Credential vault, Memory store v1
- [x] Gemini + Anthropic providers
- [x] Google Calendar, Gmail, Docs, Contacts, Sheets, Tasks
- [x] TTS (Edge + ElevenLabs), Telegram
- [x] HUD shell modular (workspace + activity + dock + paneles flotantes)

### Fase 2 — HUD y Superpoderes P0 (mayormente hecha)
- [x] HUD modular, artefactos, paneles flotantes, YouTube
- [x] Google Workspace base + auth autocurativa
- [x] Bandeja local servida por HTTP (`/inbox/*`) + tool `hud.show_file` (desde cualquier canal, un archivo recibido aparece en el HUD)
- [x] `vision.decode_qr` — decode real de QR (jsqr + jimp, JS puro, apto instalador white-label)
- [x] Espejo de voz Telegram (ver sección 8)
- [x] Canal WhatsApp personal (Baileys, multi-device — no toca sesiones web existentes; canal de conveniencia de Daniel, no producto): tools `wa.link` (QR de vinculación al HUD), `wa.check_messages`, `wa.send_message`. Contrato de procedencia enforced en policy-engine: mensaje dictado literal por el usuario → directo; texto compuesto por el modelo → borrador + confirmación obligatoria (verificación en código vía `isLiteralDictation`, no autodeclaración del modelo). Contenido de mensajes solo en memoria, nunca en logs. Pendiente: vinculación real (escanear QR)
- [x] Reloj único de producto: `src/utils/time.js` (JARVIS_TZ, default America/Santiago) — almacenamiento en UTC ISO, interpretación y display siempre en hora de Chile (scheduler de agentes, presentadores, contexto)
- [ ] Bandeja de aprobaciones visual completa, Dock configurable
- [ ] Ventanas satélite multi-monitor

### Fase 3 — Inteligencia y Memoria Viva (en curso)
- [x] ContextAssembler: ensamblado dinámico de contexto
- [x] Track 2 activo: extracción de principios + **loop de refuerzo gradual** (polaridad afirmación/corrección → ajuste de confianza → candidate/verified/low_confidence)
- [x] Persona core con carácter definido ("compañero con criterio") + campo depth
- [x] Invariantes anti-envenenamiento del aprendizaje (autoridad + procedencia) + identidad arquitectónica en prompt
- [x] Tier 0 ordenado por confianza+recencia; estado `rejected` excluido del contexto
- [x] Persona core en 3 capas (`src/conversation/persona-core.js`): identidad editable (overlay de cliente + perillas numéricas con clamp) / piso de producto invariante / aprendido (memoria). Sin overlay, el perfil es idéntico al de Daniel. Pendiente: panel UI de perillas, voz/avatar al config
- [ ] Memory inspector visual
- [ ] Eval set de comportamiento: conversaciones de prueba que detecten regresiones del aprendizaje
- [ ] **Skill canónico #1: gestionar reunión desde correo** (ver detalle abajo)

### Fase 4 — Agentes y Automatización (v1 ADELANTADA — ver sección 4)
- [x] Fábrica de recetas: store + scheduler + discovery + confirmación + panel HUD
- [x] Notificación de corridas programadas (voz HUD + Telegram)
- [x] Invariante anti-recursión (corridas no gestionan agentes) + go-ahead conversacional cuenta como confirmación (risk high) + confirmaciones duplicadas se reemplazan
- [ ] Presupuesto en $ por agente/día con corte automático, namespace de memoria por agente
- [ ] Skill registry con lifecycle completo, procedural memory
- [ ] Ruteo de modelos por tipo de tarea (barato conversa, fuerte construye)

### Fase 5 — Investigación y Reportes
- Web research con fuentes verificadas
- SEO audit (tool base ya existe: web.audit_seo), reportes exportables
- **Notetaker de reuniones** (bot Meet/Zoom: transcripción + minuta + acuerdos)

### Fase 6 — Conectores externos
- Notion, n8n/Make, CRMs, Analytics, WordPress, Shopify (vía MCP — ver 11b)
- **WhatsApp Business Cloud API** (conector premium). Contexto: en Latam WhatsApp es ~100% de penetración vs ~30% Telegram. Telegram quedó como default por razones técnicas (API gratis, polling local sin webhook público — calza local-first), no de producto. Decisión por canales: Jarvis→dueño puede vivir en Telegram; Jarvis→clientes del negocio (reservas, recordatorios) exige API oficial de WhatsApp sí o sí. Requiere relay mínimo en nube (webhook que solo reenvía a la instancia local, sin procesar ni almacenar). Para clientes la fricción de setup (número + Meta Business + verificación) se ofrece como servicio de instalación asistida cobrable. Librerías no oficiales (Baileys) descartadas para producto comercial: violan ToS de Meta → riesgo de baneo del número del cliente.
- **Modo personal WhatsApp (Baileys)** — SOLO instancia del dueño del producto, nunca licencias: cuenta WhatsApp normal en chip dedicado, vinculada por QR, corriendo 100% local. Sin regla de 24h, recibe fotos/documentos (canal OCR). Riesgo asumido con información completa: baneo = perder un chip prepago. Mitigaciones: registro en teléfono real, solo número del dueño en whitelist, delays humanizados, volumen bajo. Se construye DESPUÉS del combo Telegram — comparte el mismo pipeline de canales.

### Fase 7 — Multi-agente
- Researcher, Analyst, Critic, Operator, Archivist
- Orquestación gobernada con delegación explícita

### Fase 8 — Builder: Jarvis programa módulos
- Contrato de plugin: workspace enjaulado (`plugins/`), manifest (rutas, panel, storage, permisos), sandbox de ejecución
- Loop generar → testear → corregir → registrar con modelo fuerte enrutado
- Caso estrella: CRM local generado por conversación (el "deploy" es interno — Jarvis ya es el server)
- Muro duro: un plugin jamás toca core/vault ni crea otros plugins

### Fase 9 — Verticales especializados
- Pack Dentista, Restaurante, Agencia, Abogado/Contador

### Fase 10 — Autoreparación
- Error monitor, sandbox, rollback, versionado

### Fase 11 — Distribución y Marca Blanca
- Instalador Windows (.exe), macOS (.dmg)
- Actualizador opcional, activación local
- Soporte marca blanca (logo, nombre, colores)
- **Sistema de licencias con inyección de conocimiento** (ver diseño abajo)

---

## 10b. Skill Canónico #1 — Gestionar Reunión desde Correo

### Por qué este skill y no otro

Es el caso de uso más universal del usuario target (agencia, dentista, restaurante, abogado — todos reciben solicitudes de reunión por correo). Requiere exactamente los tres componentes que se terminan en Fase 3: Context Assembler (para saber el historial con el remitente y las preferencias de horario), Track 2 (para aprender si el usuario prefiere confirmar directo o proponer alternativas), y las herramientas Google ya construidas.

### Flujo completo

```
ENTRADA: email de cliente solicitando reunión
  ↓
1. gmail.get_thread        → leer hilo completo, extraer: quién pide, qué fecha/hora, qué motivo
2. memory.search           → ¿quién es este contacto? historial previo, cargo, empresa
3. calendar.list_events    → ¿está disponible ese horario?
   ├─ Sí disponible →
   │    4a. calendar.create_event  → crear evento con contacto como invitado
   │    4b. gmail.create_draft     → redactar confirmación: "Perfecto, quedamos el [fecha]..."
   │    4c. [CONFIRMACIÓN HUMANA]  → mostrar borrador, esperar aprobación
   │    4d. gmail.send_email       → enviar
   └─ No disponible →
        4a. calendar.list_events   → buscar próximos horarios libres (próximos 3 días)
        4b. gmail.create_draft     → "No puedo esa hora, ¿te sirve el [alt1] o [alt2]?"
        4c. [CONFIRMACIÓN HUMANA]
        4d. gmail.send_email
```

### Por qué construirlo en Fase 3 y no antes

Sin el Context Assembler, Jarvis no sabe quién es el remitente más allá del email crudo. Con él, tiene en Tier 2 el historial del contacto, las preferencias de horario del usuario, y el tono correcto para ese cliente específico — la respuesta generada es inteligente, no genérica.

### Variante reactiva (nivel 1) vs proactiva (nivel 2)

**Reactiva:** el digest de correos muestra un badge "REUNIÓN" en emails con ese intent. Un clic pre-carga el contexto en el chat y Jarvis ejecuta el flujo sin que el usuario escriba nada.

**Proactiva:** monitor de inbox en background detecta el email, notifica al usuario ("Pedro quiere reunirse el jueves — ¿gestiono?"), con un solo confirm ejecuta todo.

La versión reactiva se construye en Fase 3. La proactiva requiere el monitor de inbox que va en Fase 4.

---

## 11b. Conectores de Negocio del Cliente (Business Connectors)

### El problema

Un cliente como Vikram (Rishtedar) ya tiene su propio sistema operativo — reservas, órdenes, delivery, KPIs, menú. Jarvis como producto instalable no sabe nada de ese sistema. La pregunta es cómo conectarlos sin que el producto tenga código específico de cada cliente.

### La solución: MCP como protocolo de conexión

**MCP (Model Context Protocol)** es el estándar emergente para exponer herramientas a modelos de lenguaje. La arquitectura es:

```
Sistema del cliente (ej: Rishtedar)
  ↓ implementa
Servidor MCP (/api/mcp o servidor independiente)
  ↓ expone tools en formato estándar
Jarvis (producto instalado en la máquina de Vikram)
  ↓ carga tools al arrancar
Vikram usa Jarvis para operar su restaurante
```

### El License Pack incluye la conexión

El Pack de Licencia de un cliente con sistema propio incluye una sección `connectors`:

```json
{
  "connectors": [
    {
      "type": "mcp",
      "name": "rishtedar-ops",
      "endpoint": "https://rishtedar.cl/api/mcp",
      "authHeader": "Bearer <token-dedicado>",
      "tools": ["reservations.*", "kpis.*", "orders.*", "push.*", "menu.*"]
    }
  ]
}
```

Jarvis carga el MCP al arrancar, descubre las tools disponibles, y el usuario puede usarlas naturalmente desde el HUD.

### Caso concreto — Vikram con Rishtedar

**Lo que Vikram puede pedirle a Jarvis:**

| Pedido natural | Tool Rishtedar | Endpoint |
|---|---|---|
| "Cuántas reservas tengo hoy en Vitacura" | `reservations.today` | `GET /api/reservations/today?branch=vitacura` |
| "Bloquea el viernes en La Reina" | `reservations.blackout` | `POST /api/reservations/blackouts` |
| "Dame el resumen de ventas de esta semana" | `kpis.weekly` | `GET /api/kpis/overview` |
| "Avisa a la cocina de Providencia" | `push.send` | `POST /api/push/send` |
| "Cambia el precio del Butter Chicken" | `menu.update` | `PUT /api/admin/carta/items/[id]` |
| "Cuántos puntos tiene el cliente de este teléfono" | `loyalty.lookup` | `GET /api/staff/customer` |

Todas estas operaciones ya existen en Rishtedar. Solo necesitan exponerse vía MCP.

### Qué necesita implementar el cliente

Para que un cliente conecte su sistema a Jarvis, necesita exponer un endpoint MCP que responda el protocolo estándar (`tools/list`, `tools/call`). Rishtedar podría hacer esto en `app/api/mcp/route.ts` — un adapter sobre las APIs ya existentes.

### Clientes sin sistema propio

No todos los clientes tienen su propio backend. En ese caso:
- Jarvis usa Google Workspace como base (Calendar, Gmail, Sheets)
- El License Pack inyecta memorias de negocio estáticas
- No hay conector MCP — Google es el sistema de registro

### Tiers de integración

No todas las integraciones se construyen igual. Hay tres niveles:

**Tier 1 — Sistemas que el equipo Jarvis construyó**
Controlamos el código → construimos el MCP adapter nosotros mismos.
Ejemplo: Rishtedar. En su repo agregamos `app/api/mcp/route.ts` que expone las operaciones de Vikram como tools MCP. El License Pack apunta a ese endpoint. Nadie más tiene que hacer nada.

**Tier 2 — Herramientas populares con MCP oficial**
Notion, GitHub, Linear, Slack, Figma y otros ya tienen servidores MCP mantenidos por sus propios equipos. Jarvis solo necesita el endpoint y las credenciales en el License Pack. Sin código propio.

```json
{ "type": "mcp", "name": "notion", "endpoint": "https://mcp.notion.so", "auth": "Bearer TOKEN" }
```

**Tier 3 — El resto del universo (n8n, Make, Zapier, cualquier sistema sin MCP)**
Para el cliente que usa 40 herramientas distintas que no tienen MCP, la respuesta es conectar Jarvis a **n8n** (o Make). n8n tiene conectores para prácticamente todo y funciona como adaptador universal.

```
Usuario: "sincroniza los nuevos clientes con Mailchimp"
  → Jarvis invoca workflow n8n: "sync-clientes-mailchimp"
  → n8n ejecuta la integración
  → resultado de vuelta a Jarvis
```

Jarvis no sabe que existe Mailchimp. Solo sabe que hay un workflow con ese nombre. El cliente configura sus workflows en n8n; Jarvis los dispara.

**License Pack con los tres tiers mezclados:**

```json
{
  "connectors": [
    { "type": "mcp",  "name": "rishtedar-ops", "endpoint": "https://rishtedar.cl/api/mcp" },
    { "type": "mcp",  "name": "notion",         "endpoint": "https://mcp.notion.so" },
    { "type": "n8n",  "name": "workflows",      "endpoint": "https://n8n.cliente.internal/webhook" }
  ]
}
```

Jarvis no distingue de dónde vienen las tools — las carga y las usa igual.

### Escalar este patrón

| Tipo de cliente | Conector recomendado |
|---|---|
| Sistema propio (lo construimos nosotros) | Tier 1: MCP adapter en el sistema del cliente |
| Usa Notion, GitHub, Linear | Tier 2: MCP oficial de cada herramienta |
| Usa n8n/Make con sus propios flujos | Tier 3: Jarvis como trigger de workflows |
| Solo Google Workspace | Google connectors nativos de Jarvis |
| Mezcla de todo | Combinación de tiers en el License Pack |

El producto Jarvis no cambia. Lo que cambia es el License Pack y qué connectors trae incluidos.

---

## 12. Sistema de Licencias y Distribución White-Label

### Concepto central

Cada cliente recibe una instalación personalizada de Jarvis sin que pueda clonar ni redistribuir la personalización. La personalización se entrega como un **License Pack** — un bundle cifrado que se activa con una clave única durante el onboarding.

```
Flujo de venta:
  1. Acordar venta con cliente (ej: Vikram — restaurante indio Rishtedar)
  2. Generar License Pack con datos del cliente + conocimiento inyectado
  3. Cliente instala Jarvis (ejecutable genérico, sin personalización)
  4. En el onboarding, ingresa su License Key
  5. Jarvis descifra el pack y se transforma en el asistente de Rishtedar
```

### Estructura del License Pack

```json
{
  "licenseKey": "VK-2026-RESTAURANT-RISHTEDAR",
  "clientName": "Rishtedar",
  "brandName": "RISHI",
  "brandTagline": "El asistente del restaurante",
  "accentColor": "#c4770a",
  "avatarStyle": "warm",
  "voiceProfile": "warm_professional",
  "greeting": "Namaste, Vikram. El sistema está listo.",
  "locale": "es-CL",
  "injectedMemories": [
    { "type": "business_context", "title": "Restaurante Rishtedar",
      "content": { "rubro": "restaurante indio", "sitio": "rishtedar.cl", "especialidad": "cocina india auténtica" } },
    { "type": "preference", "title": "Flujo de reservas",
      "content": { "sistema_reservas": "por definir", "confirmacion_por": "whatsapp y email", "capacidad": "por definir" } }
  ],
  "enabledTools":  ["google.calendar.*", "google.gmail.*", "google.contacts.*"],
  "disabledTools": ["research.*"],
  "onboardingFlow": "restaurant_v1",
  "expiresAt": null,
  "issuedAt": "2026-01-15T00:00:00Z"
}
```

### Mecanismo técnico

**Generación del pack (lado vendedor):**
- Script CLI `npm run generate-license` lee un JSON de config del cliente
- Cifra el pack con AES-256 usando la License Key como seed
- Genera el archivo `license.jrv` para entregar al cliente

**Activación (lado cliente — onboarding):**
1. Pantalla de activación pide la License Key
2. El runtime descifra el pack en `local_data/license.json`
3. `LicenseLoader` inyecta las memorias al `MemoryStore` (state: `verified`, confidence: 1.0)
4. `BrandConfig` reescribe colores, nombre, avatar y saludo en runtime
5. `ToolRegistry` aplica la whitelist/blacklist de herramientas
6. Onboarding personalizado según `onboardingFlow`

**Anti-clonación:**
- El pack cifrado es inútil sin la License Key (que solo el cliente legítimo tiene)
- Los memories inyectados tienen `source: 'license'` — el sistema no los deja editar ni exportar
- La License Key puede ser atada a machine fingerprint en versiones más avanzadas

**Actualización de conocimiento:**
- Para enviar nueva formación al cliente: nuevo pack firmado que se activa con la misma key
- El cliente solo necesita un archivo `.jrv` nuevo — no reinstalar

### Archivos a crear (Fase 11)

```
src/licensing/
  license-generator.js    ← CLI para generar packs (lado vendedor)
  license-loader.js       ← carga, descifra e inyecta en el runtime
  brand-config.js         ← aplica personalización visual desde pack
  onboarding-flows/
    dental_clinic_v1.js   ← preguntas y setup específico por rubro
    restaurant_v1.js
    agency_v1.js
```

---

## 11c. Companion Mode — Jarvis en el Navegador

### El concepto

Una vez que Jarvis existe como .exe / .dmg, el mismo servidor local puede servir un **cliente liviano** accesible desde cualquier pestaña del navegador. El usuario no necesita abrir el HUD completo — tiene a Jarvis disponible donde está trabajando.

```
Jarvis server (local, corre en background)
         ↓  HTTP + WebSocket (misma conexión)
    /hud      → HUD completo (el que existe hoy)
    /companion → cliente liviano en el browser
```

### Qué muestra el Companion

Solo lo esencial para interactuar:
- Avatar / máscara (animada, responde al estado)
- Chat de texto
- Voz (habla y escucha)
- Indicador de estado (procesando / listo / error)

### Qué NO muestra

- Paneles flotantes de correos, agenda, memoria
- Dock con accesos rápidos
- Log de actividad
- Permisos / aprobaciones pendientes

Las acciones reales ocurren igual — Jarvis busca, escribe docs, revisa correos — pero el usuario no ve la "cocina". Solo recibe la respuesta y el resultado.

### Casos de uso

- Trabajar en el browser sin cambiar de contexto (Jarvis como sidebar)
- Clientes white-label que solo necesitan el asistente conversacional, sin el HUD operativo completo
- Dispositivos o pantallas secundarias donde el HUD completo no tiene sentido
- Primeras versiones de Jarvis para perfiles de usuario más simples

### Implementación

El 90% ya existe. Lo que se necesita:

1. Nueva ruta `/companion` en el servidor — sirve una página HTML mínima
2. El cliente liviano conecta al mismo WebSocket que el HUD
3. Solo renderiza chat + avatar + voz — sin paneles, sin dock, sin workspace
4. El servidor no distingue si la respuesta va al HUD o al Companion — el runtime es el mismo

**Estimado de desarrollo:** 1 semana una vez que el HUD esté estable.

### Relación con white-label

El License Pack puede especificar qué cliente activar por defecto:

```json
{ "defaultClient": "companion" }   // solo el asistente conversacional
{ "defaultClient": "hud" }         // HUD completo (default actual)
```

Un cliente como Vikram podría recibir solo el Companion Mode en su instalación — interactúa con Jarvis naturalmente sin ver la infraestructura técnica detrás.

---

## 12b. Referencia: Qué aprovechar de cada repo

### De `jarvis-companion`
- HUD estética Iron Man (rehacerlo modular, no copiar el código)
- Struggle detection (OCR + detección proactiva)
- Desktop automation Win32 (conceptos probados)
- Multi-agente ReAct loop (patrón de iteración)

### De `investigacion/jarvis` (solo como referencia de arquitectura)
- `authority/` — authority engine + audit trail
- `awareness/` — context tracking, suggestion engine
- `personality/` — adaptive learning
- `agents/` — jerarquía, delegación
- Workflow engine (Activepieces vendorizado)

---

## 13. Principios que no se tocan

1. **Local-first** — datos y pensamiento en la máquina del usuario. Siempre.
2. **BYOK** — el usuario paga su API key. Jarvis no cobra por pensar.
3. **Modularidad fuerte** — cada módulo tiene contrato. El runtime central no sabe detalles de Gmail ni YouTube.
4. **Curadería rigurosa** — una memoria pequeña y confiable > una grande con ruido.
5. **Identidad del cliente** — el pack de licencia define quién es Jarvis para ese usuario. Sin pack, es genérico. Con pack, es el asistente de su negocio.
6. **Confirmaciones contextuales** — no pedir confirmación para leer, sí para escribir sensible.
7. **Degraded mode** — si algo falla, Jarvis sigue siendo útil en lo que puede.
8. **Voz activa** — Jarvis nunca se queda callado en tareas largas.
9. **HUD limpio** — nunca apilado, nunca lleno de info al mismo tiempo.
10. **Generalización de bugs** — cada bug es señal del sistema, no caso aislado.
11. **Gobernanza de datos sensibles** — médico/legal/financiero requiere revisión humana.
12. **Autonomía con techo** — los agentes tienen presupuesto duro, kill switch visible y jamás crean otros agentes. El usuario siempre puede ver qué corre en su nombre.
13. **Transparencia de identidad** — si Jarvis actúa frente a terceros (reuniones, correos), los terceros deben poder saber que es un asistente.
