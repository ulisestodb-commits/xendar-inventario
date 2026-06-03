/**
 * Descripción Técnica: DAO para interactuar con la base de datos de inventario.
 *                      Implementa operaciones transaccionales para registro de OC,
 *                      validación y procesamiento de remitos con deducción atómica de saldos,
 *                      y consulta de existencias.
 * Contexto SaaS: Xendar - Módulo: Sincronización de Inventario y Validación de Remitos
 */

import { getDatabase } from './db';

export interface Documento {
  numero: string;
  tipo: 'OC' | 'REMITO';
  fecha: string;
  archivo_origen?: string;
}

export interface ItemOC {
  documento_numero: string;
  item_posicion: number;
  codigo_sap_cliente: string;
  descripcion: string;
  cantidad_original: number;
  saldo_pendiente: number;
  unidad: string;
}

export interface ItemRemito {
  documento_numero: string;
  oc_asociada_numero: string;
  codigo_sap_interno: string;
  codigo_sap_cliente: string;
  cantidad_entregada: number;
  unidad: string;
}

export interface StockConsolidado {
  codigo_sap_cliente: string;
  codigo_sap_interno: string | null;
  descripcion: string;
  saldo_general: number;
  unidad: string;
}

/**
 * Verifica si un documento (OC o Remito) ya existe en el sistema.
 */
export async function existeDocumento(numero: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.get('SELECT 1 FROM documentos WHERE numero = ?', [numero]);
  return !!row;
}

/**
 * Inserta o actualiza un mapeo de códigos SAP.
 */
export async function vincularCodigosSAP(
  codigoCliente: string,
  codigoInterno: string,
  descripcion?: string
): Promise<void> {
  const db = await getDatabase();
  await db.run(
    `INSERT INTO mapeo_codigos_sap (codigo_sap_cliente, codigo_sap_interno, descripcion)
     VALUES (?, ?, ?)
     ON CONFLICT(codigo_sap_cliente) DO UPDATE SET
       codigo_sap_interno = excluded.codigo_sap_interno,
       descripcion = COALESCE(excluded.descripcion, mapeo_codigos_sap.descripcion)`,
    [codigoCliente, codigoInterno, descripcion || null]
  );
}

/**
 * Registra una Orden de Compra y sus ítems de forma atómica.
 */
