/**
 * Descripción Técnica: Script de prueba real para verificar la API de Gemini
 *                      y estructurar los PDFs reales.
 * Contexto SaaS: Xendar - Módulo: Procesamiento OCR de Remitos y OCs
 */

import { extractTextFromPdf, parseOCWithGemini, parseRemitoWithGemini } from './services/pdfProcessor';
import * as path from 'path';

async function runRealTests() {
  console.log('=== Iniciando Prueba de Lectura de PDF con Gemini ===');
  
  try {
    const ocPath = path.join(__dirname, '..', 'OC', 'OC TIPICA.pdf');
    console.log(`Leyendo OC en: ${ocPath}`);
    console.log('Llamando a Gemini (multimodal PDF)...');
    const dataOC = await parseOCWithGemini(ocPath);
    console.log('Resultados de Extracción de OC:');
    console.log(JSON.stringify(dataOC, null, 2));

    console.log('\n----------------------------------------\n');

    const remitoPath = path.join(__dirname, '..', 'REMITOS', 'REMITO TIPICO.pdf');
    console.log(`Leyendo Remito en: ${remitoPath}`);
    console.log('Llamando a Gemini (multimodal PDF)...');
    const dataRemito = await parseRemitoWithGemini(remitoPath);
    console.log('Resultados de Extracción del Remito:');
    console.log(JSON.stringify(dataRemito, null, 2));

  } catch (error: any) {
    console.error('Error durante la prueba con Gemini API:', error.message || error);
    if (error.stack) console.error(error.stack);
  }
}

runRealTests();
