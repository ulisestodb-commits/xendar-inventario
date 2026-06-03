-- ============================================================================
-- Descripción Técnica: Esquema de base de datos relacional para control transaccional
--                      de stock, saldos de Órdenes de Compra e historial de Remitos.
-- Contexto SaaS: Xendar - Módulo: Sincronización de Inventario y Validación de Remitos
-- ============================================================================

CREATE TABLE IF NOT EXISTS documentos (
    numero VARCHAR(50) PRIMARY KEY,
    tipo VARCHAR(10) CHECK (tipo IN ('OC', 'REMITO')),
    fecha DATE NOT NULL,
    archivo_origen VARCHAR(255),
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mapeo_codigos_sap (
    codigo_sap_cliente VARCHAR(50) PRIMARY KEY,
    codigo_sap_interno VARCHAR(50) NOT NULL,
    descripcion VARCHAR(255),
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS items_oc (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    documento_numero VARCHAR(50) REFERENCES documentos(numero) ON DELETE CASCADE,
    item_posicion INTEGER,
    codigo_sap_cliente VARCHAR(50),
    descripcion VARCHAR(255),
    cantidad_original REAL NOT NULL,
    saldo_pendiente REAL NOT NULL,
    unidad VARCHAR(10),
    UNIQUE (documento_numero, codigo_sap_cliente)
);

CREATE TABLE IF NOT EXISTS items_remito (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    documento_numero VARCHAR(50) REFERENCES documentos(numero) ON DELETE CASCADE,
    oc_asociada_numero VARCHAR(50) REFERENCES documentos(numero),
    codigo_sap_interno VARCHAR(50),
    codigo_sap_cliente VARCHAR(50),
    cantidad_entregada REAL NOT NULL,
    unidad VARCHAR(10)
);

-- Índices para optimizar búsquedas por códigos SAP y prevenir lecturas lentas
CREATE INDEX IF NOT EXISTS idx_items_oc_codigo ON items_oc(documento_numero, codigo_sap_cliente);
CREATE INDEX IF NOT EXISTS idx_items_remito_oc ON items_remito(oc_asociada_numero);
