"use strict";
/**
 * Descripción Técnica: Inicializa y gestiona la conexión a la base de datos SQLite
 *                      usando @libsql/client (pure JS/WASM, sin binarios nativos).
 *                      Expone una API compatible con el antiguo sqlite/sqlite3 para
 *                      que el resto del código no requiera cambios.
 * Contexto SaaS: Xendar - Módulo: Sincronización de Inventario y Validación de Remitos
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDatabase = getDatabase;
const client_1 = require("@libsql/client");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const dotenv = __importStar(require("dotenv"));
dotenv.config();
// ===== Wrapper de compatibilidad =====
// Expone run/get/all/exec igual que el viejo sqlite/sqlite3
class DBCompat {
    client;
    constructor(client) {
        this.client = client;
    }
    rowToObj(row, columns) {
        const obj = {};
        columns.forEach((col, i) => { obj[col] = row[i] ?? null; });
        return obj;
    }
    async run(sql, params) {
        const result = await this.client.execute({ sql, args: params || [] });
        return {
            lastID: result.lastInsertRowid !== undefined ? Number(result.lastInsertRowid) : undefined,
            changes: result.rowsAffected,
        };
    }
    async get(sql, params) {
        const result = await this.client.execute({ sql, args: params || [] });
        if (!result.rows.length)
            return undefined;
        return this.rowToObj(result.rows[0], result.columns);
    }
    async all(sql, params) {
        const result = await this.client.execute({ sql, args: params || [] });
        return result.rows.map(row => this.rowToObj(row, result.columns));
    }
    async exec(sql) {
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
let dbInstance = null;
async function getDatabase() {
    if (dbInstance)
        return dbInstance;
    const dbPath = process.env.DATABASE_PATH
        ? path.resolve(process.env.DATABASE_PATH)
        : path.join(__dirname, '..', '..', 'inventario.db');
    // Asegurar que el directorio existe
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    const client = (0, client_1.createClient)({ url: `file:${dbPath}` });
    // Habilitar claves foráneas
    await client.execute('PRAGMA foreign_keys = ON');
    // Inicializar esquema
    const schemaPath = path.join(__dirname, '..', '..', 'database', 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
        throw new Error(`Archivo de esquema no encontrado en: ${schemaPath}`);
    }
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    // Ejecutar cada sentencia del schema individualmente
    const stmts = schemaSql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));
    for (const stmt of stmts) {
        await client.execute(stmt);
    }
    dbInstance = new DBCompat(client);
    return dbInstance;
}
