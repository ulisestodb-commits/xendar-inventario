/**
 * Descripción Técnica: Interfaz de Línea de Comandos (CLI) para procesar PDFs de forma directa.
 *                      Evita las llamadas redundantes de los agentes de IA de n8n, realizando
 *                      únicamente una llamada directa a Gemini por archivo para optimizar cuotas.
 * Contexto SaaS: Xendar - Módulo: Procesamiento Rápido de Documentos
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dao from './database/inventoryDao';
import { parseOCWithGemini, parseRemitoWithGemini } from './services/pdfProcessor';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(JSON.stringify({ status: 'ERROR', message: 'Uso: node cli.js <ruta_archivo> <OC|REMITO>' }));
    process.exit(1);
  }

  const rawPath = args[0];
  const tipo = args[1].toUpperCase() as 'OC' | 'REMITO';
  const filePath = path.resolve(rawPath);

  if (!fs.existsSync(filePath)) {
    console.error(JSON.stringify({ status: 'ERROR', message: `El archivo no existe en la ruta: ${filePath}` }));
    process.exit(1);
  }

  const fileName = path.basename(filePath);

  try {
    if (tipo === 'OC') {
      const extractedData = await parseOCWithGemini(filePath);
      await dao.registrarOC(
        {
          numero: extractedData.numero,
          tipo: 'OC',
          fecha: extractedData.fecha,
          archivo_origen: fileName,
        },
        extractedData.items.map(item => ({
          ...item,
          documento_numero: extractedData.numero,
        }))
      );
      console.log(JSON.stringify({ 
        status: 'SUCCESS', 
        tipo: 'OC',
        numero: extractedData.numero,
        message: `Orden de Compra ${extractedData.numero} registrada exitosamente.` 
      }));
    } else {
      const extractedData = await parseRemitoWithGemini(filePath);
      const itemsToRegister = extractedData.items.map(item => ({
        documento_numero: extractedData.numero,
        oc_asociada_numero: extractedData.oc_asociada_numero,
        codigo_sap_interno: item.codigo_sap_interno,
        codigo_sap_cliente: item.codigo_sap_cliente,
        cantidad_entregada: item.cantidad_entregada,
        unidad: item.unidad,
      }));

      await dao.registrarRemito(
        {
          numero: extractedData.numero,
          tipo: 'REMITO',
          fecha: extractedData.fecha,
          archivo_origen: fileName,
        },
        itemsToRegister
      );
      console.log(JSON.stringify({ 
        status: 'SUCCESS', 
        tipo: 'REMITO',
        numero: extractedData.numero,
        oc_asociada: extractedData.oc_asociada_numero,
        message: `Remito ${extractedData.numero} registrado contra OC ${extractedData.oc_asociada_numero}.` 
      }));
    }
  } catch (error: any) {
    console.error(JSON.stringify({ status: 'ERROR', message: error.message }));
    process.exit(1);
  }
}

main();
