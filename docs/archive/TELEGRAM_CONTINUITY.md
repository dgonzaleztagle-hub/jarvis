# Continuidad de Telegram

## Decision

Cuando se migre Telegram al runtime nuevo, debe mantenerse el mismo canal que el usuario ya esta usando. No se debe crear un bot nuevo ni perder continuidad de conversacion por accidente.

## Credenciales Existentes

El prototipo actual usa:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_ID`

Durante la migracion, estas credenciales pueden leerse desde la configuracion heredada del prototipo. Luego deben moverse al Credential Vault local.

## Integracion Objetivo

Telegram no debe hablar directo con un executor suelto. Debe entrar al mismo flujo que el HUD:

1. Mensaje entrante.
2. Normalizacion de canal.
3. Task runtime.
4. Tool registry.
5. Policy engine.
6. Event bus.
7. Respuesta a Telegram y/o HUD.

## Estado Implementado

Telegram ya existe como canal en el runtime nuevo:

- Lee credenciales heredadas del prototipo.
- No imprime token.
- No inicia polling automaticamente.
- Expone estado por `/channels/telegram/status`.
- Puede arrancar/detenerse por endpoints locales.
- Filtra usuario autorizado.
- Envia mensajes al mismo `conversationRuntime` que usara el HUD.

## Reglas

- Mantener el mismo bot.
- Mantener el mismo usuario autorizado.
- No imprimir token en logs.
- No permitir usuarios no autorizados.
- Mostrar progreso en tareas largas.
- Enviar cierre cuando una tarea termine.
