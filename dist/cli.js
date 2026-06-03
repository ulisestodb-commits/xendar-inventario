"use strict";
/**
 * Descripción Técnica: Interfaz de Línea de Comandos (CLI) para procesar PDFs de forma directa.
 *                      Evita las llamadas redundantes de los agentes de IA de n8n, realizando
 *                      únicamente una llamada directa a Gemini por archivo para optimizar cuotas.
 * Contexto SaaS: Xendar - Módulo: Procesamiento Rápido de Documentos
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
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const dao = __importStar(require("./database/inventoryDao"));
const pdfProcessor_1 = require("./services/pdfProcessor");
async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error(JSON.stringify({ status: 'ERROR', message: 'Uso: node cli.js <ruta_archivo> <OC|REMITO>' }));
        process.exit(1);
    }
    const rawPath = args[0];
    const tipo = args[1].toUpperCase();
    const filePath = path.resolve(rawPath);
    if (!fs.existsSync(filePath)) {
        console.error(JSON.stringify({ status: 'ERROR', message: `El archivo no existe en la ruta: ${filePath}` }));
        process.exit(1);
    }
    const fileName = path.basename(filePath);
    try {
        if (tipo === 'OC') {
            const extractedData = await (0, pdfProcessor_1.parseOCWithGemini)(filePath);
            await dao.registrarOC({
                numero: extractedData.numero,
                tipo: 'OC',
                fecha: extractedData.fecha,
                archivo_origen: fileName,
            }, extractedData.items.map(item => ({
                ...item,
                documento_numero: extractedData.numero,
            })));
            console.log(JSON.stringify({
                status: 'SUCCESS',
                tipo: 'OC',
                numero: extractedData.numero,
                message: `Orden de Compra ${extractedData.numero} registrada exitosamente.`
            }));
        }
        else {
            const extractedData = await (0, pdfProcessor_1.parseRemitoWithGemini)(filePath);
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
            console.log(JSON.stringify({
                status: 'SUCCESS',
                tipo: 'REMITO',
                numero: extractedData.numero,
                oc_asociada: extractedData.oc_asociada_numero,
                message: `Remito ${extractedData.numero} registrado contra OC ${extractedData.oc_asociada_numero}.`
            }));
        }
    }
    catch (error) {
        console.error(JSON.stringify({ status: 'ERROR', message: error.message }));
        process.exit(1);
    }
}
main();
