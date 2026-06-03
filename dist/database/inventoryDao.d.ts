/**
 * Descripción Técnica: DAO para interactuar con la base de datos de inventario.
 *                      Implementa operaciones transaccionales para registro de OC,
 *                      validación y procesamiento de remitos con deducción atómica de saldos,
 *                      y consulta de existencias.
 * Contexto SaaS: Xendar - Módulo: Sincronización de Inventario y Validación de Remitos
 */
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
export declare function existeDocumento(numero: string): Promise<boolean>;
/**
 * Inserta o actualiza un mapeo de códigos SAP.
 */
export declare function vincularCodigosSAP(codigoCliente: string, codigoInterno: string, descripcion?: string): Promise<void>;
/**
 * Registra una Orden de Compra y sus ítems de forma atómica.
 */
export declare function registrarOC(doc: Documento, items: Omit<ItemOC, 'saldo_pendiente'>[]): Promise<void>;
/**
 * Registra un Remito y descuenta los saldos de la OC asociada de forma atómica.
 * Si alguna validación de saldo falla, se revierte toda la transacción.
 */
export declare function registrarRemito(doc: Documento, items: ItemRemito[]): Promise<void>;
/**
 * Obtiene el listado consolidado de stock
 * Suma todos los saldos pendientes de todas las OCs.
 */
export declare function obtenerStockConsolidado(): Promise<StockConsolidado[]>;
/**
 * Obtiene el detalle de saldos por OC para cada producto.
 */
export declare function obtenerSaldosPorOC(): Promise<any[]>;
