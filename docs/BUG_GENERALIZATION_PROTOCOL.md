# Protocolo de Generalizacion de Bugs

## Principio

Cada bug, incomodidad o "pero" reportado por el usuario debe tratarse como una senal del sistema completo, no solo como una falla puntual.

Jarvis Codex no debe evolucionar parchando ejemplos aislados. Debe convertir cada correccion en una mejora de pensamiento, contrato, modulo, presentacion o politica que aplique a casos futuros.

## Regla Obligatoria

Ante cualquier bug o feedback, revisar tres niveles:

1. Caso puntual: que fallo exactamente en esta interaccion.
2. Patron general: que clase de errores similares podria aparecer en otros modulos.
3. Regla futura: que contrato, test, presenter, prompt, documento o arquitectura evita repetirlo.

Si una correccion solo arregla el caso puntual, queda incompleta.

## Preguntas de Auditoria

Antes de cerrar un arreglo, responder internamente:

- Esto aplica solo a esta herramienta o a todo Jarvis?
- El error viene de datos, razonamiento, formato, permisos, UX, memoria o ejecucion?
- Hay una regla general que debamos agregar?
- Hay un test general que cubra la clase de problema?
- La documentacion del proyecto debe aprender algo?
- El HUD esta mostrando el valor correcto o solo texto correcto?
- El usuario podria tomar una decision con esta salida?

## Ejemplos

### Correos devueltos como parrafo

No es solo bug de Gmail.

Patron:

- Jarvis debe listar elementos como listas.
- El HUD debe preservar saltos de linea.
- El runtime debe conservar `format`.

Regla futura:

- Cualquier pedido de elementos usa `format: list`.

### Snippet llamado resumen

No es solo bug de Gmail.

Patron:

- Jarvis no debe llamar resumen a texto extraido.
- Si promete resumen, analisis o comparacion, debe transformar.

Regla futura:

- `outputValue` debe distinguir inspection, summary, analysis y comparison.

### Usuario pregunta si algo merece atencion

No es solo correo.

Patron:

- Jarvis debe hacer triage.
- Debe ayudar a decidir.

Regla futura:

- Si el usuario pregunta por valor, urgencia, spam, riesgo, prioridad o accion necesaria, entregar categoria, atencion, motivo y accion sugerida.

## Criterio de Cierre

Un arreglo queda cerrado solo si:

- El caso puntual mejora.
- Se identifico el patron general.
- Se actualizo codigo, test o documentacion cuando corresponde.
- La respuesta futura de Jarvis queda mas inteligente, no solo mas bonita.

## Frase Guia

No arreglar el ejemplo. Arreglar la forma de pensar que produjo el ejemplo.
