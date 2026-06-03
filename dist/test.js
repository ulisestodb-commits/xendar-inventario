"use strict";
/**
 * Descripción Técnica: Script de prueba de integración offline para la base de datos de inventario.
 *                      Verifica el registro de OCs, validación de saldos de remitos y
 *                      prevención de duplicados sin necesidad de consumir la API de Gemini.
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
const db_1 = require("./database/db");
const dao = __importStar(require("./database/inventoryDao"));
async function runTests() {
    console.log('--- Iniciando Pruebas de Integración de Inventario ---');
    try {
        const db = await (0, db_1.getDatabase)();
        // Limpiar tablas para iniciar test limpio
        await db.exec('DELETE FROM items_remito');
        await db.exec('DELETE FROM items_oc');
        await db.exec('DELETE FROM documentos');
        await db.exec('DELETE FROM mapeo_codigos_sap');
        console.log('1. Base de datos reseteada para prueba.');
        // 2. Probar registro de una OC
        const testOC = {
            numero: 'OC-9990001',
            tipo: 'OC',
            fecha: '2026-05-30',
            archivo_origen: 'TEST_OC.pdf'
        };
        const itemsOC = [
            {
                documento_numero: 'OC-9990001',
                item_posicion: 10,
                codigo_sap_cliente: 'CLI-5286206',
                descripcion: 'ANKERMIX CP20-AR',
                cantidad_original: 10.0,
                unidad: 'TN'
            },
            {
                documento_numero: 'OC-9990001',
                item_posicion: 20,
                codigo_sap_cliente: 'CLI-5254152',
                descripcion: 'AC R F6L08 25/0',
                cantidad_original: 5.0,
                unidad: 'UN'
            }
        ];
        await dao.registrarOC(testOC, itemsOC);
        console.log('2. Orden de Compra de prueba registrada exitosamente.');
        // 3. Probar que no se permite registrar la misma OC duplicada
        try {
            await dao.registrarOC(testOC, itemsOC);
            console.error('ERROR: Se permitió registrar una OC duplicada!');
        }
        catch (e) {
            console.log('3. Prevención de duplicados de OC verificada:', e.message);
        }
        // 4. Probar remito exitoso (dentro del saldo disponible)
        const testRemito = {
            numero: 'REM-12345',
            tipo: 'REMITO',
            fecha: '2026-05-30',
            archivo_origen: 'TEST_REMITO.pdf'
        };
        const itemsRemito = [
            {
                documento_numero: 'REM-12345',
                oc_asociada_numero: 'OC-9990001',
                codigo_sap_interno: 'INT-1003648',
                codigo_sap_cliente: 'CLI-5286206', // Asociado al primer item de la OC
                cantidad_entregada: 4.0, // menor al saldo de 10.0
                unidad: 'TN'
            }
        ];
        await dao.registrarRemito(testRemito, itemsRemito);
        console.log('4. Remito exitoso procesado y descontado.');
        // 5. Verificar saldos tras el primer remito
        let saldos = await dao.obtenerSaldosPorOC();
        console.log('5. Detalle de saldos actuales en BD:');
        console.table(saldos.map(s => ({
            OC: s.oc_numero,
            Producto: s.descripcion,
            Original: s.cantidad_original,
            Saldo: s.saldo_pendiente,
            Unidad: s.unidad
        })));
        // 6. Probar remito con cantidad superior al saldo restante (debe fallar)
        const testRemitoExceso = {
            numero: 'REM-12346',
            tipo: 'REMITO',
            fecha: '2026-05-30',
            archivo_origen: 'TEST_REMITO_EXCESO.pdf'
        };
        const itemsRemitoExceso = [
            {
                documento_numero: 'REM-12346',
                oc_asociada_numero: 'OC-9990001',
                codigo_sap_interno: 'INT-1003648',
                codigo_sap_cliente: 'CLI-5286206',
                cantidad_entregada: 7.0, // Excede el saldo restante que es 6.0 (10.0 - 4.0)
                unidad: 'TN'
            }
        ];
        try {
            await dao.registrarRemito(testRemitoExceso, itemsRemitoExceso);
            console.error('ERROR: Se permitió procesar un remito con saldo insuficiente!');
        }
        catch (e) {
            console.log('6. Validación preventiva de saldo insuficiente verificada:', e.message);
        }
        // 7. Probar mapeo dinámico de códigos SAP
        const mappings = await db.all('SELECT * FROM mapeo_codigos_sap');
        console.log('7. Mapeo dinámico de códigos SAP creado por el remito:');
        console.table(mappings);
    }
    catch (error) {
        console.error('Error durante la ejecución del test:', error);
    }
}
runTests();
