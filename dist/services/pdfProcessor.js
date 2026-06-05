"use strict";
/**
 * Descripción Técnica: Servicio para procesar archivos PDF y estructurar la información
 *                      mediante el modelo Gemini 1.5/2.0/2.5.
 *                      Extrae el texto de los PDFs con `pdf-parse` y usa la API de Gemini
 *                      con esquema JSON estricto para parsear OCs y Remitos.
 * Contexto SaaS: Xendar - Módulo: Procesamiento OCR de Remitos y OCs
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractTextFromPdf = extractTextFromPdf;
exports.parseOCFromBuffer = parseOCFromBuffer;
exports.parseRemitoFromBuffer = parseRemitoFromBuffer;
exports.parseOCWithGemini = parseOCWithGemini;
exports.parseRemitoWithGemini = parseRemitoWithGemini;
const fs = __importStar(require("fs"));
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const generative_ai_1 = require("@google/generative-ai");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
// Forzar uso de API v1 (requerido para keys de Google Cloud Console)
process.env.GOOGLE_AI_BACKEND = 'googleapis';
const genAI = new generative_ai_1.GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
// Esquema JSON para Órdenes de Compra (OC)
const ocSchema = {
    type: generative_ai_1.SchemaType.OBJECT,
    properties: {
        numero: {
            type: generative_ai_1.SchemaType.STRING,
            description: "El número identificador de la Orden de Compra (ej. 43730624)."
        },
        fecha: {
            type: generative_ai_1.SchemaType.STRING,
            description: "La fecha de emisión del documento en formato YYYY-MM-DD."
        },
        items: {
            type: generative_ai_1.SchemaType.ARRAY,
            items: {
                type: generative_ai_1.SchemaType.OBJECT,
                properties: {
                    item_posicion: { type: generative_ai_1.SchemaType.INTEGER, description: "Número de item o posición (ej. 10, 20)." },
                    codigo_sap_cliente: { type: generative_ai_1.SchemaType.STRING, description: "Código de artículo de SAP del cliente." },
                    cantidad_original: { type: generative_ai_1.SchemaType.NUMBER, description: "Cantidad total de la orden." },
                    unidad: { type: generative_ai_1.SchemaType.STRING, description: "Unidad de medida (ej. UN, KG, TN)." }
                },
                required: ["item_posicion", "codigo_sap_cliente", "cantidad_original", "unidad"]
            }
        }
    },
    required: ["numero", "fecha", "items"]
};
// Esquema JSON para Remitos
const remitoSchema = {
    type: generative_ai_1.SchemaType.OBJECT,
    properties: {
        numero: {
            type: generative_ai_1.SchemaType.STRING,
            description: "Número completo del remito (ej. 0015R00017623 o similar)."
        },
        fecha: {
            type: generative_ai_1.SchemaType.STRING,
            description: "La fecha del remito en formato YYYY-MM-DD."
        },
        oc_asociada_numero: {
            type: generative_ai_1.SchemaType.STRING,
            description: "Número de la Orden de Compra asociada al remito (ej. 43723584)."
        },
        items: {
            type: generative_ai_1.SchemaType.ARRAY,
            items: {
                type: generative_ai_1.SchemaType.OBJECT,
                properties: {
                    codigo_sap_interno: { type: generative_ai_1.SchemaType.STRING, description: "Código interno del artículo en SAP." },
                    codigo_sap_cliente: { type: generative_ai_1.SchemaType.STRING, description: "Código de SAP cliente / SAP AC." },
                    descripcion: { type: generative_ai_1.SchemaType.STRING, description: "Descripción del artículo en el remito." },
                    cantidad_entregada: { type: generative_ai_1.SchemaType.NUMBER, description: "Cantidad entregada física en el remito." },
                    unidad: { type: generative_ai_1.SchemaType.STRING, description: "Unidad de medida (ej. KG, TN, UN)." }
                },
                required: ["codigo_sap_interno", "codigo_sap_cliente", "descripcion", "cantidad_entregada", "unidad"]
            }
        }
    },
    required: ["numero", "fecha", "oc_asociada_numero", "items"]
};
/**
 * Lee un archivo PDF, extrae el texto usando pdf-parse.
 */
async function extractTextFromPdf(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`El archivo no existe en la ruta especificada: ${filePath}`);
    }
    const dataBuffer = fs.readFileSync(filePath);
    const parsedData = await (0, pdf_parse_1.default)(dataBuffer);
    return parsedData.text;
}
/**
 * Convierte un Buffer de PDF en la parte inlineData para Gemini.
 */
