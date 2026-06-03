/**
 * Descripción Técnica: Inicializa y gestiona la conexión a la base de datos SQLite
 *                      usando @libsql/client (pure JS/WASM, sin binarios nativos).
 *                      Expone una API compatible con el antiguo sqlite/sqlite3 para
 *                      que el resto del código no requiera cambios.
 * Contexto SaaS: Xendar - Módulo: Sincronización de Inventario y Validación de Remitos
 */

import { createClient, Client, Row } from '@libsql/client';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

// ===== Wrapper de compatibilidad =====
// Expone run/get/all/exec igual que el viejo sqlite/sqlite3
class DBCompat {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  private rowToObj(row: Row, columns: string[]): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => { obj[col] = row[i] ?? null; });
    return obj;
  }

  async run(sql: string, params?: unknown[]): Promise<{ lastID?: number; changes?: number }> {
    const result = await this.client.execute({ sql, args: params as any[] || [] });
    return {
      lastID: result.lastInsertRowid !== undefined ? Number(result.lastInsertRowid) : undefined,
      changes: result.rowsAffected,
    };
  }

  async get(sql: string, params?: unknown[]): Promise<any> {
    const result = await this.client.execute({ sql, args: params as any[] || [] });
    if (!result.rows.length) return undefined;
    return this.rowToObj(result.rows[0], result.columns);
  }

  async all(sql: string, params?: unknown[]): Promise<any[]> {
    const result = await this.client.execute({ sql, args: params as any[] || [] });
    return result.rows.map(row => this.rowToObj(row, result.columns));
  }

  async exec(sql: string): Promise<void> {
    // Dividir en sentencias individuales y ejecutar cada una
    const stmts = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    for (const stmt of stmts) {
      await this.client.execute(stmt);
    }
  }
}

let dbInstance: DBCompat | null = null;

export async function getDatabase(): Promise<DBCompat> {
  if (dbInstance) return dbInstance;

  const dbPath = process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.join(__dirname, '..', '..', 'inventario.db');

  // Asegurar que el directorio existe
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const client = createClient({ url: `file:${dbPath}` });

  // Habilitar claves foráneas
  await client.execute('PRAGMA foreign_keys = ON');

  // Inicializar esquema con batch() — más robusto que exec() con split
  await client.batch([
    `CREATE TABLE IF NOT EXISTS documentos (
      numero VARCHAR(50) PRIMARY KEY,
      tipo VARCHAR(10) CHECK (tipo IN ('OC', 'REMITO')),
      fecha DATE NOT NULL,
      archivo_origen VARCHAR(255),
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS mapeo_codigos_sap (
      codigo_sap_cliente VARCHAR(50) PRIMARY KEY,
      codigo_sap_interno VARCHAR(50) NOT NULL,
      descripcion VARCHAR(255),
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS items_oc (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      documento_numero VARCHAR(50) REFERENCES documentos(numero) ON DELETE CASCADE,
      item_posicion INTEGER,
      codigo_sap_cliente VARCHAR(50),
      descripcion VARCHAR(255),
      cantidad_original REAL NOT NULL,
      saldo_pendiente REAL NOT NULL,
      unidad VARCHAR(10),
      UNIQUE (documento_numero, codigo_sap_cliente)
    )`,
    `CREATE TABLE IF NOT EXISTS items_remito (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      documento_numero VARCHAR(50) REFERENCES documentos(numero) ON DELETE CASCADE,
      oc_asociada_numero VARCHAR(50) REFERENCES documentos(numero),
      codigo_sap_interno VARCHAR(50),
      codigo_sap_cliente VARCHAR(50),
      cantidad_entregada REAL NOT NULL,
      unidad VARCHAR(10)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_items_oc_codigo ON items_oc(documento_numero, codigo_sap_cliente)`,
    `CREATE INDEX IF NOT EXISTS idx_items_remito_oc ON items_remito(oc_asociada_numero)`,
  ], 'deferred');

  dbInstance = new DBCompat(client);
  return dbInstance;
}
