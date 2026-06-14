# Memory and Research - Jarvis Codex

## Principio

La memoria inicial de Jarvis debe ser rigurosa. Una memoria pequena y confiable es mejor que una memoria grande llena de ruido.

## Estados de Memoria

- `candidate`: hallazgo nuevo aun no validado.
- `verified`: conocimiento aceptado.
- `conflicting`: informacion contradictoria.
- `low_confidence`: informacion util pero debil.
- `rejected`: descartado.
- `sensitive`: requiere cuidado o supervision profesional.
- `obsolete`: informacion reemplazada.

## Calidad de Fuente

Cada fuente debe evaluarse con un puntaje. El objetivo no es solo encontrar informacion, sino decidir si merece entrar a memoria.

## Estado Implementado

El runtime ya incluye una primera herramienta local:

- `research.evaluate_source`

Esta herramienta evalua:

- Dominio confiable o debil.
- Autor identificado.
- Fecha/vigencia.
- Coincidencia con contexto de dominio.
- Sensibilidad medica, legal o financiera.

En rubros sensibles, una fuente media no basta para memoria permanente. Debe quedar como baja confianza o pendiente de revision.

### Criterios

- Autoridad: institucion, autor, especialidad, reputacion.
- Dominio correcto: la fuente corresponde al contexto real.
- Vigencia: fecha de publicacion o actualizacion.
- Evidencia: cita datos, fuentes, estudios o documentacion.
- Sesgo comercial: vende algo, exagera o captura leads.
- Consistencia: coincide con otras fuentes confiables.
- Especificidad: responde al rubro exacto, pais o caso.
- Sensibilidad: si requiere limites, advertencias o supervision.

## Umbral de Entrada

Una fuente no entra a memoria permanente solo por aparecer en internet. Debe cumplir un umbral minimo segun el tipo de dato:

- Dato operativo general: al menos confianza media.
- Dato de negocio local: fuente verificable y fecha reciente.
- Dato medico, legal, financiero o sensible: fuente alta o revision humana.
- Dato contradictorio: guardar como conflicto, no como verdad.
- Dato comercial o SEO: puede usarse como senal, pero no como autoridad.

Si Jarvis no puede validar bien una fuente, debe mantenerla en `candidate` o `low_confidence`.

## Ranking

- Alta confianza: instituciones oficiales, universidades, publicaciones cientificas, documentacion oficial, organismos reguladores.
- Media confianza: especialistas identificables, documentacion tecnica, sitios profesionales reconocidos.
- Baja confianza: blogs genericos, articulos sin autor, contenido comercial, listas SEO superficiales.
- Rechazada: fuente no verificable, fuera de dominio, contradictoria sin respaldo o de baja reputacion.

## Pipeline de Investigacion

1. Definir dominio exacto.
2. Clasificar sensibilidad.
3. Identificar fuentes aceptables.
4. Buscar informacion.
5. Filtrar por autoridad.
6. Comparar fuentes.
7. Detectar contradicciones.
8. Separar informacion general de instrucciones practicas.
9. Asignar confianza.
10. Resumir estructuradamente.
11. Guardar fuentes y fecha.
12. Escribir memoria solo si supera umbral.

## NotebookLM como Fuente Intermedia

NotebookLM puede ser una excelente herramienta intermedia para sintetizar corpus especificos. Su valor principal no es "saber mas", sino trabajar sobre fuentes acotadas y ayudar a resumirlas.

Uso recomendado:

- Jarvis selecciona fuentes.
- Jarvis crea o prepara un corpus por vertical/cliente.
- NotebookLM resume, responde y organiza.
- Jarvis extrae hallazgos candidatos.
- Jarvis valida esos hallazgos con fuente, fecha y confianza.
- Solo despues entran a memoria local.

NotebookLM no debe convertirse en memoria primaria ni autoridad final. Debe funcionar como acelerador de lectura y sintesis.

## Ejemplo de Cuidado

Si el usuario pregunta como disectar un corazon, Jarvis debe identificar el contexto: medicina humana, veterinaria, anatomia academica, cirugia, educacion escolar o curiosidad general. Una fuente veterinaria no sirve si el contexto es medicina humana. Una fuente casual no sirve si el contexto es profesional.

## Memoria Permanente

Solo debe guardar:

- Conocimiento verificado.
- Conocimiento de baja confianza claramente marcado.
- Contradicciones como contradicciones.
- Limites de uso.
- Fuentes y fecha.

## Caducidad

La memoria tambien debe envejecer. Cada registro debe tener:

- Fecha de captura.
- Fecha de ultima verificacion.
- Fuente original.
- Confianza.
- Categoria.
- Sensibilidad.
- Proxima revision sugerida.

Esto evita que Jarvis trate informacion antigua como si fuera verdad vigente.
