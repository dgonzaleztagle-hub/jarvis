# UX y HUD

## Principio

Jarvis Codex debe sentirse como un sistema operativo personal de inteligencia, no como un dashboard tecnico ni como un chat con botones alrededor.

La pantalla principal debe ser llamativa, pero no debe intentar mostrarlo todo. El HUD tiene que organizar atencion, tareas, resultados y permisos. Si el HUD se convierte en basurero de funcionalidades, el producto pierde su promesa.

## Diagnostico Critico del HUD Actual

El HUD actual sirve como consola de desarrollo, pero no como producto.

Problemas:

- Se apoya demasiado en el chat.
- No tiene un lugar noble para reportes largos.
- No separa bien resultado, progreso, aprobacion y configuracion.
- No se siente como Jarvis; se siente como panel temporal.
- No esta preparado para multiples monitores.
- No esta preparado para camara, gestos o ventanas satelite.
- Puede escalar mal cuando agreguemos YouTube, Google, memoria, agentes, navegador, reportes y archivos.

Decision:

Antes de agregar muchos superpoderes nuevos, hay que construir una shell visual modular.

## Lenguaje de Usuario

El usuario final no necesita ver conceptos como modelo, tier, prompt, fallback, embedding o cuota salvo que active modo avanzado.

Lenguaje recomendado:

- `Conectar Jarvis`
- `Abrir guia`
- `Probar conexion`
- `Conectar Google`
- `Preparar mi negocio`
- `Revisar memoria`
- `Permisos`
- `Tareas`
- `Agenda`
- `Investigacion`
- `Reportes`
- `Superpoderes`

Lenguaje interno:

- API key.
- Modelo.
- Provider.
- Prompt injection.
- Fallback.
- RAG.
- Embeddings.
- Vector store.

## Estructura Visual Base

El HUD debe dividirse en cuatro zonas funcionales.

### 1. Comando

Zona de conversacion, voz y comando rapido.

Debe contener:

- Entrada de texto.
- Estado de escucha.
- Ultima respuesta corta.
- Historial compacto.
- Acceso a voz.

No debe contener:

- Reportes completos.
- Listas largas de correos.
- Auditorias SEO completas.
- Logs tecnicos.
- Configuracion avanzada.

### 2. Workspace

Zona principal para artefactos.

Debe mostrar:

- Reportes.
- Resumenes de correo.
- Agenda.
- Documentos.
- Capturas.
- Resultados de investigacion.
- Previews de navegador o archivos.

Este espacio debe aceptar ventanas internas movibles y redimensionables.

### 3. Actividad

Zona de tareas, progreso y aprobaciones.

Debe mostrar:

- Tareas activas.
- Tareas completadas.
- Progreso.
- Confirmaciones pendientes.
- Errores entendibles.
- Acciones sugeridas.

### 4. Dock de Superpoderes

Accesos rapidos a capacidades frecuentes.

Debe ser configurable y no saturado.

Ejemplos:

- Agenda.
- Correos.
- YouTube.
- Reportes.
- Memoria.
- Archivos.
- Navegador.
- Agentes.
- Permisos.

## Artefactos

Un artefacto es cualquier resultado que merece vivir fuera del chat.

Tipos iniciales:

- `email_digest`
- `calendar_briefing`
- `report`
- `google_doc`
- `web_research`
- `seo_audit`
- `file_list`
- `screenshot`
- `memory_review`
- `task_log`
- `approval`

Reglas:

- Todo artefacto tiene ID.
- Todo artefacto tiene titulo humano.
- Todo artefacto puede reabrirse.
- Todo artefacto puede exportarse cuando aplique.
- Todo artefacto puede enviarse a una ventana satelite si el usuario quiere.
- El chat solo debe anunciar el artefacto, no reemplazarlo.

## Ventanas y Multi-Monitor

Jarvis debe tener un `Window Manager` desde temprano.

Capacidades:

- Abrir artefacto en panel interno.
- Mover panel.
- Redimensionar panel.
- Minimizar panel.
- Fijar panel.
- Abrir panel como ventana satelite con `window.open`.
- Recordar layout local.
- Restaurar layout por tipo de usuario.

