# CHANGELOG

## [1.0.0] - 2026-05-30

### Añadido
- **Base de Datos SQLite Transaccional:** Inicialización y esquema relacional en [schema.sql](file:///c:/Users/ulise/OneDrive/Desktop/AGENTE%20IA/database/schema.sql) con soporte para OCs, Remitos, ítems individuales y un mapeo automático de códigos SAP.
- **DAO de Gestión de Inventario:** Lógica transaccional completa en [inventoryDao.ts](file:///c:/Users/ulise/OneDrive/Desktop/AGENTE%20IA/src/database/inventoryDao.ts) para registrar OCs e impactar Remitos con validación atómica preventiva de saldos.
- **Procesamiento PDF con Inteligencia Artificial:** Integración de `pdf-parse` y la API de Gemini (con estructurado estricto `responseSchema`) en [pdfProcessor.ts](file:///c:/Users/ulise/OneDrive/Desktop/AGENTE%20IA/src/services/pdfProcessor.ts) para extraer datos limpios de PDFs digitales y escaneados.
- **Servidor MCP Logístico:** Punto de entrada en [index.ts](file:///c:/Users/ulise/OneDrive/Desktop/AGENTE%20IA/src/index.ts) que expone herramientas para n8n bajo STDIO (`procesar_documentos_pendientes`, `ver_stock_actual`, `ver_saldos_oc`, `vincular_codigos_sap`, `cargar_saldos_iniciales_oc`).
- **Configuración de Entorno:** Archivo de ejemplo [.env.example](file:///c:/Users/ulise/OneDrive/Desktop/AGENTE%20IA/.env.example) para guiar la configuración del API key de Gemini.
- **Mecanismo de Resiliencia ante Rate Limit (429):** Implementación de reintentos con backoff exponencial (`generateContentWithRetry`) en [pdfProcessor.ts](file:///c:/Users/ulise/OneDrive/Desktop/AGENTE%20IA/src/services/pdfProcessor.ts) para pausar la ejecución en caso de alcanzar el límite de cuota (429) de la API de Gemini Free Tier y continuar una vez liberada.

### Decisiones Críticas de Diseño
- **Manejo de Errores 429:** Cuando la API de Gemini devuelve un código de estado de límite de cuota excedido, el procesador detecta automáticamente el código 429 o el mensaje de quota, detiene la ejecución durante un delay incremental (iniciando en 6s y multiplicándose por 2 en cada reintento hasta un máximo de 5 intentos), permitiendo que las tareas por lotes de n8n no se interrumpan bruscamente.
- **Vinculación dinámica de códigos SAP:** En lugar de requerir una carga previa obligatoria, el sistema vincula automáticamente el código SAP Interno y el del Cliente al procesar los remitos (que contienen ambos). Las validaciones contra la OC se efectúan mediante el código SAP Cliente, garantizando compatibilidad inmediata.
- **Idempotencia:** Se verifica si un documento ya fue registrado utilizando su identificador único (Número de OC o Remito) antes de cualquier inserción, y se mueven los archivos a `/procesados` al terminar exitosamente, evitando loops o re-cargas involuntarias.

### Riesgos Potenciales
- Si el remito contiene una OC asociada que no ha sido cargada previamente en el sistema, la transacción del remito fallará para mantener la integridad (el agente avisará de este hecho).
- Retardo acumulado si se procesan muchos archivos concurrentemente bajo la capa gratuita, aunque el backoff exponencial previene la caída definitiva del servicio.
