# Auditoria de Alineacion con PRD

## Objetivo

Contrastar el estado actual de `jarvis-codex` con la vision del PRD y detectar desalineaciones de prioridad, arquitectura y experiencia.

Esta auditoria no busca celebrar progreso. Busca corregir rumbo antes de seguir agregando capacidades.

## Resumen Honesto

Jarvis Codex ya tiene una base tecnica mejor de lo que parecia al inicio:

- Runtime local gobernado.
- Task runtime con eventos.
- Politicas de riesgo.
- Google Calendar, Gmail, Docs y Contacts.
- Memoria persistente util.
- Voz, microfono y manos libres funcionando.
- Presenters y formatos mas legibles.
- Recuperacion parcial ante respuestas defectuosas del modelo.

Pero todavia hay una brecha importante entre lo construido y lo prometido por el PRD.

La principal desalineacion no es tecnica sino de enfoque:

- Se construyo demasiado desde la consola de desarrollo.
- Se reacciono demasiado a fallos puntuales.
- Se llego tarde a ideas que el PRD ya declaraba como nucleares:
  - conocimiento operativo del propio Jarvis
  - modularidad visual real
  - artefactos fuera del chat
  - continuidad multietapa
  - complejidad invisible para el usuario final

En otras palabras: la base ya no esta rota, pero todavia piensa demasiado como prototipo y no suficiente como producto.

## 1. Alineacion Alta

Estas zonas ya van en la direccion correcta del PRD.

### 1.1 Runtime gobernado

El PRD pide:

- Tool registry.
- Policy engine.
- Task runtime.
- Event bus.
- Riesgo por accion.
- Confirmacion para acciones delicadas.

Estado actual:

- Implementado en capas separadas.
- Ya no dependemos de un executor monolitico.
- El sistema distingue riesgo y puede pedir confirmacion.
- Hay eventos persistidos en vivo para tareas.

Diagnostico:

- Bien encaminado.
- Esta es una de las partes mas alineadas con la vision.

### 1.2 Integracion Google como dominio premium

El PRD pide que Google sea esencial y que agenda sea columna vertebral.

Estado actual:

- Calendar, Gmail, Docs y Contacts operativos.
- Gmail ya tiene mejores cierres, listas y triage base.
- El sistema puede enviar correos, leer correos, crear documentos y eventos.

Diagnostico:

- Correcto como prioridad.
- Aun falta curaduria mas profunda por dominio, pero la direccion es buena.

### 1.3 Memoria util y no solo decorativa

El PRD pide memoria evolutiva, verificable y reutilizable.

Estado actual:

- Memoria persistente local.
- Historial corto en runtime.
- Recuperacion previa al prompt.
- Separacion inicial por intencion.
- Autoconocimiento operativo sincronizado desde tools reales.

Diagnostico:

- Ya influye decisiones reales.
- Aun no alcanza el nivel de knowledge graph ni curaduria fuerte del PRD.
- Pero ya dejo de ser placebo.

### 1.4 Voz multietapa

El PRD pide escucha, respuesta audible, progreso y continuidad.

Estado actual:

- Voz de salida funcional.
- Microfono funcional en Chrome.
- Manos libres funcional, aunque todavia sensible de UX.
- El sistema ya puede seguir hablando despues de ejecutar.

Diagnostico:

- La direccion es correcta.
- Aun falta convertirlo en una voice rail de producto.

## 2. Alineacion Parcial

Estas zonas existen, pero todavia estan a medio camino o mal materializadas.

### 2.1 Protocolo conversacional multietapa

El PRD pide:

- recepcion
- plan breve
- progreso
- resultado
- seguimiento

Estado actual:

- Ya no se queda callado tan facil.
- Algunas tareas cierran bien.
- Existen eventos asincronos.

Pero:

- El progreso no se presenta de forma consistente ni noble.
- El resultado todavia depende demasiado del chat.
- El seguimiento aun no es sistematico.

