/**
 * Descripción Técnica: Servicio para procesar archivos PDF y estructurar la información
 *                      mediante el modelo Gemini 1.5/2.0/2.5.
 *                      Extrae el texto de los PDFs con `pdf-parse` y usa la API de Gemini
 *                      con esquema JSON estricto para parsear OCs y Remitos.
 * Contexto SaaS: Xendar - Módulo: Procesamiento OCR de Remitos y OCs
 */
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
export declare function extractTextFromPdf(filePath: string): Promise<string>;
/**
 * Procesa un PDF de Orden de Compra desde un Buffer en memoria (para la API web).
 */
export declare function parseOCFromBuffer(buffer: Buffer): Promise<ExtractedOC>;
/**
 * Procesa un PDF de Remito desde un Buffer en memoria (para la API web).
 */
export declare function parseRemitoFromBuffer(buffer: Buffer): Promise<ExtractedRemito>;
/**
 * Procesa un PDF de Orden de Compra usando Gemini con entrada multimodal directa.
 */
export declare function parseOCWithGemini(filePath: string): Promise<ExtractedOC>;
/**
 * Procesa un PDF de Remito usando Gemini con entrada multimodal directa.
 */
export declare function parseRemitoWithGemini(filePath: string): Promise<ExtractedRemito>;
