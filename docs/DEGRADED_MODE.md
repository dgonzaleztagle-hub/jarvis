# Modo Degradado

## Principio

Jarvis debe seguir siendo util cuando algo falla. No todo fallo debe romper la experiencia completa.

## Sin internet

Disponible:

- Memoria local.
- Historial.
- Agenda local cacheada.
- Tareas locales.
- Skills locales.
- Notas.
- Preparacion de borradores.

No disponible:

- Investigacion web.
- LLM externo si no hay modelo local.
- Sincronizacion con Google.
- Conectores web.

Comportamiento esperado:

- Avisar con lenguaje simple.
- Seguir trabajando en borrador.
- Reintentar cuando vuelva la conexion.
- Marcar tareas pendientes de sincronizacion.

## Cuota agotada del modelo

Jarvis debe:

- Cambiar a fallback si existe.
- Reducir profundidad de respuesta.
- Usar memoria y procedimientos locales.
- Pedir confirmacion antes de tareas caras.
- Informar que puede continuar con menor calidad si el usuario lo acepta.

## Google no disponible

Jarvis debe:

- Usar cache local.
- Preparar documentos o cambios en cola.
- Sincronizar despues.
- No fingir que escribio algo en Drive si no pudo hacerlo.

## Voz no disponible

Jarvis debe:

- Cambiar a texto.
- Mostrar estado claro del microfono o TTS.
- Permitir reintento.

## Conector roto

Jarvis debe:

- Diagnosticar.
- Probar autenticacion.
- Sugerir reparacion.
- Desactivar temporalmente acciones riesgosas.
- Mantener el resto del sistema operativo.
