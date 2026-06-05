/**
 * Servidor Web API REST para la plataforma de gestión de inventario.
 * Expone endpoints para consultar y gestionar OCs, Remitos y Stock.
 */

import express from 'express';
import cors from 'cors';
import * as path from 'path';
import * as os from 'os';
import multer from 'multer';
import * as XLSX from 'xlsx';
import * as dao from '../database/inventoryDao';
import { getDatabase } from '../database/db';
import { parseOCFromBuffer, parseRemitoFromBuffer } from '../services/pdfProcessor';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || process.env.WEB_PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', '..', 'public')));

// Multer: almacena en memoria (no en disco)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ===================== IMPORTAR EXCEL =====================

/**
 * POST /api/importar-excel/preview
 * Recibe el archivo Excel y devuelve una vista previa de las filas detectadas
 * sin escribir nada en la base de datos.
 */
app.post('/api/importar-excel/preview', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo.' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheetName = req.body.hoja || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return res.status(400).json({ error: `Hoja '${sheetName}' no encontrada.` });

    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!rows.length) return res.status(400).json({ error: 'La hoja está vacía.' });

    // Auto-detectar columnas buscando palabras clave en los headers
    const headers = Object.keys(rows[0]);
    const findCol = (...keywords: string[]) =>
      headers.find(h => keywords.some(k => h.toLowerCase().includes(k.toLowerCase()))) || null;

    const colInterno  = findCol('RHIM', 'RHI', 'interno', 'nuestro', 'propio', 'SAP_INT', 'cod_int');
    const colCliente  = findCol('ACN', 'cliente', 'SAP_CLI', 'cod_cli', 'sap ac', 'sapac');
    const colDesc     = findCol('descripcion', 'descripción', 'desc', 'articulo', 'artículo', 'producto', 'nombre');
    const colSaldo    = findCol('saldo', 'stock', 'cantidad', 'qty', 'existencia', 'balance');
    const colUnidad   = findCol('unidad', 'um', 'uom', 'unit');
    const colKgUn     = findCol('kg/un', 'kg_un', 'peso', 'kg un'); // peso unitario (informativo)

    const parsed = rows.map((row, i) => ({
      fila: i + 2,
      codigo_sap_interno:  colInterno ? String(row[colInterno] ?? '').trim() : '',
      codigo_sap_cliente:  colCliente ? String(row[colCliente] ?? '').trim() : '',
      descripcion:         colDesc    ? String(row[colDesc]    ?? '').trim() : '',
      saldo:               colSaldo   ? Number(row[colSaldo]   ?? 0)         : 0,
      unidad:              colUnidad  ? String(row[colUnidad]  ?? 'UN').trim() : 'UN',
      kg_un:               colKgUn    ? Number(row[colKgUn]   ?? 0)         : null,
    })).filter(r => r.codigo_sap_interno || r.codigo_sap_cliente); // ignorar filas vacías

    res.json({
      hojas: workbook.SheetNames,
      hojaUsada: sheetName,
      columnasDetectadas: { colInterno, colCliente, colDesc, colSaldo, colUnidad, colKgUn },
      totalFilas: parsed.length,
      preview: parsed.slice(0, 10), // primeras 10 para preview
      todas: parsed,                // todas para importar
    });

  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/importar-excel/confirmar
 * Recibe los datos ya parseados (del preview) y los importa a la DB.
 * Crea una OC "SALDO_INICIAL_<fecha>" con todos los ítems.
 */
