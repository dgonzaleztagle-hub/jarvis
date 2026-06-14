# Catalogo de Superpoderes Base

## Principio

Los superpoderes son capacidades visibles para el usuario final. Deben sentirse como acciones naturales de Jarvis, no como APIs, herramientas internas ni menus tecnicos.

Internamente, cada superpoder debe mapearse a modulos pequenos, contratos de ejecucion, permisos, presentadores, pruebas y eventos. Si un poder no tiene dueno modular, no se implementa todavia.

## Regla de Producto

La primera version necesita dos tipos de poder:

- Poderes juguete: hacen que el usuario pruebe Jarvis por curiosidad y placer.
- Poderes productivos: resuelven trabajo real y justifican el uso diario.

Ambos deben funcionar impecablemente. Un poder juguete que falla tambien destruye confianza, porque para el usuario no existe la distincion entre "demo divertida" y "capacidad seria": todo es Jarvis.

## Contrato de Superpoder

Cada superpoder debe declarar:

- Nombre visible.
- Frases naturales que lo activan.
- Modulo responsable.
- Herramientas internas.
- Permisos requeridos.
- Riesgo.
- Confirmacion requerida.
- Presentador de respuesta.
- Tipo de artefacto si genera resultado largo.
- Modo degradado.
- Pruebas obligatorias.

## Inventario Heredado de Jarvis 1.0

El prototipo anterior ya traia un conjunto amplio de capacidades. No deben migrarse como un bloque; deben convertirse en modulos con ownership claro.

| Area | Poderes heredados | Modulo destino |
| --- | --- | --- |
| Gmail | listar correos, enviar correo | `google.gmail` |
| Contactos | buscar contacto | `google.contacts` |
| Notas | crear nota local | `notes` |
| PC | ajustar volumen, temporizador, recordatorio | `local.pc` |
| Metas | crear objetivo, evaluar objetivo, replanificar | `goals` |
| Escritorio | enfocar ventana, click por texto, escribir texto, teclas | `desktop.automation` |
| Desarrollo | escribir archivo, ejecutar codigo, crear proyecto | `developer.sandbox` |
| Juegos | lanzar juego | `local.apps` |
| Agentes | crear agente | `agents.runtime` |
| WhatsApp | enviar mensaje | `messaging.whatsapp` |
| Vision | captura y lectura de pantalla | `vision.screen` |
| Archivos | listar, borrar, copiar, mover, revisar disco | `files.manager` |
| Investigacion | deep research | `research.web` |
| Navegador | abrir, click, escribir, capturar, extraer, cerrar | `browser.operator` |
| Google Docs | crear documento | `google.docs` |

## Matriz de Prioridad

### P0 - Primera Sensacion de Producto

Estos poderes deben quedar antes de seguir expandiendo. Son los que hacen que Jarvis se sienta vivo, util y confiable.

| Poder visible | Modulo | Presentacion esperada | Riesgo |
| --- | --- | --- | --- |
| Hablar con Jarvis sin que se quede callado | `conversation` + `voice` | respuesta breve + eventos de progreso + cierre | bajo |
| Revisar mis ultimos N correos | `google.gmail` | resumen ordenado en artefacto de correo | read_only |
| Revisar mi agenda de hoy/manana/semana | `google.calendar` | briefing de agenda en artefacto | read_only |
| Crear evento | `google.calendar` | confirmacion previa + evento creado | low_write |
| Buscar contacto | `google.contacts` | ficha compacta de contacto | read_only |
| Crear documento o reporte | `google.docs` | artefacto + enlace al documento | low_write |
| Crear nota local | `notes` | nota guardada + ubicacion | low_write |
| Abrir YouTube | `media.youtube` | accion directa + estado | bajo |
| Buscar/reproducir en YouTube | `media.youtube` | resultado elegido + reproduccion | bajo |
| Subir/bajar/silenciar volumen | `local.pc` | accion directa + estado | bajo |
| Crear temporizador o recordatorio | `local.pc` + `reminders` | confirmacion visible + aviso futuro | bajo |
| Ver mi pantalla | `vision.screen` | captura/OCR como artefacto visual | read_only |