export async function registrarOC(doc: Documento, items: Omit<ItemOC, 'saldo_pendiente'>[]): Promise<void> {
  const db = await getDatabase();
  await db.run('BEGIN TRANSACTION');

  try {
    // Validar duplicado
    const exist = await db.get('SELECT 1 FROM documentos WHERE numero = ?', [doc.numero]);
    if (exist) {
      throw new Error(`La Orden de Compra ${doc.numero} ya se encuentra registrada.`);
    }

    // Insertar documento
    await db.run(
      'INSERT INTO documentos (numero, tipo, fecha, archivo_origen) VALUES (?, ?, ?, ?)',
      [doc.numero, 'OC', doc.fecha, doc.archivo_origen || '']
    );

    // Insertar items
    for (const item of items) {
      await db.run(
        `INSERT INTO items_oc (documento_numero, item_posicion, codigo_sap_cliente, descripcion, cantidad_original, saldo_pendiente, unidad)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          doc.numero,
          item.item_posicion,
          item.codigo_sap_cliente,
          item.descripcion,
          item.cantidad_original,
          item.cantidad_original, // El saldo inicial es igual a la cantidad original
          item.unidad
        ]
      );
    }

    await db.run('COMMIT');
  } catch (error) {
    await db.run('ROLLBACK');
    throw error;
  }
}

/**
 * Registra un Remito y descuenta los saldos de la OC asociada de forma atómica.
 * Si alguna validación de saldo falla, se revierte toda la transacción.
 */
export async function registrarRemito(doc: Documento, items: ItemRemito[]): Promise<void> {
  const db = await getDatabase();
  await db.run('BEGIN TRANSACTION');

  try {
    // Validar duplicado
    const exist = await db.get('SELECT 1 FROM documentos WHERE numero = ?', [doc.numero]);
    if (exist) {
      throw new Error(`El Remito ${doc.numero} ya se encuentra registrado.`);
    }

    // Insertar documento Remito
    await db.run(
      'INSERT INTO documentos (numero, tipo, fecha, archivo_origen) VALUES (?, ?, ?, ?)',
      [doc.numero, 'REMITO', doc.fecha, doc.archivo_origen || '']
    );

    for (const item of items) {
      // 1. Vincular los códigos SAP si vienen ambos en el remito
      if (item.codigo_sap_cliente && item.codigo_sap_interno) {
        await db.run(
          `INSERT INTO mapeo_codigos_sap (codigo_sap_cliente, codigo_sap_interno)
           VALUES (?, ?)
           ON CONFLICT(codigo_sap_cliente) DO UPDATE SET codigo_sap_interno = excluded.codigo_sap_interno`,
          [item.codigo_sap_cliente, item.codigo_sap_interno]
        );
      }

      // 2. Verificar existencia de la OC asociada
      const oc = await db.get('SELECT 1 FROM documentos WHERE numero = ? AND tipo = ?', [item.oc_asociada_numero, 'OC']);
      if (!oc) {
        throw new Error(`El remito hace referencia a una OC no existente: ${item.oc_asociada_numero}`);
      }

      // 3. Obtener el item de la OC por su código SAP Cliente
      const itemOC = await db.get(
        'SELECT id, saldo_pendiente, descripcion FROM items_oc WHERE documento_numero = ? AND codigo_sap_cliente = ?',
        [item.oc_asociada_numero, item.codigo_sap_cliente]
      );

      if (!itemOC) {
        throw new Error(
          `El item con código SAP cliente ${item.codigo_sap_cliente} no existe en la OC asociada ${item.oc_asociada_numero}.`
        );
      }

      // 4. Validar saldo suficiente
      if (itemOC.saldo_pendiente < item.cantidad_entregada) {
        throw new Error(
          `Saldo insuficiente para el producto ${itemOC.descripcion} (${item.codigo_sap_cliente}) en la OC ${item.oc_asociada_numero}. Saldo actual: ${itemOC.saldo_pendiente}, Requerido: ${item.cantidad_entregada}`
        );
      }

      // 5. Descontar saldo de la OC
      const nuevoSaldo = itemOC.saldo_pendiente - item.cantidad_entregada;
      await db.run(
        'UPDATE items_oc SET saldo_pendiente = ? WHERE id = ?',
        [nuevoSaldo, itemOC.id]
      );

      // 6. Registrar item del remito
      await db.run(
        `INSERT INTO items_remito (documento_numero, oc_asociada_numero, codigo_sap_interno, codigo_sap_cliente, cantidad_entregada, unidad)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          doc.numero,
          item.oc_asociada_numero,
          item.codigo_sap_interno,
          item.codigo_sap_cliente,
          item.cantidad_entregada,
          item.unidad
        ]
      );
    }

    await db.run('COMMIT');
  } catch (error) {
    await db.run('ROLLBACK');
    throw error;
  }
}

/**
 * Obtiene el listado consolidado de stock
 * Suma todos los saldos pendientes de todas las OCs.
 */
export async function obtenerStockConsolidado(): Promise<StockConsolidado[]> {
  const db = await getDatabase();
  const rows = await db.all(`
    SELECT 
      ioc.codigo_sap_cliente,
      m.codigo_sap_interno,
      ioc.descripcion,
      SUM(ioc.saldo_pendiente) as saldo_general,
      ioc.unidad
    FROM items_oc ioc
    LEFT JOIN mapeo_codigos_sap m ON ioc.codigo_sap_cliente = m.codigo_sap_cliente
    GROUP BY ioc.codigo_sap_cliente, ioc.unidad
    HAVING saldo_general > 0
  `);
  return rows;
}

/**
 * Obtiene el detalle de saldos por OC para cada producto.
 */
export async function obtenerSaldosPorOC(): Promise<any[]> {
  const db = await getDatabase();
  const rows = await db.all(`
    SELECT 
      ioc.documento_numero as oc_numero,
      doc.fecha as oc_fecha,
      ioc.codigo_sap_cliente,
      m.codigo_sap_interno,
      ioc.descripcion,
      ioc.cantidad_original,
      ioc.saldo_pendiente,
      ioc.unidad
    FROM items_oc ioc
    JOIN documentos doc ON ioc.documento_numero = doc.numero
    LEFT JOIN mapeo_codigos_sap m ON ioc.codigo_sap_cliente = m.codigo_sap_cliente
    ORDER BY doc.fecha ASC, ioc.documento_numero ASC
  `);
  return rows;
}
