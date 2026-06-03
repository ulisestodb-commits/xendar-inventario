/**
 * Descripción Técnica: Inicializa y gestiona la conexión a la base de datos local SQLite,
 *                      cargando el esquema definido en SQL si no existe previamente.
 * Contexto SaaS: Xendar - Módulo: Sincronización de Inventario y Validación de Remitos
 */

import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import * as path from 'path';
import * as fs from 'fs';

let dbInstance: Database | null = null;

export async function getDatabase(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.join(__dirname, '..', '..', 'inventario.db');
  
  dbInstance = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Habilitar claves foráneas para integridad referencial
  await dbInstance.run('PRAGMA foreign_keys = ON;');

  // Inicializar esquema si las tablas no existen
  const schemaPath = path.join(__dirname, '..', '..', 'database', 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await dbInstance.exec(schemaSql);
  } else {
    throw new Error(`Archivo de esquema no encontrado en: ${schemaPath}`);
  }

  return dbInstance;
}
