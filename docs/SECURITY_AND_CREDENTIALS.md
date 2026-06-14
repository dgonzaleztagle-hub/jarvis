# Security and Credential Vault - Jarvis Codex

## Principio

Aunque Jarvis viva localmente, debe tratar credenciales y datos sensibles con seriedad. Local no significa automaticamente seguro.

## Credential Vault

La boveda de credenciales debe almacenar:

- API key del proveedor de modelos.
- Tokens de Google OAuth.
- Tokens de conectores.
- Preferencias de permisos.
- Secretos necesarios para herramientas locales.
- Variables de entorno sensibles para MCPs.
- Llaves usadas por automatizaciones locales.

## Estado Implementado

El runtime nuevo ya incluye un Credential Vault local cifrado y un importador inicial desde el prototipo.

Importa:

- Gemini API key.
- ElevenLabs.
- Google OAuth config.
- Google OAuth tokens.
- Telegram bot token.
- Telegram allowed user.

Regla actual:

- Los providers prefieren leer desde vault.
- Si no existe una credencial en vault, pueden caer temporalmente al `.env` heredado.
- Los endpoints de listado del vault devuelven nombres y metadata, nunca valores secretos.

## Requisitos

- Cifrado local.
- Separacion por usuario/instancia.
- Nunca enviar secretos a servidores propios.
- Revocacion por conector.
- Rotacion o reemplazo de llave.
- Exportacion segura.
- Borrado seguro.
- Auditoria de acceso.
- Indicador claro de que servicio esta conectado.

## Permisos

Cada conector debe tener permisos visibles:

- Leer agenda.
- Crear eventos.
- Leer correo.
- Enviar correo.
- Leer Drive.
- Crear Docs.
- Leer contactos.
- Acceder a dashboard.
- Ejecutar acciones locales.
- Controlar navegador.
- Controlar aplicaciones locales.
- Ejecutar MCP personalizado.

## Privacidad Local

No se necesita una politica de privacidad invasiva para datos que viven localmente, pero si se necesita una declaracion clara dentro del producto:

- Sus datos viven en este computador.
- Sus credenciales no se envian a servidores propios.
- Algunos servicios externos reciben datos cuando usted los usa.
- Puede borrar memoria y desconectar servicios.
- Rubros sensibles requieren cuidado adicional.

Esto no es marketing legal; es confianza operacional.

## Politica Interna de Datos

La privacidad aqui no debe entenderse como una pagina legal de SaaS, sino como reglas internas que Jarvis obedece:

- Que puede leer.
- Que puede guardar.
- Que puede resumir.
- Que puede enviar a un modelo externo.
- Que puede compartir con Google u otro conector.
- Que requiere confirmacion humana.
- Que debe olvidar si el usuario lo pide.

La app puede vivir localmente y aun asi necesitar limites claros, porque el LLM externo, Google y otros conectores si pueden recibir datos cuando el usuario autoriza una tarea.

## MCP y Secretos

Los MCP personalizados pueden requerir variables de entorno, tokens o rutas locales. Jarvis debe tratarlos como conectores de riesgo variable.

Reglas:

- Secretos en variables de entorno deben guardarse en la boveda.
- El usuario debe ver que MCP recibe que secreto.
- Un MCP no debe heredar todas las credenciales del sistema.
- Cada MCP debe correr con el menor permiso posible.
- Jarvis debe poder revocar o pausar un MCP.
- Los logs no deben imprimir secretos.

## Control de Computador

Computer use y Chrome requieren una politica especial:

- Confirmacion antes de acciones irreversibles.
- Lista de dominios permitidos o bloqueados.
- Modo observador para tareas nuevas.
- Registro de pasos relevantes.
- Detencion inmediata por el usuario.
- Prohibicion de operar sobre datos sensibles sin autorizacion explicita.

## Rubros Sensibles

Para medicos, dentistas, abogados u otros profesionales:

- Etiquetar datos sensibles.
- Evitar guardar datos de pacientes/clientes sin claridad.
- Separar conocimiento operativo de conocimiento profesional sensible.
- No reemplazar criterio profesional.
- Registrar fuentes y limites.
- Pedir confirmacion antes de enviar contenido sensible a modelos externos.