Diagnostico:

- Corregido en parte.
- Todavia no consolidado como contrato universal.

### 2.2 Complejidad invisible

El PRD dice que el usuario no debe ver detalles internos, modelos o cosas de desarrollo.

Estado actual:

- Mejoramos bastante el lenguaje visible.
- Pero el HUD sigue mostrando estructuras internas:
  - actividad cruda
  - herramientas
  - eventos
  - configuraciones que parecen panel tecnico

Diagnostico:

- Seguimos demasiado cerca del tablero de desarrollo.

### 2.3 Modularidad visual

El PRD y `UX_AND_HUD.md` piden:

- comando compacto
- workspace de artefactos
- actividad
- dock de superpoderes
- resultados largos fuera del chat

Estado actual:

- Tenemos solo una aproximacion visual basica.
- Sigue predominando el chat.
- Todavia no existe un verdadero workspace de artefactos.
- Personalizacion, actividad y herramientas compiten por espacio sin jerarquia fuerte.

Diagnostico:

- Esta es la deuda visual mas grande del producto.

### 2.4 Aprendizaje continuo con criterio

El PRD pide distinguir:

- dato confirmado
- inferencia
- preferencia
- suposicion
- temporalidad
- obsolescencia

Estado actual:

- Ya hay menos ruido que antes.
- Hay estados de memoria.
- Hay aprendizaje de preferencias y contactos.

Pero:

- No hay aun una curaduria lo bastante madura.
- No hay inspector de memoria real para usuario.
- No hay relaciones ricas entre entidades.

Diagnostico:

- La base sirve.
- Todavia no cumple la promesa completa del PRD.

## 3. Desalineaciones Reales

Aqui estan las cosas que no se ejecutaron bien desde el principio.

### 3.1 Se privilegio demasiado el arreglo puntual por sobre la estructura general

El usuario pidio varias veces pensar en generalizacion, no en bugs aislados.

Lo que paso:

- Durante varias iteraciones se corrigio el caso especifico visible.
- Solo despues se fue subiendo a patrones mas generales.

Impacto:

- Perdimos tiempo reabriendo el mismo problema bajo otra forma.
- Varias mejoras llegaron tarde aunque el PRD ya sugeria el enfoque correcto.

Correccion:

- Cada bug visible debe activar una pregunta obligatoria:
  - esto es de herramienta
  - de presenter
  - de runtime
  - de memoria
  - de formato
  - de HUD

### 3.2 Se construyo demasiado desde la seguridad por freno

El PRD habla de autonomia con gobierno, no de burocracia.

Lo que paso:

- Al principio se resolvieron riesgos con demasiada confirmacion y rigidez.

Impacto:

- Jarvis se sintio torpe.
- La experiencia parecia menos inteligente de lo que podia ser.

Correccion:

- Confirmacion solo para verdadero impacto.
- Criterio interno fuerte para todo lo demas.

### 3.3 El autoconocimiento del propio Jarvis debio ser core antes

El PRD ya sugiere reduccion de dependencia externa, self-knowledge y skill promotion.

Lo que paso:

- Al inicio Jarvis no sabia bien lo que podia hacer.
- Respondia sobre capacidades desde aire o desde el modelo.
- Solo despues se sincronizo conocimiento operativo desde el runtime.

Impacto:

- Respuestas pobres sobre capacidades.
- Desperdicio de tokens.
- Menor sensacion de inteligencia interna.

Correccion:

- El estado del sistema debe ser memoria operativa de primer nivel.

### 3.4 La UX se penso tarde como producto

El PRD es clarisimo: no dashboard tecnico, no pantalla unica saturada, no explicacion interna.

Lo que paso:

- Primero se hizo un HUD util para desarrollo.
- Despues se le fue maquillando.

Impacto:

- La experiencia se sintio basica y fragmentada.
- Modulos como personalizacion quedaron visibles cuando deberian ser onboarding o configuracion secundaria.

