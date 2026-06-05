/**
 * Descripción Técnica: Servicio para procesar archivos PDF y estructurar la información
 *                      mediante el modelo Gemini 1.5/2.0/2.5.
 *                      Extrae el texto de los PDFs con `pdf-parse` y usa la API de Gemini
 *                      con esquema JSON estricto para parsear OCs y Remitos.
 * Contexto SaaS: Xendar - Módulo: Procesamiento OCR de Remitos y OCs
 */

import * as fs from 'fs';
import pdf from 'pdf-parse';
import { GoogleGenerativeAI, Schema, SchemaType } from '@google/generative-ai';
import * as dotenv from 'dotenv';

dotenv.config();

// Forzar uso de API v1 (requerido para keys de Google Cloud Console)
process.env.GOOGLE_AI_BACKEND = 'googleapis';
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Esquema JSON para Órdenes de Compra (OC)
const ocSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    numero: {
      type: SchemaType.STRING,
      description: "El número identificador de la Orden de Compra (ej. 43730624)."
    },
    fecha: {
      type: SchemaType.STRING,
      description: "La fecha de emisión del documento en formato YYYY-MM-DD."
    },
    items: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          item_posicion: { type: SchemaType.INTEGER, description: "Número de item o posición (ej. 10, 20)." },
          codigo_sap_cliente: { type: SchemaType.STRING, description: "Código de artículo de SAP del cliente." },
          descripcion: { type: SchemaType.STRING, description: "Descripción detallada del producto." },
          cantidad_original: { type: SchemaType.NUMBER, description: "Cantidad total de la orden." },
          unidad: { type: SchemaType.STRING, description: "Unidad de medida (ej. UN, KG, TN)." }
        },
        required: ["item_posicion", "codigo_sap_cliente", "descripcion", "cantidad_original", "unidad"]
      }
    }
  },
  required: ["numero", "fecha", "items"]
};

// Esquema JSON para Remitos
const remitoSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    numero: {
      type: SchemaType.STRING,
      description: "Número completo del remito (ej. 0015R00017623 o similar)."
    },
    fecha: {
      type: SchemaType.STRING,
      description: "La fecha del remito en formato YYYY-MM-DD."
    },
    oc_asociada_numero: {
      type: SchemaType.STRING,
      description: "Número de la Orden de Compra asociada al remito (ej. 43723584)."
    },
    items: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          codigo_sap_interno: { type: SchemaType.STRING, description: "Código interno del artículo en SAP." },
          codigo_sap_cliente: { type: SchemaType.STRING, description: "Código de SAP cliente / SAP AC." },
          descripcion: { type: SchemaType.STRING, description: "Descripción del artículo en el remito." },
          cantidad_entregada: { type: SchemaType.NUMBER, description: "Cantidad entregada física en el remito." },
          unidad: { type: SchemaType.STRING, description: "Unidad de medida (ej. KG, TN, UN)." }
        },
        required: ["codigo_sap_interno", "codigo_sap_cliente", "descripcion", "cantidad_entregada", "unidad"]
      }
    }
  },
  required: ["numero", "fecha", "oc_asociada_numero", "items"]
};

export interface ExtractedOC {
  numero: string;
  fecha: string;
  items: {
    item_posicion: number;
    codigo_sap_cliente: string;
    descripcion: string;
    cantidad_original: number;
    unidad: string;
  }[];
}

export interface ExtractedRemito {
  numero: string;
  fecha: string;
  oc_asociada_numero: string;
  items: {
    codigo_sap_interno: string;
    codigo_sap_cliente: string;
    descripcion: string;
    cantidad_entregada: number;
    unidad: string;
  }[];
}

/**
 * Lee un archivo PDF, extrae el texto usando pdf-parse.
 */
export async function extractTextFromPdf(filePath: string): Promise<string> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`El archivo no existe en la ruta especificada: ${filePath}`);
  }
  const dataBuffer = fs.readFileSync(filePath);
  const parsedData = await pdf(dataBuffer);
  return parsedData.text;
}

/**
 * Convierte un Buffer de PDF en la parte inlineData para Gemini.
 */
function bufferToPdfPart(buffer: Buffer) {
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
export async function parseOCFromBuffer(buffer: Buffer): Promise<ExtractedOC> {
  const modelName = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: { responseMimeType: 'application/json', responseSchema: ocSchema },
  });
  const prompt = `Analiza el documento adjunto (Orden de Compra / Pedido de Compras).
Extrae los datos requeridos de forma estricta según el esquema provisto.
Asegúrate de capturar la fecha en formato YYYY-MM-DD y limpiar los números eliminando separadores de miles y unidades para obtener números válidos en el JSON.`;
  const text = await generateContentWithRetry(model, [prompt, bufferToPdfPart(buffer)]);
  return JSON.parse(text) as ExtractedOC;
}

/**
 * Procesa un PDF de Remito desde un Buffer en memoria (para la API web).
 */
export async function parseRemitoFromBuffer(buffer: Buffer): Promise<ExtractedRemito> {
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
  return JSON.parse(text) as ExtractedRemito;
}

/**
 * Helper con reintentos automáticos y backoff exponencial ante errores 429 de cuota.
 */
async function generateContentWithRetry(
  model: any,
  contents: any,
  maxRetries = 5,
  initialDelayMs = 6000
): Promise<string> {
  let delay = initialDelayMs;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(contents);
      return result.response.text();
    } catch (error: any) {
      const errorText = error.message || '';
      const isRateLimit = errorText.includes('429') || errorText.includes('Quota exceeded') || errorText.includes('Too Many Requests');
      
      if (isRateLimit && attempt < maxRetries) {
        console.warn(`[Gemini API] Error 429 (Cuota excedida). Reintentando en ${delay / 1000} segundos (Intento ${attempt}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Backoff exponencial
      } else {
        throw error;
      }
    }
  }
  throw new Error("Se superó el límite máximo de reintentos ante la API de Gemini.");
}

/**
 * Procesa un PDF de Orden de Compra usando Gemini con entrada multimodal directa.
 */
export async function parseOCWithGemini(filePath: string): Promise<ExtractedOC> {
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
  return JSON.parse(text) as ExtractedOC;
}

/**
 * Procesa un PDF de Remito usando Gemini con entrada multimodal directa.
 */
export async function parseRemitoWithGemini(filePath: string): Promise<ExtractedRemito> {
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
  return JSON.parse(text) as ExtractedRemito;
}