### P1 - Trabajo Real y Retencion

Estos poderes convierten el producto en herramienta diaria.

| Poder visible | Modulo | Presentacion esperada | Riesgo |
| --- | --- | --- | --- |
| Preparar briefing para una reunion | `agenda.briefing` | artefacto de briefing + fuentes internas | read_only |
| Resumir correos por tema o remitente | `google.gmail` | bandeja filtrada + resumen | read_only |
| Redactar respuesta de correo | `google.gmail` | borrador + aprobacion | external_send |
| Enviar correo | `google.gmail` | aprobacion obligatoria | external_send |
| Leer una pagina y resumirla | `browser.operator` + `research.web` | artefacto de lectura | read_only |
| Investigar un tema con fuentes | `research.web` | reporte con fuentes y confianza | read_only |
| Auditoria SEO basica | `seo.audit` | reporte fuera del chat | read_only |
| Buscar archivos locales | `files.manager` | lista ordenada + acciones | read_only |
| Mover/copiar archivos | `files.manager` | simulacion + confirmacion | destructive |
| Controlar navegador | `browser.operator` | tarea persistente + capturas | system_control |
| Telegram como canal | `messaging.telegram` | continuidad conversacional | external_send |
| Abrir apps comunes | `local.apps` | accion directa | bajo |

### P2 - Diferenciacion Avanzada

Estos poderes son importantes, pero deben entrar despues de tener HUD, permisos y observabilidad mas maduros.

| Poder visible | Modulo | Presentacion esperada | Riesgo |
| --- | --- | --- | --- |
| Operar dashboards de clientes | `browser.operator` + conectores | tarea guiada + capturas + aprobaciones | system_control |
| Conectar Notion | `connectors.notion` | panel de conector + permisos | low_write |
| Conectar n8n | `connectors.n8n` | panel de workflows | low_write |
| Crear agente especializado | `agents.runtime` | ficha de agente + presupuesto + permisos | variable |
| Crear o modificar codigo | `developer.sandbox` | diff, tests, aprobacion | code_execution |
| Crear sitio web | `developer.sandbox` | preview + archivos + pruebas | code_execution |
| WhatsApp | `messaging.whatsapp` | envio con aprobacion | external_send |
| Spotify y streaming | `media.spotify` | accion directa | bajo |
| Gestos con camara | `gesture.input` | comandos de HUD, no acciones criticas sin confirmacion | system_control |
| NotebookLM como fuente asistida | `research.notebooklm` | importacion curada a memoria candidata | read_only |

## Reglas de Presentacion

El chat no debe ser el contenedor final de todo.

- Respuestas cortas: pueden vivir en chat.
- Resultados largos: deben abrir un artefacto.
- Tareas en curso: deben vivir en panel de tareas.
- Acciones riesgosas: deben ir a bandeja de aprobaciones.
- Reportes: deben abrirse en visor de reportes.
- Datos ordenados, como correos o agenda: deben ir a vistas especializadas.

Ejemplo:

El usuario dice: "revisa mis ultimos 2 correos".

Jarvis debe:

1. Normalizar `ultimos 2` como limite duro.
2. Consultar Gmail.
3. Ordenar por fecha descendente.
4. Crear un artefacto de email digest.
5. Responder en chat con una frase corta.
6. Mostrar los 2 correos en una ventana o panel de resultado.

No debe entregar 5 correos, no debe mezclar orden, no debe botar todo como texto largo en el chat.

## Criterio de Aceptacion

Un superpoder no se considera listo porque funciono una vez. Se considera listo cuando:

- Respeta cantidades, fechas y parametros.
- Tiene presentacion especifica, no texto bruto.
- Tiene logs.
- Tiene modo de error claro.
- Tiene prueba automatizada o test manual documentado.
- No depende de un segundo llamado al LLM si ya tiene datos estructurados.
- No salta permisos ni confirmaciones.
- Emite eventos de inicio, progreso, resultado y fallo.
- Puede ser desactivado o degradado sin romper el resto del sistema.