Correccion:

- Dejar de agregar paneles como parche.
- Diseñar shell de producto antes de seguir acumulando poder bruto.

### 3.5 Los artefactos siguen atrasados respecto al PRD

El PRD pide que resultados largos vivan fuera del chat.

Estado actual:

- Mejoramos formato.
- Pero el chat sigue cargando demasiado peso.

Impacto:

- Correos, reportes, listas y revisiones siguen dependiendo de mensajes largos.

Correccion:

- El siguiente gran hito de UX no es otro panel.
- Es el `artifact workspace`.

## 4. Cambio de Directrices para los Siguientes Pasos

Desde ahora, la ejecucion deberia obedecer estas directrices.

### 4.1 Primero producto, luego poder nuevo

No seguir sumando superpoderes encima de un HUD interino.

Nueva prioridad:

1. Shell modular real.
2. Workspace de artefactos.
3. Bandeja de aprobaciones legible.
4. Personalizacion fuera del HUD principal cuando ya este configurada.

### 4.2 Primero contratos generales, luego prompts puntuales

No resolver cada fallo de lenguaje con un caso especial nuevo.

Nueva prioridad:

- contratos de salida
- contratos de seguimiento
- contratos de cierre
- contratos de artefacto
- contratos de triage por dominio

### 4.3 Google debe seguir siendo curado, pero como familia de producto

No basta con arreglar Gmail por separado.

Nueva prioridad:

- `Gmail experience`
- `Calendar experience`
- `Docs/Drive experience`
- `Contacts resolution`

Cada una con:

- lectura humana
- analisis
- sugerencia de accion
- accion segura
- continuidad posterior

### 4.4 La memoria debe seguir optimizandose, pero sin rigidizar la mente

Nueva prioridad:

- separar memoria factual, preferencial, operacional y episodica
- resumir memoria para prompt sin matar flexibilidad
- mejorar relaciones
- revisar obsolescencia
- crear inspector de memoria

### 4.5 Voz y personalizacion deben pasar a ser experiencia de configuracion

El modulo de voz no deberia quedar ocupando espacio noble para siempre.

Nueva prioridad:

- tratar voz como onboarding/configuracion
- esconder o colapsar personalizacion tras guardar
- reabrir solo desde configuracion o modo avanzado

## 5. Proximo Orden Recomendado

Este deberia ser el orden de trabajo, no por capricho sino por coherencia con el PRD.

### Paso 1 - Artifact Workspace

Construir superficie real para:

- digest de correos
- briefing de agenda
- reportes
- resultados de investigacion
- aprobaciones

Sin esto, el chat seguira saturado.

### Paso 2 - Activity / Approvals UX

Convertir actividad en algo humano:

- progreso real
- confirmaciones claras
- errores accionables
- cierre visible

No una lista tecnica de tareas.

### Paso 3 - Google Product Surface

Dar vista propia a:

- correos
- agenda
- documentos

Para que Jarvis no solo "responda", sino que opere con una interfaz digna.

### Paso 4 - Memory Inspector

Permitir ver:

- que sabe Jarvis
- que aprendio
- con que confianza
- de donde salio
- como corregirlo

### Paso 5 - Model Router y costo humano

El PRD insiste en economia de tokens.

Hace falta:

- router real por tipo de tarea
- capas de contexto mas medidas
- costo visible en lenguaje humano

## 6. Conclusiones

Jarvis Codex no esta mal encaminado.

Pero si seguimos sumando funciones sobre el estado actual, corremos dos riesgos:

- terminar con un prototipo poderoso pero visualmente torpe
- seguir parcheando sintomas en vez de consolidar la arquitectura de producto que el PRD ya definio

La conclusion mas importante es esta:

El proximo salto correcto no es otro conector ni otro juguete.
Es convertir la base actual en una experiencia que ya se comporte como Jarvis y no como laboratorio.
