# Conectores

## Principio

Los conectores son extensiones autorizadas por el usuario. Jarvis no debe asumir acceso a servicios externos sin consentimiento explicito, prueba de conexion y permisos claros.

## Conectores base

Google Workspace debe ser la columna vertebral inicial:

- Calendar.
- Gmail.
- Drive.
- Docs.
- Sheets.
- Contacts.
- Tasks.

## Estado Implementado

El runtime nuevo ya registra:

- `model.generate_json` con Anthropic Haiku como proveedor principal de pruebas.
- `model.usage_summary` para medir tokens y costo local acumulado.
- `google.calendar.list_events`
- `google.calendar.create_event`
- `google.docs.create_document`
- `google.gmail.list_emails`
- `google.gmail.send_email`
- `google.contacts.search`

Las acciones de escritura o envio quedan como alto riesgo y requieren confirmacion.

## Proveedor de Modelo para Pruebas Premium

Para la fase actual, Jarvis usa Anthropic `claude-haiku-4-5` como cerebro unico de pruebas.

Motivo:

- Es mas barato que modelos grandes.
- Es suficientemente capaz para validar prompts, herramientas, normalizacion y cierres.
- Permite medir costo real por uso antes de introducir routing complejo.
- Evita que la fase de pruebas se caiga por modelos pequenos menos consistentes.

Reglas:

- La API key vive en la boveda local cifrada como `ANTHROPIC_API_KEY`.
- No se guarda en `.env`, codigo ni documentacion.
- El costo se registra en `local_data/model-usage.json`.
- El HUD muestra el gasto acumulado de la sesion local.
- Si Haiku no alcanza para una tarea, se registra como evidencia antes de agregar Sonnet u Opus.

Telegram puede ser el primer canal remoto recomendado por simplicidad. WhatsApp es deseable, pero requiere evaluacion tecnica, legal y de politicas de plataforma.

## Conectores de negocio

Jarvis debe poder crecer hacia:

- Notion.
- n8n.
- CRMs.
- Dashboards web del cliente.
- CMS.
- Analytics.
- Search Console.
- Ads.
- Sistemas de reserva.
- Sistemas de inventario.
- Sistemas contables.
- MCPs personalizados.
- Navegador controlado.
- Computer use local.

## MCP Personalizados

Un MCP personalizado permite que Jarvis herede nuevas capacidades sin que el producto base tenga que implementarlas todas desde cero. Esto es clave para la vision de crecimiento: Jarvis puede conectarse a herramientas que no conoce todavia, siempre que esas herramientas expongan contratos claros.

Tipos:

- STDIO: proceso local iniciado por Jarvis.
- HTTP secuenciable: servicio remoto o local accesible por URL.

Campos esperados:

- Nombre del servidor.
- Comando o URL.
- Argumentos.
- Variables de entorno.
- Directorio de trabajo.
- Herramientas expuestas.
- Permisos solicitados.
- Riesgos declarados o inferidos.

Reglas:

- Ningun MCP debe recibir secretos sin autorizacion.
- Las variables de entorno deben pasar por la boveda cuando sean sensibles.
- Jarvis debe poder desactivar un MCP.
- Jarvis debe auditar que herramientas uso y con que entrada.
- MCP nuevo debe partir en modo restringido hasta ser probado.

## Computer Use y Chrome

Computer use y Chrome deben verse como conectores especiales, no como permisos libres.

Capacidades posibles:

- Abrir paginas.
- Buscar informacion.
- Leer contenido visible.
- Llenar formularios.
- Descargar archivos.
- Usar dashboards donde no existe API.
- Ejecutar flujos repetitivos.

Riesgos:

- Enviar informacion por error.
- Comprar o contratar sin querer.
- Modificar datos en un dashboard.
- Publicar contenido.
- Leer informacion sensible visible en pantalla.

Por eso deben tener politicas propias de confirmacion, dominios permitidos y registro de acciones.

## NotebookLM como Conector de Investigacion

NotebookLM es una fuente especialmente valiosa para conocimiento especifico porque trabaja sobre corpus definidos por fuentes. Para Jarvis, no debe verse como reemplazo de memoria local, sino como una capa de investigacion y sintesis basada en fuentes.

Usos posibles:

- Crear notebooks por cliente, negocio o vertical.
- Cargar fuentes verificadas.
- Consultar corpus curados.
- Generar resumenes iniciales.
- Comparar fuentes.
- Extraer preguntas frecuentes.
- Preparar briefings por nicho.
- Alimentar candidatos de memoria local.

Opciones de integracion:

- NotebookLM Enterprise API: opcion oficial para entornos Google Cloud/Enterprise.
- MCP personalizado sobre API oficial: recomendable si el cliente tiene acceso Enterprise.
- Browser/computer use sobre NotebookLM personal: posible como automatizacion asistida, pero mas fragil y con mayor riesgo.
- Flujo indirecto: Jarvis prepara fuentes, documentos y preguntas; el usuario o una automatizacion los procesa en NotebookLM; Jarvis importa resultados verificados.

Regla importante:

Los resultados de NotebookLM no deben entrar automaticamente a memoria permanente. Deben pasar por el pipeline de curaduria de Jarvis, conservar fuentes y etiquetar confianza.

## Contrato de conector

Cada conector debe declarar:

- Nombre.
- Servicio.
- Permisos requeridos.
- Acciones disponibles.
- Riesgo por accion.
- Metodo de autenticacion.
- Prueba de conexion.
- Limites conocidos.
- Errores recuperables.
- Modo degradado.
- Si puede operar mediante API, navegador, escritorio o MCP.
- Si requiere supervision humana.

## Gobierno

Jarvis debe distinguir entre:

- Lectura segura.
- Escritura reversible.
- Escritura sensible.
- Accion irreversible.
- Accion financiera.
- Accion legal o medica.

Las acciones de alto riesgo requieren confirmacion o politicas preaprobadas.
