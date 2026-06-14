# Aprendizajes de Ingenieria

Este documento guarda reglas aprendidas durante las sesiones para no repetir errores al construir Jarvis Codex.

## 0. No arreglar solo el ejemplo

Cada correccion debe generalizarse.

Protocolo:

1. Corregir el caso puntual.
2. Detectar el patron general.
3. Convertirlo en contrato, test, presenter, prompt, documento o arquitectura.

Regla:

- Si el usuario reporta un problema en Gmail, revisar si tambien aplica a agenda, archivos, reportes, investigacion, navegador, memoria y agentes.
- Si el usuario reporta un problema de formato, revisar si es un problema de legibilidad humana.
- Si el usuario reporta falta de valor, revisar si Jarvis esta mostrando datos en vez de pensar.
- Si el usuario reporta silencio o ambiguedad, revisar eventos, tareas y cierre multietapa.

Documento operativo: [Protocolo de Generalizacion de Bugs](BUG_GENERALIZATION_PROTOCOL.md).

## 1. Un bug puntual puede revelar una falla sistemica

Caso: el usuario pidio "ultimos dos correos" y Jarvis devolvio cinco.

Causa inmediata:

- Gemini envio `max_results: 2`.
- La herramienta Gmail esperaba `maxResults`.
- Al no reconocer el parametro, uso default `5`.

Aprendizaje general:

- El modelo no debe cargar con conocer nombres exactos de parametros internos.
- Todas las herramientas necesitan normalizacion de input.
- Los conectores deben declarar aliases y campos requeridos.
- El runtime debe validar antes de ejecutar.

Decision aplicada:

- Se agrego `input-normalizer`.
- `ToolRegistry` normaliza aliases antes de ejecutar.
- `ToolRegistry` valida campos requeridos.
- Google Calendar, Gmail, Docs y Contacts declaran aliases/requeridos.

## 2. La respuesta final no debe depender siempre del LLM

Caso: Gmail leyo correos correctamente, pero Gemini fallo con `429` al generar el cierre.

Aprendizaje general:

- Si una herramienta devuelve datos estructurados, Jarvis debe poder cerrar deterministicamente.
- El LLM puede embellecer o resumir, pero no debe ser obligatorio para decir "hice X y encontre Y".
- Las herramientas importantes deben tener presentadores de dominio.

Estado actual:

- Calendar, Gmail y Contacts tienen cierre deterministico via `PresenterRegistry`.

Deuda:

- Convertir cada grupo de presentadores en parte del modulo correspondiente.
- Evitar que `PresenterRegistry` se vuelva otro catalogo central gigante.

## 3. El HUD feo no es solo estetica

El HUD actual es minimo y util para probar, pero no representa la experiencia final.

Aprendizaje general:

- Un HUD malo puede hacer parecer tonto a un runtime que si funciona.
- La presentacion debe ser parte del contrato de cada tramo.
- No basta con devolver JSON correcto.

## 4. Los logs son parte del producto

Sin logs persistentes, los errores parecen fantasmas.

Decision aplicada:

- Se agrego `runtime.jsonl`.
- Se agrego `/logs`.
- Se redactan secretos por clave sensible.

## 5. No avanzar si el tramo actual se siente mal

Metodologia:

1. Construir tramo pequeno.
2. Probar como usuario real.
3. Reportar peros.
4. Buscar bug puntual, patron y riesgo general.
5. Pulir.
6. Recién avanzar.

Esta regla aplica incluso si tecnicamente "ya funciona".

## 6. Los superpoderes deben ser modulos, no una lista gigante

El usuario necesita poderes visibles: abrir YouTube, reproducir musica, revisar correos, manejar agenda, crear docs, etc.

Aprendizaje general:

- El catalogo de superpoderes es producto.
- Las herramientas son implementacion.
- Los modulos son el limite arquitectonico.

Regla:

- Un superpoder debe mapear a modulo + tools + presenter + policies + tests.
- No se deben meter todos los poderes en el prompt.
- No se deben meter todos los poderes en `ConversationRuntime`.
- No se deben meter todos los poderes en un `action-executor` gigante.

## 7. Cada poder necesita una superficie visual

Un bug como "pidio dos correos y entrego cinco" no es solo una falla de Gmail. Puede revelar problemas de normalizacion, contrato de herramienta, presentacion, artefactos, estado de tarea y UX.

Aprendizaje general:

- Cada superpoder debe declarar modulo, permisos, presentador, artefacto y superficie visual.
- El chat no debe cargar resultados largos.
- Antes de sumar muchos poderes nuevos, el HUD necesita workspace, activity panel, dock y artefactos.
- Las ventanas satelite y los gestos deben disenarse como infraestructura temprana, no como parche posterior.

