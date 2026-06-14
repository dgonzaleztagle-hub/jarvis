# Prueba de Flujo NotebookLM

## Objetivo

Validar si NotebookLM sirve como motor de investigacion y sintesis para crear memoria local de Jarvis sin integrarlo todavia como dependencia tecnica directa.

## Hipotesis

NotebookLM puede acelerar el onboarding de conocimiento por nicho si trabaja sobre fuentes previamente seleccionadas y si sus resultados pasan por el pipeline de curaduria de Jarvis antes de entrar a memoria permanente.

## Flujo Experimental

1. Usuario define un nicho.
2. Jarvis crea un plan de investigacion.
3. Jarvis selecciona fuentes iniciales.
4. Jarvis clasifica fuentes por autoridad, vigencia, dominio y sensibilidad.
5. Usuario o Jarvis carga fuentes en NotebookLM.
6. NotebookLM genera resumenes, preguntas frecuentes, puntos clave y contradicciones.
7. Jarvis importa esos resultados como `candidate`.
8. Jarvis valida cada hallazgo contra fuentes originales.
9. Jarvis convierte solo hallazgos aprobados en memoria `verified`.
10. Jarvis descarta, marca o separa lo debil, sensible o contradictorio.

## Lo Que No Debe Pasar

- NotebookLM no debe ser tratado como autoridad final.
- Un resumen no debe entrar directo a memoria permanente.
- Jarvis no debe perder los enlaces a fuentes originales.
- Jarvis no debe mezclar conocimiento general del nicho con datos privados del cliente.
- Jarvis no debe subir datos sensibles a NotebookLM sin autorizacion explicita.

## Formato de Entrada a NotebookLM

Para cada prueba se debe crear un corpus con:

- Nombre del nicho.
- Pais o mercado si aplica.
- Objetivo de investigacion.
- Fuentes cargadas.
- Preguntas guia.
- Criterios de descarte.

## Preguntas Guia Iniciales

Para un nicho como dentistas:

- Que servicios ofrece normalmente este tipo de negocio?
- Como consigue pacientes?
- Que problemas operativos son frecuentes?
- Que tareas administrativas consume mas tiempo?
- Que oportunidades de automatizacion existen?
- Que riesgos legales, medicos o de privacidad existen?
- Que fuentes son confiables para este dominio?
- Que conocimiento no debe usarse sin supervision profesional?

Para restaurantes:

- Que operaciones diarias son criticas?
- Como manejan reservas, inventario y proveedores?
- Que problemas frecuentes afectan rentabilidad?
- Que fuentes locales regulan higiene, permisos o normativa?
- Que oportunidades existen en reseñas, SEO local y promociones?
- Que datos cambian seguido y deben caducar rapido?

## Formato de Salida Esperado

NotebookLM debe producir:

- Resumen ejecutivo.
- Mapa de temas.
- Lista de hallazgos.
- Preguntas frecuentes.
- Contradicciones o incertidumbres.
- Fuentes usadas.
- Recomendaciones operativas.

Jarvis debe convertir eso a:

- Memory candidates.
- Source records.
- Confidence scores.
- Sensitivity tags.
- Suggested skills.
- Suggested workflows.
- Review queue.

## Criterios de Exito

La prueba funciona si:

- Reduce tiempo de investigacion inicial.
- Mantiene trazabilidad de fuentes.
- Produce hallazgos utiles para el nicho.
- No llena la memoria con ruido.
- Detecta contradicciones.
- Separa conocimiento sensible.
- Permite crear skills o workflows iniciales.

## Primer Experimento Recomendado

Nicho: dentistas.

Alcance:

- Operacion general.
- Agenda y pacientes.
- SEO local.
- Gestion de reseñas.
- Documentos administrativos.
- Riesgos de privacidad.

Resultado esperado:

- 20 a 40 hallazgos candidatos.
- 5 a 10 workflows sugeridos.
- 5 skills iniciales.
- Lista de fuentes confiables y rechazadas.

## Decision Despues de la Prueba

Si el flujo funciona, se evalua la integracion:

- Manual asistida.
- Browser/computer use.
- MCP no oficial con riesgo controlado.
- NotebookLM Enterprise API si existe acceso.
- Reemplazo futuro por motor RAG propio local si conviene.