Casos:

- Usuario con un monitor: usa workspace central con paneles internos.
- Usuario con dos monitores: puede sacar reportes, navegador o agenda a una ventana satelite.
- Usuario en notebook: usa una vista compacta con tabs.

Regla:

No se deben abrir ventanas satelite sin accion explicita del usuario.

## Gestos y Camara

La camara no debe agregarse como parche estetico. Debe tratarse como un modulo de input.

Modulo futuro:

- `gesture.input`

Gestos razonables:

- Abrir comando.
- Cerrar/minimizar panel.
- Pasar al siguiente panel.
- Pausar/reanudar escucha.
- Confirmar seleccion de bajo riesgo.
- Hacer zoom o scroll sobre un artefacto.

Limitaciones:

- Acciones destructivas, envios externos y compras nunca se confirman solo con gesto.
- Si no hay camara o el rendimiento baja, el HUD debe seguir funcionando perfecto con mouse, teclado y voz.
- El procesamiento debe ser local cuando sea posible.

## Onboarding

El onboarding debe parecer una instalacion guiada, no una configuracion tecnica.

Pasos base:

1. Bienvenida e identidad.
2. Nombre del usuario o negocio.
3. Rubro principal.
4. Conectar Jarvis.
5. Conectar Google.
6. Definir permisos.
7. Investigacion inicial del nicho.
8. Revision de memoria inicial.
9. Activacion del HUD.

## Reglas Contra Saturacion

- No meter todas las capacidades en la pantalla principal.
- No explicar tecnologia interna en textos visibles.
- No mostrar ejemplos cuando deberia haber acciones reales.
- No usar modales tecnicos para usuarios normales.
- No confundir configuracion inicial con panel de desarrollador.
- No convertir el chat en informe.
- No poner paneles dentro de paneles.
- No agregar un nuevo poder si no tiene una superficie visual asignada.

## Legibilidad Humana

Jarvis debe decidir como se lee mejor cada respuesta antes de mostrarla.

Formatos base:

- `brief`: una respuesta corta.
- `list`: elementos revisables como correos, eventos, tareas, archivos o contactos.
- `table`: comparaciones, precios, alternativas o datos con columnas.
- `sections`: reportes, auditorias, investigaciones o analisis.
- `artifact`: resultados largos que deben vivir fuera del chat.

Reglas:

- Si el usuario pide elementos, usar lista.
- Si el usuario pide comparar, usar tabla.
- Si el usuario pide analizar o auditar, usar secciones.
- Si el resultado es largo, crear artefacto.
- La voz debe resumir; la pantalla debe organizar.

## Valor de Salida

Jarvis debe distinguir entre mostrar datos y generar valor.

Tipos:

- `inspection`: muestra elementos completos y ordenados.
- `summary`: sintetiza lo importante.
- `analysis`: interpreta y recomienda.
- `comparison`: compara criterios y alternativas.
- `response`: responde directo.

Regla critica:

No llamar resumen a un snippet, extracto o texto truncado. Un resumen debe demostrar que Jarvis entendio el contenido y extrajo lo importante para el usuario.

## Triage y Decision

Cuando Jarvis revisa informacion, debe ayudar a decidir.

Campos utiles:

- Tipo o categoria.
- Nivel de atencion.
- Por que importa.
- Accion sugerida.
- Opcion de abrir/ver completo.

Esto aplica a correos, agenda, archivos, alertas, reportes, leads, tareas, oportunidades, riesgos y cualquier bandeja de elementos.

## Primera Meta de Rediseno

Antes de crecer en conectores, el HUD debe soportar:

- Chat/comando compacto.
- Workspace de artefactos.
- Panel de actividad.
- Bandeja de aprobaciones.
- Dock de superpoderes.
- Visor de correos ordenado.
- Visor de agenda.
- Visor de reportes.
- Preparacion para ventanas satelite.

Esta no es una mejora cosmetica. Es infraestructura de producto.
