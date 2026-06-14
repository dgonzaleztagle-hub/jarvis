# Behavior Learning Backbone

## Objetivo

Dejar explicita la columna vertebral de Jarvis Codex:

- no solo recordar datos
- no solo ejecutar tools
- no solo responder prompts

Jarvis debe aprender de correcciones humanas y convertirlas en criterio reutilizable.

## Principio Rector

No guardes solo lo que cambio.

Aprende que principio cambio.

## Problema que Resuelve

Si el usuario corrige a Jarvis con algo como:

- "no seas tan literal"
- "no tienes por qué mostrar eso"
- "esto deberia verse asi"
- "si no sabes, pregunta"

guardar solo el ejemplo puntual produce memoria torpe.

Ejemplo torpe:

- "Rossie lleva doble s"

Eso sirve como dato, pero no como inteligencia.

La leccion real es:

- si la correccion ya quedo aplicada en el dato final, no expliques la mecanica interna salvo que el usuario lo pida

## Niveles de Aprendizaje

Cada correccion debe poder separarse en capas:

1. Hecho
- que dato quedo corregido

2. Preferencia local
- como le gusta al usuario que eso se presente

3. Leccion general
- que principio de comportamiento cambia para casos parecidos

4. Alcance
- donde aplica esa leccion

## Tipos de Correccion que Jarvis Debe Reconocer

### 1. Correccion de contenido

Ejemplo:

- "no es Rosa, es Rossie"

Resultado:

- actualizar dato

### 2. Correccion de formato

Ejemplo:

- "listamelo, no me lo des como texto corrido"

Resultado:

- guardar preferencia de salida estructurada

### 3. Correccion de literalidad

Ejemplo:

- "no tienes por qué mostrar lo de la doble s"

Resultado:

- abstraer regla de presentacion limpia

### 4. Correccion de criterio

Ejemplo:

- "si no sabes eso, pregunta"

Resultado:

- actualizar conducta futura ante ambiguedad

### 5. Correccion de personalidad

Ejemplo:

- "no me aplaudas todo"
- "si estoy diciendo una tontera, dicemelo"

Resultado:

- ajustar tono relacional y friccion inteligente

## Ciclo Esperado

1. Jarvis actua
2. Usuario corrige
3. Jarvis detecta que no fue solo un dato nuevo, sino una enmienda de comportamiento
4. Clasifica la correccion
5. Abstrae una leccion
6. Estima alcance
7. Guarda la leccion
8. La reinyecta en prompts futuros
9. Si hay duda futura, pregunta mejor

## Estructura Recomendada de una Leccion

```json
{
  "type": "behavior_lesson",
  "title": "No exponer explicaciones internas innecesarias",
  "state": "verified",
  "content": {
    "principle": "Cuando la corrección ya quedó aplicada al resultado final, muestra el resultado limpio y evita explicar la mecánica interna salvo que el usuario lo pida.",
    "preferredBehavior": "Presentar el dato corregido sin aclaraciones redundantes.",
    "appliesTo": ["contacts", "lists", "summaries", "artifacts"],
    "whenUnsure": "Si la aclaración puede cambiar el significado, preguntar antes de mostrar."
  }
}
```

## Reglas de Gobierno

No toda correccion debe volverse ley global.

Cada aprendizaje debe poder vivir como:

- `one_off`
- `user_preference`
- `domain_rule`
- `global_policy`

La promocion de una leccion a politica mas fuerte requiere repeticion o alta claridad.

## Impacto en Producto

Esto convierte a Jarvis en algo mas que un wrapper de LLM:

- aprende del usuario final
- reduce dependencia del desarrollador
- mejora criterio sin agregar mil prompts rigidos
- crea personalidad util, no solo memoria

## Decision de Arquitectura

Esta capacidad deja de ser opcional.

Aprendizaje por correccion queda declarado como:

- eje central del sistema
- requisito de inteligencia acumulativa
- base del crecimiento local-first de Jarvis Codex
