# Architecture - Jarvis Codex

## Tesis

Jarvis Codex debe ser local-first: vive en el computador del cliente, almacena memoria y credenciales localmente, y usa internet solo cuando la tarea lo requiere.

No debe depender de una nube propietaria para pensar, operar o recordar.

## Componentes Base

- Desktop shell: HUD, voz, paneles y experiencia de usuario.
- Local service: orquestador, tareas, herramientas y conectores.
- Memory store: memoria local estructurada.
- Credential vault: llaves, tokens y secretos cifrados.
- Tool registry: herramientas disponibles y sus contratos.
- Policy engine: permisos, riesgos y aprobaciones.
- Task runtime: tareas persistentes y eventos.
- Event bus: comunica HUD, voz, agentes y tareas.
- Model provider manager: Gemini/API externa configurada por el usuario.
- Model router: decide regla, skill, modelo economico o modelo avanzado.
- Agent runtime: agentes con estado, permisos y presupuesto.
- Sandbox runtime: pruebas, reparacion y ejecucion segura.
- MCP manager: registra servidores MCP locales o remotos y expone sus capacidades como herramientas gobernadas.
- Computer-use runtime: opera navegador, escritorio o aplicaciones locales con permisos estrictos y trazabilidad.
- Module registry: carga paquetes de capacidades sin convertir el runtime central en monolito.
- Presenter registry: transforma resultados estructurados en respuestas claras por dominio.
- Behavior learning runtime: convierte correcciones del usuario en lecciones abstraidas y politicas reutilizables.

## Regla Modular

Jarvis Codex no debe crecer agregando todos los poderes al mismo archivo. Cada grupo de capacidades debe vivir en un modulo con herramientas, politicas, presentadores y pruebas propias.

El runtime central debe orquestar. Los modulos deben saber ejecutar su dominio.

## Aprendizaje por Correccion

Jarvis Codex no debe depender siempre de humanos desarrolladores para crecer en criterio.

Cuando el usuario final detecta que Jarvis hizo algo torpe, demasiado literal o mal presentado, el sistema debe poder:

1. detectar que hubo una correccion
2. distinguir si fue dato, formato, criterio o personalidad
3. abstraer una leccion general
4. estimar alcance
5. reutilizarla en situaciones futuras

Esto no reemplaza el desarrollo del producto, pero si convierte interacciones reales en crecimiento interno.

Documento base:

- `docs/BEHAVIOR_LEARNING_BACKBONE.md`

## Internet y Servicios Externos

Internet se usa para:

- LLM externo con API key del usuario.
- Investigacion web.
- Google Workspace autorizado por el usuario.
- Conectores autorizados.
- MCPs configurados por el usuario.
- Descarga opcional de informacion o fuentes.

Internet no debe ser obligatorio para:

- Abrir Jarvis.
- Ver memoria local.
- Revisar logs locales.
- Ver tareas ya creadas.
- Usar skills locales maduras.
- Operar capacidades que no dependan de APIs externas.

## Sobre Actualizaciones

La vision principal es que Jarvis crezca localmente mediante memoria, skills, procedimientos y agentes. Aun asi, hay dos tipos de actualizacion que conviene distinguir:

- Crecimiento interno: lo que Jarvis aprende, crea y adapta en el computador del usuario.
- Actualizacion del producto: correcciones del motor, seguridad, instalador, bugs, conectores base y compatibilidad con APIs externas.

Aunque Jarvis aprenda, el software base igual puede necesitar actualizaciones porque Google cambia APIs, macOS cambia permisos, una dependencia falla o se corrige un problema de seguridad.

Por eso, las actualizaciones deben ser opcionales, controladas y compatibles con local-first. No deben ser una dependencia de nube para operar.

## Estrategia Recomendada

- App local como fuente de verdad.
- Actualizador opcional.
- Paquetes importables manualmente.
- Skills locales versionadas.
- Backups locales.
- Sin memoria obligatoria en nube.
- Sin credenciales en servidores propios.

## MCP y Computer Use

MCP debe tratarse como una frontera formal entre Jarvis y capacidades externas. Un servidor MCP no debe quedar disponible simplemente porque existe; debe registrarse, inspeccionarse y gobernarse.

Flujo recomendado:

1. Usuario agrega MCP.
2. Jarvis lee manifiesto o introspecciona herramientas.
3. Clasifica capacidades por riesgo.
4. Muestra permisos en lenguaje simple.
5. Ejecuta prueba de conexion.
6. Registra herramientas en el tool registry.
7. Aplica policy engine antes de cada accion.

Computer use y Chrome son capacidades de alto poder porque permiten operar interfaces humanas. Deben vivir en una capa separada con:

- Permisos por dominio, aplicacion o tipo de accion.
- Confirmacion antes de comprar, borrar, publicar, enviar o modificar datos sensibles.
- Captura de pasos ejecutados.
- Pausa/interrupcion humana.
- Modo observador antes de modo operador.
- Limites de sesion.
