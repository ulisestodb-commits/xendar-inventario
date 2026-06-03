/**
 * Descripción Técnica: Inicializa y gestiona la conexión a la base de datos local SQLite,
 *                      cargando el esquema definido en SQL si no existe previamente.
 * Contexto SaaS: Xendar - Módulo: Sincronización de Inventario y Validación de Remitos
 */
import { Database } from 'sqlite';
export declare function getDatabase(): Promise<Database>;