function bufferToPdfPart(buffer) {
    return {
        inlineData: {
            data: buffer.toString('base64'),
            mimeType: 'application/pdf',
        },
    };
}
/**
 * Procesa un PDF de Orden de Compra desde un Buffer en memoria (para la API web).
 */
async function parseOCFromBuffer(buffer) {
    const modelName = process.env.GEMINI_MODEL || 'gemini-flash-latest';
    const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: 'application/json', responseSchema: ocSchema },
    });
    const prompt = `Analiza el documento adjunto (Orden de Compra / Pedido de Compras).
Extrae los datos requeridos de forma estricta según el esquema provisto.
Asegúrate de capturar la fecha en formato YYYY-MM-DD y limpiar los números eliminando separadores de miles y unidades para obtener números válidos en el JSON.`;
    const text = await generateContentWithRetry(model, [prompt, bufferToPdfPart(buffer)]);
    return JSON.parse(text);
}
/**
 * Procesa un PDF de Remito desde un Buffer en memoria (para la API web).
 */
async function parseRemitoFromBuffer(buffer) {
    const modelName = process.env.GEMINI_MODEL || 'gemini-flash-latest';
    const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: 'application/json', responseSchema: remitoSchema },
    });
    const prompt = `Analiza el documento adjunto (Remito / Remito de Entrega).
Extrae los datos requeridos de forma estricta según el esquema provisto.
Presta especial atención al número de la Orden de Compra asociada al remito (generalmente antecedido por 'OC#', 'Orden de Compra', 'Pedido', 'OC', etc., ej: 43723584).
Asegúrate de capturar la fecha en formato YYYY-MM-DD y limpiar las cantidades.`;
    const text = await generateContentWithRetry(model, [prompt, bufferToPdfPart(buffer)]);
    return JSON.parse(text);
}
/**
 * Helper con reintentos automáticos y backoff exponencial ante errores 429 de cuota.
 */
async function generateContentWithRetry(model, contents, maxRetries = 5, initialDelayMs = 6000) {
    let delay = initialDelayMs;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await model.generateContent(contents);
            return result.response.text();
        }
        catch (error) {
            const errorText = error.message || '';
            const isRateLimit = errorText.includes('429') || errorText.includes('Quota exceeded') || errorText.includes('Too Many Requests');
            if (isRateLimit && attempt < maxRetries) {
                console.warn(`[Gemini API] Error 429 (Cuota excedida). Reintentando en ${delay / 1000} segundos (Intento ${attempt}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Backoff exponencial
            }
            else {
                throw error;
            }
        }
    }
    throw new Error("Se superó el límite máximo de reintentos ante la API de Gemini.");
}
/**
 * Procesa un PDF de Orden de Compra usando Gemini con entrada multimodal directa.
 */
async function parseOCWithGemini(filePath) {
    const modelName = process.env.GEMINI_MODEL || "gemini-flash-latest";
    const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: ocSchema,
        }
    });
    const pdfBuffer = fs.readFileSync(filePath);
    const pdfPart = {
        inlineData: {
            data: pdfBuffer.toString("base64"),
            mimeType: "application/pdf"
        }
    };
    const prompt = `Analiza el documento adjunto (Orden de Compra / Pedido de Compras).
Extrae los datos requeridos de forma estricta según el esquema provisto.
Asegúrate de capturar la fecha en formato YYYY-MM-DD y limpiar los números eliminando separadores de miles y unidades para obtener números válidos en el JSON.`;
    const text = await generateContentWithRetry(model, [prompt, pdfPart]);
    return JSON.parse(text);
}
/**
 * Procesa un PDF de Remito usando Gemini con entrada multimodal directa.
 */
async function parseRemitoWithGemini(filePath) {
    const modelName = process.env.GEMINI_MODEL || "gemini-flash-latest";
    const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: remitoSchema,
        }
    });
    const pdfBuffer = fs.readFileSync(filePath);
    const pdfPart = {
        inlineData: {
            data: pdfBuffer.toString("base64"),
            mimeType: "application/pdf"
        }
    };
    const prompt = `Analiza el documento adjunto (Remito / Remito de Entrega).
Extrae los datos requeridos de forma estricta según el esquema provisto.
Presta especial atención al número de la Orden de Compra asociada al remito (generalmente antecedido por 'OC#', 'Orden de Compra', 'Pedido', 'OC', etc., ej: 43723584).
Asegúrate de capturar la fecha en formato YYYY-MM-DD y limpiar las cantidades.`;
    const text = await generateContentWithRetry(model, [prompt, pdfPart]);
    return JSON.parse(text);
}
