# Catálogo de Módulos Base y Superficie Visual

> Referencia técnica enlazada desde PRD.md §10 (Arquitectura Técnica → Estructura de Módulo).
> El contrato de módulo (manifest/tools/presenter/policies/artifacts/tests) vive en el PRD; este
> documento es solo el catálogo vivo de módulos propuestos y su superficie visual por defecto.

## Módulos Base Propuestos

| Módulo | Responsabilidad | Superpoderes iniciales |
| --- | --- | --- |
| `conversation` | interpretar comandos, mantener turnos, no quedarse callado | chat, respuestas multietapa |
| `voice` | escuchar, hablar, interrupción, avisos | comandos por voz, cierre audible |
| `artifacts` | crear y persistir resultados fuera del chat | reportes, correos, agenda |
| `google.gmail` | correo | últimos correos, búsqueda, borradores |
| `google.calendar` | agenda | agenda, crear eventos, briefings |
| `google.docs` | documentos | crear reportes |
| `google.contacts` | contactos | buscar contacto |
| `media.youtube` | YouTube | abrir, buscar, reproducir |
| `local.pc` | control local simple | volumen, temporizador |
| `files.manager` | archivos | buscar, listar, mover/copiar con confirmación |
| `browser.operator` | navegación web controlada | abrir sitio, extraer página, operar dashboard |
| `research.web` | investigación con fuentes | investigar, comparar, verificar |
| `seo.audit` | auditoría web | auditoría SEO |
| `desktop.automation` | teclado/mouse/ventanas | acciones visuales con confirmación |
| `gesture.input` | cámara y gestos | control del HUD |
| `agents.runtime` | agentes gobernados | researcher, analyst, operator |

## Regla de Superficie Visual

Cada módulo debe declarar dónde vive su resultado por defecto:

- `chat`: respuesta corta.
- `workspace`: artefacto o visor.
- `activity`: tarea, progreso o aprobación.
- `settings`: configuración.
- `satellite`: candidato a ventana externa.

Si un módulo no declara superficie visual, no está listo para producto.
