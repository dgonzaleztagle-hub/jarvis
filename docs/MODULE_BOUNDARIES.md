# Limites de Modulos

## Principio

Jarvis Codex debe crecer por modulos, no por acumulacion en un archivo central.

El runtime central no debe saber los detalles de YouTube, Gmail, Calendar, Spotify, OCR, Telegram o memoria profunda. Debe saber registrar modulos, ejecutar herramientas, aplicar politicas y emitir eventos.

## Arquitectura Modular

Cada modulo debe poder incluir:

- Manifest.
- Tools.
- Aliases de intencion.
- Presenters.
- Policies.
- Artifact views si genera resultados largos.
- Tests.
- Migrations si aplica.
- Documentacion interna para el agente.

Estructura sugerida:

```text
src/modules/<module-name>/
  manifest.js
  tools.js
  presenter.js
  policies.js
  artifacts.js
  tests.js
```

## Manifest de Modulo

Un manifest debe declarar:

- `id`
- `name`
- `description`
- `category`
- `tools`
- `permissions`
- `risks`
- `superpowers`
- `artifactTypes`
- `defaultSurface`

## Regla Contra Monolitos

Ningun archivo deberia crecer indefinidamente por agregar poderes.

Riesgos actuales:

- `ConversationRuntime` ya tiene logica de presentacion por dominio.
- Si seguimos agregando cierres ahi, sera el nuevo monolito.
- El catalogo de superpoderes no debe convertirse en prompt gigante.

Decision:

- Mover presentacion a `PresenterRegistry`.
- Mover paquetes de capacidades a modulos.
- Mantener `ToolRegistry` como capa de ejecucion, no como catalogo de producto.

## Separacion de Responsabilidades

### Runtime central

- Tareas.
- Eventos.
- Registro de herramientas.
- Politicas.
- Logs.
- Confirmaciones.

### Modulo

- Herramientas especificas.
- Aliases especificos.
- Validacion especifica.
- Presentacion especifica.
- Artefactos especificos.
- Pruebas especificas.

### Superpoder

- Nombre visible para usuario.
- Intenciones naturales.
- Combinacion de herramientas.
- Resultado esperado.

## Ejemplo

Superpoder:

- "Reproduce una cancion en YouTube"

Modulo:

- `youtube`

Tools:

- `youtube.open`
- `youtube.search`
- `youtube.play_result`

Presenter:

- "Encontré X y lo dejé reproduciendo."

Policies:

- Bajo riesgo para reproducir.
- Confirmacion si abre sitios externos desconocidos.

Tests:

- Buscar cancion.
- Buscar artista.
- Manejar cero resultados.
- No reproducir si YouTube no carga.

## Modulos Base Propuestos

| Modulo | Responsabilidad | Superpoderes iniciales |
| --- | --- | --- |
| `conversation` | interpretar comandos, mantener turnos, no quedarse callado | chat, respuestas multietapa |
| `voice` | escuchar, hablar, interrupcion, avisos | comandos por voz, cierre audible |
| `artifacts` | crear y persistir resultados fuera del chat | reportes, correos, agenda |
| `google.gmail` | correo | ultimos correos, busqueda, borradores |
| `google.calendar` | agenda | agenda, crear eventos, briefings |
| `google.docs` | documentos | crear reportes |
| `google.contacts` | contactos | buscar contacto |
| `media.youtube` | YouTube | abrir, buscar, reproducir |
| `local.pc` | control local simple | volumen, temporizador |
| `files.manager` | archivos | buscar, listar, mover/copiar con confirmacion |
| `browser.operator` | navegacion web controlada | abrir sitio, extraer pagina, operar dashboard |
| `research.web` | investigacion con fuentes | investigar, comparar, verificar |
| `seo.audit` | auditoria web | auditoria SEO |
| `desktop.automation` | teclado/mouse/ventanas | acciones visuales con confirmacion |
| `gesture.input` | camara y gestos | control del HUD |
| `agents.runtime` | agentes gobernados | researcher, analyst, operator |

## Regla de Superficie Visual

Cada modulo debe declarar donde vive su resultado por defecto:

- `chat`: respuesta corta.
- `workspace`: artefacto o visor.
- `activity`: tarea, progreso o aprobacion.
- `settings`: configuracion.
- `satellite`: candidato a ventana externa.

Si un modulo no declara superficie visual, no esta listo para producto.
