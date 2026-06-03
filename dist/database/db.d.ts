/**
 * Descripción Técnica: Inicializa y gestiona la conexión a la base de datos SQLite
 *                      usando @libsql/client (pure JS/WASM, sin binarios nativos).
 *                      Expone una API compatible con el antiguo sqlite/sqlite3 para
 *                      que el resto del código no requiera cambios.
 * Contexto SaaS: Xendar - Módulo: Sincronización de Inventario y Validación de Remitos
 */
import { Client } from '@libsql/client';
declare class DBCompat {
    private client;
    constructor(client: Client);
    private rowToObj;
    run(sql: string, params?: unknown[]): Promise<{
        lastID?: number;
        changes?: number;
    }>;
    get(sql: string, params?: unknown[]): Promise<any>;
    all(sql: string, params?: unknown[]): Promise<any[]>;
    exec(sql: string): Promise<void>;
}
export declare function getDatabase(): Promise<DBCompat>;
export {};
