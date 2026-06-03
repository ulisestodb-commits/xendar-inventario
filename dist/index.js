"use strict";
/**
 * Descripción Técnica: Servidor MCP para automatización logística de inventarios.
 *                      Expone herramientas en formato estandarizado para n8n y otros clientes MCP,
 *                      permitiendo escanear carpetas de PDFs, consultar stock, mapear códigos SAP
 *                      y realizar operaciones transaccionales.
 * Contexto SaaS: Xendar - Módulo: Servidor MCP de Automatización Logística
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const dao = __importStar(require("./database/inventoryDao"));
const pdfProcessor_1 = require("./services/pdfProcessor");
// Crear el servidor MCP
const server = new index_js_1.Server({
    name: 'xendar-inventario-mcp',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
    },
});
// Definición de las herramientas del servidor
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'procesar_documentos_pendientes',
                description: 'Escanea los directorios OC/ y REMITOS/ para procesar nuevos PDFs e impactar el inventario.',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'ver_stock_actual',
                description: 'Retorna el stock consolidado de todos los productos (suma de saldos pendientes en OCs activas).',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'ver_saldos_oc',
                description: 'Retorna el listado de todas las posiciones de OCs y su saldo pendiente actual.',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'vincular_codigos_sap',
                description: 'Vincula de forma manual un código SAP interno con un código SAP de cliente y su descripción.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        codigo_sap_cliente: { type: 'string', description: 'Código SAP del cliente' },
                        codigo_sap_interno: { type: 'string', description: 'Código SAP interno de nuestra empresa' },
                        descripcion: { type: 'string', description: 'Descripción o nombre del artículo' },
                    },
                    required: ['codigo_sap_cliente', 'codigo_sap_interno'],
                },
            },
            {
                name: 'cargar_saldos_iniciales_oc',
                description: 'Carga una Orden de Compra o saldo de forma directa/manual para inicializar saldos (Punto Cero).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        oc_numero: { type: 'string', description: 'Número de la Orden de Compra' },
                        fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
                        items: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    item_posicion: { type: 'number', description: 'Número de posición' },
                                    codigo_sap_cliente: { type: 'string', description: 'Código SAP cliente' },
                                    descripcion: { type: 'string', description: 'Descripción del ítem' },
                                    cantidad_original: { type: 'number', description: 'Cantidad total de la OC' },
                                    unidad: { type: 'string', description: 'Unidad de medida (ej. KG, UN)' },
                                },
                                required: ['item_posicion', 'codigo_sap_cliente', 'descripcion', 'cantidad_original', 'unidad'],
                            },
                        },
                    },
                    required: ['oc_numero', 'fecha', 'items'],
                },
            },
            {
                name: 'procesar_documento_por_ruta',
                description: 'Procesa un único archivo PDF (OC o Remito) especificando su ruta absoluta y tipo de documento.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        ruta_archivo: { type: 'string', description: 'Ruta absoluta local del archivo PDF a procesar' },
                        tipo: { type: 'string', enum: ['OC', 'REMITO'], description: 'Tipo de documento a procesar (OC o REMITO)' },
                    },
                    required: ['ruta_archivo', 'tipo'],
                },
            },
        ],
    };
});
// Manejador para la ejecución de herramientas
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case 'procesar_documentos_pendientes': {
                const workspacePath = path.join(__dirname, '..', '..');
                const ocDir = path.join(workspacePath, 'OC');
                const remitosDir = path.join(workspacePath, 'REMITOS');
                // Asegurar existencia de carpetas procesados
                const ocProcesadosDir = path.join(ocDir, 'procesados');
                const remitosProcesadosDir = path.join(remitosDir, 'procesados');
                if (!fs.existsSync(ocProcesadosDir))
                    fs.mkdirSync(ocProcesadosDir, { recursive: true });
                if (!fs.existsSync(remitosProcesadosDir))
                    fs.mkdirSync(remitosProcesadosDir, { recursive: true });
                const results = [];
                // 1. Procesar OCs
                if (fs.existsSync(ocDir)) {
                    const files = fs.readdirSync(ocDir).filter(f => f.toLowerCase().endsWith('.pdf'));
                    for (const file of files) {
                        const filePath = path.join(ocDir, file);
                        try {
                            const extractedData = await (0, pdfProcessor_1.parseOCWithGemini)(filePath);
                            await dao.registrarOC({
                                numero: extractedData.numero,
                                tipo: 'OC',
                                fecha: extractedData.fecha,
                                archivo_origen: file,
                            }, extractedData.items.map(item => ({
                                ...item,
                                documento_numero: extractedData.numero,
                            })));
                            // Mover a procesados
                            const destPath = path.join(ocProcesadosDir, file);
                            fs.renameSync(filePath, destPath);
                            results.push({ file, type: 'OC', status: 'SUCCESS', message: `OC ${extractedData.numero} registrada exitosamente.` });
                        }
                        catch (error) {
                            results.push({ file, type: 'OC', status: 'ERROR', message: error.message || 'Error desconocido' });
                        }
                    }
                }
                // 2. Procesar REMITOS
                if (fs.existsSync(remitosDir)) {
                    const files = fs.readdirSync(remitosDir).filter(f => f.toLowerCase().endsWith('.pdf'));
                    for (const file of files) {
                        const filePath = path.join(remitosDir, file);
                        try {
                            const extractedData = await (0, pdfProcessor_1.parseRemitoWithGemini)(filePath);
                            // Construir items de remito tipados
                            const itemsToRegister = extractedData.items.map(item => ({
                                documento_numero: extractedData.numero,
                                oc_asociada_numero: extractedData.oc_asociada_numero,
                                codigo_sap_interno: item.codigo_sap_interno,
                                codigo_sap_cliente: item.codigo_sap_cliente,
                                cantidad_entregada: item.cantidad_entregada,
                                unidad: item.unidad,
                            }));
                            await dao.registrarRemito({
                                numero: extractedData.numero,
                                tipo: 'REMITO',
                                fecha: extractedData.fecha,
                                archivo_origen: file,
                            }, itemsToRegister);
                            // Mover a procesados
                            const destPath = path.join(remitosProcesadosDir, file);
                            fs.renameSync(filePath, destPath);
                            results.push({
                                file,
                                type: 'REMITO',
                                status: 'SUCCESS',
                                message: `Remito ${extractedData.numero} registrado contra OC ${extractedData.oc_asociada_numero}.`,
                            });
                        }
                        catch (error) {
                            results.push({ file, type: 'REMITO', status: 'ERROR', message: error.message || 'Error desconocido' });
                        }
                    }
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                processedCount: results.length,
                                details: results,
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'ver_stock_actual': {
                const stock = await dao.obtenerStockConsolidado();
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(stock, null, 2),
                        },
                    ],
                };
            }
            case 'ver_saldos_oc': {
                const saldos = await dao.obtenerSaldosPorOC();
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(saldos, null, 2),
                        },
                    ],
                };
            }
            case 'vincular_codigos_sap': {
                const { codigo_sap_cliente, codigo_sap_interno, descripcion } = args;
                await dao.vincularCodigosSAP(codigo_sap_cliente, codigo_sap_interno, descripcion);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Vínculo creado: Cliente ${codigo_sap_cliente} <=> Interno ${codigo_sap_interno}.`,
                        },
                    ],
                };
            }
            case 'cargar_saldos_iniciales_oc': {
                const { oc_numero, fecha, items } = args;
                await dao.registrarOC({
                    numero: oc_numero,
                    tipo: 'OC',
                    fecha,
                    archivo_origen: 'CARGA_MANUAL_INICIAL',
                }, items.map(item => ({
                    ...item,
                    documento_numero: oc_numero,
                })));
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Orden de Compra Inicial ${oc_numero} cargada exitosamente.`,
                        },
                    ],
                };
            }
            case 'procesar_documento_por_ruta': {
                const { ruta_archivo, tipo } = args;
                if (!fs.existsSync(ruta_archivo)) {
                    throw new Error(`El archivo no existe en la ruta especificada: ${ruta_archivo}`);
                }
                const fileName = path.basename(ruta_archivo);
                if (tipo === 'OC') {
                    const extractedData = await (0, pdfProcessor_1.parseOCWithGemini)(ruta_archivo);
                    await dao.registrarOC({
                        numero: extractedData.numero,
                        tipo: 'OC',
                        fecha: extractedData.fecha,
                        archivo_origen: fileName,
                    }, extractedData.items.map(item => ({
                        ...item,
                        documento_numero: extractedData.numero,
                    })));
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    status: 'SUCCESS',
                                    tipo: 'OC',
                                    numero: extractedData.numero,
                                    message: `Orden de Compra ${extractedData.numero} cargada exitosamente en la base de datos.`,
                                }, null, 2),
                            },
                        ],
                    };
                }
                else {
                    const extractedData = await (0, pdfProcessor_1.parseRemitoWithGemini)(ruta_archivo);
                    const itemsToRegister = extractedData.items.map(item => ({
                        documento_numero: extractedData.numero,
                        oc_asociada_numero: extractedData.oc_asociada_numero,
                        codigo_sap_interno: item.codigo_sap_interno,
                        codigo_sap_cliente: item.codigo_sap_cliente,
                        cantidad_entregada: item.cantidad_entregada,
                        unidad: item.unidad,
                    }));
                    await dao.registrarRemito({
                        numero: extractedData.numero,
                        tipo: 'REMITO',
                        fecha: extractedData.fecha,
                        archivo_origen: fileName,
                    }, itemsToRegister);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    status: 'SUCCESS',
                                    tipo: 'REMITO',
                                    numero: extractedData.numero,
                                    oc_asociada: extractedData.oc_asociada_numero,
                                    message: `Remito ${extractedData.numero} imputado exitosamente contra OC ${extractedData.oc_asociada_numero}.`,
                                }, null, 2),
                            },
                        ],
                    };
                }
            }
            default:
                throw new types_js_1.McpError(types_js_1.ErrorCode.MethodNotFound, `Herramienta no encontrada: ${name}`);
        }
    }
    catch (error) {
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: error.message || 'Error durante la ejecución de la herramienta.',
                },
            ],
        };
    }
});
// Arrancar el servidor sobre STDIO
async function run() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
}
run().catch((error) => {
    process.exit(1);
});