## 8. Probar Haiku como cerebro unico antes de rutear

Para evaluar si Jarvis puede operar con un costo razonable, se configuro Anthropic `claude-haiku-4-5` como modelo principal de pruebas.

Aprendizaje esperado:

- Medir costo real por interaccion.
- Detectar si Haiku entiende herramientas, limites y JSON con suficiente consistencia.
- No asumir que necesitamos Sonnet/Opus hasta tener fallas concretas.
- Guardar evidencia de tareas donde Haiku sea insuficiente antes de escalar modelo.

## 9. Las listas deben verse como listas

Cuando el usuario pide elementos, como correos, eventos, archivos o tareas, Jarvis debe responder con una lista escaneable.

Regla:

- No entregar resultados de inspeccion como parrafo unico.
- Preservar saltos de linea en el HUD.
- Usar bullets o numeracion para atributos.
- Reservar texto narrativo para cierres breves, no para datos revisables.

## 10. Jarvis debe razonar la forma, no solo el contenido

El modelo y los presenters deben pensar como una persona que mira una pantalla.

Regla:

- Primero decidir que tipo de informacion se esta entregando.
- Elegir formato segun lectura humana: breve, lista, tabla, secciones o artefacto.
- Separar voz de pantalla: `speak` corto, `visual` estructurado.
- Si el usuario pide revisar elementos, comparar opciones o analizar resultados, la estructura es parte de la respuesta, no decoracion.
- No depender solo del LLM para presentacion: el runtime debe inferir y conservar `format`.

## 11. Jarvis debe razonar el valor de salida

Formato no es suficiente. Jarvis tambien debe decidir que valor le prometio al usuario.

Regla:

- `inspection`: listar o mostrar elementos completos y ordenados.
- `summary`: sintetizar significado; no copiar snippets.
- `analysis`: explicar hallazgos, importancia, riesgos y acciones.
- `comparison`: mostrar criterios, diferencias y tradeoffs.
- `response`: contestar directo.

Si una respuesta dice "resumen", debe existir transformacion real. Si solo hay texto extraido, debe llamarse vista previa, extracto o contenido visible, no resumen.

## 12. Jarvis debe ayudar a decidir atencion

En flujos de revision, Jarvis no debe limitarse a describir. Debe ayudar al usuario a decidir si algo merece accion.

Ejemplo correo:

- No basta con listar asunto/remitente.
- No basta con resumir una newsletter.
- Debe clasificar tipo, nivel de atencion, motivo y accion sugerida.

Regla general:

- Cuando el usuario pregunta por valor, spam, prioridad, importancia, riesgo o accion necesaria, Jarvis debe hacer triage.
- El triage debe separar hechos observados, inferencia y accion recomendada.
- Si no tiene suficiente informacion, debe decirlo y ofrecer abrir/leer completo.

## 13. Las confirmaciones son estado, no conversacion libre

Cuando una accion riesgosa queda esperando confirmacion, respuestas como `si`, `confirmo`, `dale` o `procede` deben confirmar la tarea pendiente mas reciente. No deben pasar otra vez por el modelo para crear una accion duplicada.

Regla:

- Si faltan datos, Jarvis pregunta datos faltantes.
- Si ya tiene datos, llama la herramienta.
- El runtime crea la confirmacion formal.
- Una confirmacion textual o boton debe reanudar la tarea existente.
- No debe haber doble confirmacion ni loops de confirmacion.
- La confirmacion debe ser visible donde el usuario esta mirando, no escondida solo en un panel lateral.
- La confirmacion debe mostrar exactamente que se va a ejecutar: destinatario, asunto, cuerpo, fecha, archivo o parametros relevantes.

## 14. Un fallo de formato del modelo no es lo mismo que una caida del modelo

En las pruebas del HUD aparecio varias veces `No pude contactar el modelo`, pero la causa real no era siempre una desconexion ni una cuota agotada. En varios casos el modelo respondio texto util como `Tienes razón...` o `Respuesta: ...`, pero fuera del contrato JSON exigido por el runtime.

Si tratamos eso como caida total, Jarvis parece mas tonto e inestable de lo que realmente es. La experiencia correcta es:

- diferenciar entre fallo de red, cuota, credencial y parseo
- recuperar valor cuando el modelo entregue texto util aunque no venga en JSON
- registrar en logs el problema real
- degradar con honestidad, no con mensajes engañosos

Regla futura:

- si el modelo entrega texto aprovechable, el runtime debe intentar rescatarlo y responder
- si el modelo falla por JSON invalido, el mensaje al usuario no debe decir `no pude contactar`
- los providers deben adjuntar contexto suficiente para clasificar la falla
- La UI no debe mostrar botones duplicados para la misma decision. Una accion pendiente tiene una superficie primaria de decision.