app.post('/api/importar-excel/confirmar', async (req, res) => {
  try {
    const { filas, oc_numero } = req.body as {
      filas: { codigo_sap_interno: string; codigo_sap_cliente: string; descripcion: string; saldo: number; unidad: string }[];
      oc_numero: string;
    };

    if (!filas || !filas.length) return res.status(400).json({ error: 'Sin filas para importar.' });

    const db = await (await import('../database/db')).getDatabase();
    await db.run('BEGIN TRANSACTION');

    try {
      const hoy = new Date().toISOString().split('T')[0];
      const ocNum = oc_numero || `SALDO_INI_${hoy.replace(/-/g, '')}`;

      // Verificar si la OC ya existe
      const existe = await db.get('SELECT 1 FROM documentos WHERE numero = ?', [ocNum]);
      if (existe) throw new Error(`La OC de saldo inicial '${ocNum}' ya existe. Elegí otro nombre.`);

      // Insertar documento OC de saldo inicial
      await db.run(
        'INSERT INTO documentos (numero, tipo, fecha, archivo_origen) VALUES (?, ?, ?, ?)',
        [ocNum, 'OC', hoy, 'IMPORTACION_EXCEL']
      );

      let pos = 10;
      for (const fila of filas) {
        if (!fila.codigo_sap_cliente && !fila.codigo_sap_interno) continue;
        const sapCliente = fila.codigo_sap_cliente || fila.codigo_sap_interno;

        // Insertar ítem OC con saldo inicial
        await db.run(
          `INSERT OR IGNORE INTO items_oc
           (documento_numero, item_posicion, codigo_sap_cliente, descripcion, cantidad_original, saldo_pendiente, unidad)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [ocNum, pos, sapCliente, fila.descripcion, fila.saldo, fila.saldo, fila.unidad || 'UN']
        );

        // Crear/actualizar mapeo de códigos SAP
        if (fila.codigo_sap_interno && fila.codigo_sap_cliente) {
          await db.run(
            `INSERT INTO mapeo_codigos_sap (codigo_sap_cliente, codigo_sap_interno, descripcion)
             VALUES (?, ?, ?)
             ON CONFLICT(codigo_sap_cliente) DO UPDATE SET
               codigo_sap_interno = excluded.codigo_sap_interno,
               descripcion = COALESCE(excluded.descripcion, mapeo_codigos_sap.descripcion)`,
            [fila.codigo_sap_cliente, fila.codigo_sap_interno, fila.descripcion || null]
          );
        }

        pos += 10;
      }

      await db.run('COMMIT');
      res.json({ success: true, oc_creada: ocNum, items_importados: filas.length });
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== PROCESAR PDF =====================

/**
 * POST /api/procesar-pdf/preview
 * Recibe un PDF y el tipo ('OC' o 'REMITO'), lo procesa con Gemini y
 * devuelve el JSON extraído junto con si el documento ya existe en la DB.
 */
app.post('/api/procesar-pdf/preview', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo.' });
    if (!req.file.originalname.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'Solo se aceptan archivos PDF.' });
    }

    const tipo = (req.body.tipo || '').toUpperCase();
    if (tipo !== 'OC' && tipo !== 'REMITO') {
      return res.status(400).json({ error: "El campo 'tipo' debe ser 'OC' o 'REMITO'." });
    }

    const db = await getDatabase();
    let datos: any;

    if (tipo === 'OC') {
      datos = await parseOCFromBuffer(req.file.buffer);
      // Enriquecer ítems de OC con la descripción del maestro de productos (EXCEL cargado)
      for (const item of datos.items) {
        if (item.codigo_sap_cliente) {
          const maestro = await db.get('SELECT descripcion FROM mapeo_codigos_sap WHERE codigo_sap_cliente = ?', [item.codigo_sap_cliente]);
          item.descripcion = maestro?.descripcion || 'Producto no encontrado en maestro';
        }
      }
    } else {
      datos = await parseRemitoFromBuffer(req.file.buffer);
    }

    // Verificar si ya existe en la DB
    const existe = await db.get('SELECT numero, tipo FROM documentos WHERE numero = ?', [datos.numero]);

    // Para remitos: verificar si la OC asociada existe
    let ocAsociadaExiste = null;
    if (tipo === 'REMITO' && datos.oc_asociada_numero) {
      const oc = await db.get('SELECT numero FROM documentos WHERE numero = ? AND tipo = ?', [datos.oc_asociada_numero, 'OC']);
      ocAsociadaExiste = !!oc;
    }

    res.json({ tipo, datos, yaExiste: !!existe, ocAsociadaExiste });

  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/procesar-pdf/confirmar-oc
 * Recibe los datos de una OC (ya validados en el frontend) y los persiste en la DB.
 */
app.post('/api/procesar-pdf/confirmar-oc', async (req, res) => {
  try {
    const { numero, fecha, items, archivo_origen } = req.body;
    if (!numero || !fecha || !items?.length) {
      return res.status(400).json({ error: 'Datos de OC incompletos.' });
    }

    const db = await getDatabase();

    // Verificar duplicado
    const existe = await db.get('SELECT 1 FROM documentos WHERE numero = ?', [numero]);
    if (existe) return res.status(409).json({ error: `La OC ${numero} ya existe en el sistema.` });

    await db.run('BEGIN TRANSACTION');
    try {
      await db.run(
        'INSERT INTO documentos (numero, tipo, fecha, archivo_origen) VALUES (?, ?, ?, ?)',
        [numero, 'OC', fecha, archivo_origen || 'PDF_WEB']
      );

      for (const item of items) {
        await db.run(
          `INSERT INTO items_oc
           (documento_numero, item_posicion, codigo_sap_cliente, descripcion, cantidad_original, saldo_pendiente, unidad)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [numero, item.item_posicion, item.codigo_sap_cliente, item.descripcion, item.cantidad_original, item.cantidad_original, item.unidad || 'UN']
        );
      }

      await db.run('COMMIT');
      res.json({ success: true, oc_creada: numero, items_insertados: items.length });
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/procesar-pdf/confirmar-remito
 * Recibe los datos de un Remito, lo persiste y descuenta el stock de la OC asociada.
 */
app.post('/api/procesar-pdf/confirmar-remito', async (req, res) => {
  try {
    const { numero, fecha, oc_asociada_numero, items, archivo_origen } = req.body;
    if (!numero || !fecha || !oc_asociada_numero || !items?.length) {
      return res.status(400).json({ error: 'Datos de Remito incompletos.' });
    }

    const db = await getDatabase();

    // Verificar duplicado
    const existeRemito = await db.get('SELECT 1 FROM documentos WHERE numero = ?', [numero]);
    if (existeRemito) return res.status(409).json({ error: `El Remito ${numero} ya existe en el sistema.` });

    // Verificar que la OC asociada existe
    const existeOC = await db.get('SELECT 1 FROM documentos WHERE numero = ? AND tipo = ?', [oc_asociada_numero, 'OC']);
    if (!existeOC) return res.status(404).json({ error: `La OC ${oc_asociada_numero} no existe en el sistema. Importá la OC primero.` });

    await db.run('BEGIN TRANSACTION');
    try {
      await db.run(
        'INSERT INTO documentos (numero, tipo, fecha, archivo_origen) VALUES (?, ?, ?, ?)',
        [numero, 'REMITO', fecha, archivo_origen || 'PDF_WEB']
      );

      for (const item of items) {
        // Insertar item remito
        await db.run(
          `INSERT INTO items_remito
           (documento_numero, oc_asociada_numero, codigo_sap_interno, codigo_sap_cliente, cantidad_entregada, unidad)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [numero, oc_asociada_numero, item.codigo_sap_interno || '', item.codigo_sap_cliente, item.cantidad_entregada, item.unidad || 'UN']
        );

        // Descontar saldo en la OC
        await db.run(
          `UPDATE items_oc SET saldo_pendiente = saldo_pendiente - ?
           WHERE documento_numero = ? AND codigo_sap_cliente = ?`,
          [item.cantidad_entregada, oc_asociada_numero, item.codigo_sap_cliente]
        );
      }

      await db.run('COMMIT');
      res.json({ success: true, remito_creado: numero, items_insertados: items.length });
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== STOCK =====================

app.get('/api/stock', async (req, res) => {
  try {
    const stock = await dao.obtenerStockConsolidado();
    res.json(stock);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Desglose de saldo por OC para un código SAP cliente específico
app.get('/api/stock/:codigo/por-oc', async (req, res) => {
  try {
    const db = await getDatabase();
    const rows = await db.all(`
      SELECT
        io.documento_numero   AS oc_numero,
        doc.fecha             AS oc_fecha,
        doc.archivo_origen,
        io.cantidad_original,
        io.saldo_pendiente,
        io.unidad,
        ROUND((io.saldo_pendiente * 100.0 / NULLIF(io.cantidad_original, 0)), 1) AS pct_restante
      FROM items_oc io
      JOIN documentos doc ON io.documento_numero = doc.numero
      WHERE io.codigo_sap_cliente = ?
      ORDER BY doc.fecha ASC
    `, [req.params.codigo]);
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== OCs =====================

/**
 * GET /api/productos/buscar
 * Busca productos en el maestro (mapeo_codigos_sap) por descripción o código.
 * Usado para autocompletar en la carga manual de OC.
 */
app.get('/api/productos/buscar', async (req, res) => {
  try {
    const q = (req.query.q as string) || '';
    if (q.length < 2) return res.json([]);
    const db = await getDatabase();
    const query = `%${q}%`;
    const productos = await db.all(
      `SELECT codigo_sap_cliente, codigo_sap_interno, descripcion
       FROM mapeo_codigos_sap
       WHERE descripcion LIKE ? OR codigo_sap_cliente LIKE ? OR codigo_sap_interno LIKE ?
       LIMIT 20`,
      [query, query, query]
    );
    res.json(productos);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ocs/con-saldo — OCs que tienen al menos un ítem con saldo pendiente > 0
// IMPORTANTE: debe ir ANTES de /api/ocs/:numero para que Express no lo confunda
app.get('/api/ocs/con-saldo', async (req, res) => {
  try {
    const db = await getDatabase();
    const rows = await db.all(`
      SELECT d.numero, d.fecha,
             COUNT(io.id) as total_items,
             ROUND(SUM(io.saldo_pendiente), 3) as saldo_total
      FROM documentos d
      JOIN items_oc io ON d.numero = io.documento_numero
      WHERE d.tipo = 'OC' AND io.saldo_pendiente > 0
      GROUP BY d.numero
      ORDER BY d.fecha DESC
    `);
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ocs/:numero/productos — productos disponibles (saldo > 0) de una OC específica
app.get('/api/ocs/:numero/productos', async (req, res) => {
  try {
    const db = await getDatabase();
    const rows = await db.all(`
      SELECT
        io.id,
        io.codigo_sap_cliente,
        io.descripcion,
        ROUND(io.saldo_pendiente, 3)  AS saldo_pendiente,
        ROUND(io.cantidad_original, 3) AS cantidad_original,
        io.unidad,
        COALESCE(m.codigo_sap_interno, '') AS codigo_sap_interno
      FROM items_oc io
      LEFT JOIN mapeo_codigos_sap m ON io.codigo_sap_cliente = m.codigo_sap_cliente
      WHERE io.documento_numero = ? AND io.saldo_pendiente > 0
      ORDER BY io.item_posicion
    `, [req.params.numero]);
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/ocs', async (req, res) => {
  try {
    const db = await getDatabase();
    const ocs = await db.all(`
      SELECT 
        d.numero, d.fecha, d.archivo_origen, d.creado_en,
        COUNT(io.id) as total_items,
        SUM(io.cantidad_original) as total_cantidad_original,
        SUM(io.saldo_pendiente) as total_saldo_pendiente,
        MIN(io.unidad) as unidad
      FROM documentos d
      LEFT JOIN items_oc io ON d.numero = io.documento_numero
      WHERE d.tipo = 'OC'
      GROUP BY d.numero
      ORDER BY d.fecha DESC
    `);
    res.json(ocs);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/ocs/:numero/items', async (req, res) => {
  try {
    const db = await getDatabase();
    const items = await db.all(
      `SELECT io.*, m.codigo_sap_interno as sap_interno_mapeado
       FROM items_oc io
       LEFT JOIN mapeo_codigos_sap m ON io.codigo_sap_cliente = m.codigo_sap_cliente
       WHERE io.documento_numero = ?
       ORDER BY io.item_posicion`,
      [req.params.numero]
    );
    res.json(items);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/ocs/:numero/items/:id', async (req, res) => {
  try {
    const db = await getDatabase();
    const { descripcion, cantidad_original, saldo_pendiente, unidad } = req.body;
    await db.run(
      `UPDATE items_oc SET descripcion = ?, cantidad_original = ?, saldo_pendiente = ?, unidad = ?
       WHERE id = ? AND documento_numero = ?`,
      [descripcion, cantidad_original, saldo_pendiente, unidad, req.params.id, req.params.numero]
    );
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/ocs/:numero', async (req, res) => {
  try {
    const db = await getDatabase();
    // Verificar si tiene remitos asociados
    const remitosAsoc = await db.get(
      `SELECT COUNT(*) as cnt FROM items_remito WHERE oc_asociada_numero = ?`,
      [req.params.numero]
    );
    if (remitosAsoc && remitosAsoc.cnt > 0) {
      return res.status(400).json({
        error: `No se puede dar de baja la OC ${req.params.numero} porque tiene ${remitosAsoc.cnt} remito(s) asociado(s). Primero dé de baja los remitos.`
      });
    }
    await db.run('DELETE FROM documentos WHERE numero = ? AND tipo = ?', [req.params.numero, 'OC']);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== REMITOS =====================

app.get('/api/remitos', async (req, res) => {
  try {
    const db = await getDatabase();
    const remitos = await db.all(`
      SELECT 
        d.numero, d.fecha, d.archivo_origen, d.creado_en,
        COUNT(ir.id) as total_items,
        SUM(ir.cantidad_entregada) as total_entregado,
        GROUP_CONCAT(DISTINCT ir.oc_asociada_numero) as ocs_asociadas,
        MIN(ir.unidad) as unidad
      FROM documentos d
      LEFT JOIN items_remito ir ON d.numero = ir.documento_numero
      WHERE d.tipo = 'REMITO'
      GROUP BY d.numero
      ORDER BY d.fecha DESC
    `);
    res.json(remitos);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/remitos/:numero/items', async (req, res) => {
  try {
    const db = await getDatabase();
    const items = await db.all(
      `SELECT ir.*, io.descripcion, io.saldo_pendiente as saldo_oc_actual
       FROM items_remito ir
       LEFT JOIN items_oc io ON ir.oc_asociada_numero = io.documento_numero 
         AND ir.codigo_sap_cliente = io.codigo_sap_cliente
       WHERE ir.documento_numero = ?`,
      [req.params.numero]
    );
    res.json(items);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Modificar cantidad entregada de un ítem de remito (ajusta el saldo de la OC)
app.put('/api/remitos/:numero/items/:id', async (req, res) => {
  try {
    const db = await getDatabase();
    const { nueva_cantidad } = req.body;
    await db.run('BEGIN TRANSACTION');
    try {
      // Obtener el item actual
      const item = await db.get('SELECT * FROM items_remito WHERE id = ?', [req.params.id]);
      if (!item) throw new Error('Item no encontrado');

      const diff = nueva_cantidad - item.cantidad_entregada;

      // Verificar saldo disponible en la OC si se está aumentando
      if (diff > 0) {
        const itemOC = await db.get(
          'SELECT saldo_pendiente FROM items_oc WHERE documento_numero = ? AND codigo_sap_cliente = ?',
          [item.oc_asociada_numero, item.codigo_sap_cliente]
        );
        if (!itemOC || itemOC.saldo_pendiente < diff) {
          throw new Error(`Saldo insuficiente en OC ${item.oc_asociada_numero}. Disponible: ${itemOC?.saldo_pendiente || 0}`);
        }
      }

      // Ajustar saldo de la OC (revertir la diferencia)
      await db.run(
        `UPDATE items_oc SET saldo_pendiente = saldo_pendiente - ?
         WHERE documento_numero = ? AND codigo_sap_cliente = ?`,
        [diff, item.oc_asociada_numero, item.codigo_sap_cliente]
      );

      // Actualizar cantidad del remito
      await db.run('UPDATE items_remito SET cantidad_entregada = ? WHERE id = ?', [nueva_cantidad, req.params.id]);
      await db.run('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Dar de baja un remito (revierte los saldos en la OC)
app.delete('/api/remitos/:numero', async (req, res) => {
  try {
    const db = await getDatabase();
    await db.run('BEGIN TRANSACTION');
    try {
      // Obtener todos los items del remito para revertir saldos
      const items = await db.all(
        'SELECT * FROM items_remito WHERE documento_numero = ?',
        [req.params.numero]
      );

      // Revertir cada descuento en la OC correspondiente
      for (const item of items) {
        await db.run(
          `UPDATE items_oc SET saldo_pendiente = saldo_pendiente + ?
           WHERE documento_numero = ? AND codigo_sap_cliente = ?`,
          [item.cantidad_entregada, item.oc_asociada_numero, item.codigo_sap_cliente]
        );
      }

      // Eliminar el documento (CASCADE elimina items_remito)
      await db.run('DELETE FROM documentos WHERE numero = ? AND tipo = ?', [req.params.numero, 'REMITO']);
      await db.run('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== INICIO =====================

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`\n🚀 Plataforma de Inventario corriendo en: http://0.0.0.0:${PORT}\n`);
});

export default app;
