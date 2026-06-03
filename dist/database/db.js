"use strict";
/**
 * Descripción Técnica: Inicializa y gestiona la conexión a la base de datos local SQLite,
 *                      cargando el esquema definido en SQL si no existe previamente.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDatabase = getDatabase;
const sqlite_1 = require("sqlite");
const sqlite3_1 = __importDefault(require("sqlite3"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
let dbInstance = null;
async function getDatabase() {
    if (dbInstance) {
        return dbInstance;
    }
    const dbPath = process.env.DATABASE_PATH
        ? path.resolve(process.env.DATABASE_PATH)
        : path.join(__dirname, '..', '..', 'inventario.db');
    dbInstance = await (0, sqlite_1.open)({
        filename: dbPath,
        driver: sqlite3_1.default.Database
    });
    // Habilitar claves foráneas para integridad referencial
    await dbInstance.run('PRAGMA foreign_keys = ON;');
    // Inicializar esquema si las tablas no existen
    const schemaPath = path.join(__dirname, '..', '..', 'database', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        await dbInstance.exec(schemaSql);
    }
    else {
        throw new Error(`Archivo de esquema no encontrado en: ${schemaPath}`);
    }
    return dbInstance;
}
