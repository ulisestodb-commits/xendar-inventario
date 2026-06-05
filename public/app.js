// ===== ESTADO GLOBAL =====
// URL relativa: funciona tanto en localhost como en Railway/producción
const API = '/api';
let currentView = 'stock';
let confirmCallback = null;
let importData = null; // Datos del Excel para confirmar

// ===== NAVEGACIÓN =====
function showView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');
  document.getElementById(`nav-${view}`).classList.add('active');
  currentView = view;

  const titles = {
    stock:    ['Stock Actual',          'Inventario consolidado de todas las OCs activas'],
    ocs:      ['Órdenes de Compra',     'Gestión de OCs y sus saldos por ítem'],
    remitos:  ['Remitos',               'Historial de entregas y descuentos de stock'],
    importar: ['Importar desde Excel',  'Cargá tu base de datos inicial con códigos RHI, ACN, descripciones y saldos'],
    pdf:      ['Subir PDF',             'Cargá OCs o Remitos desde archivos PDF — la IA extrae los datos automáticamente'],
  };
  document.getElementById('page-title').textContent = titles[view][0];
  document.getElementById('page-subtitle').textContent = titles[view][1];

  if (view !== 'importar' && view !== 'pdf') loadView(view);
}

// ===== IMPORTAR EXCEL =====

function handleDrop(event) {
  event.preventDefault();
  document.getElementById('drop-zone').classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (file) processExcelFile(file);
}

function handleFileSelect(event) {
  const file = event.target.files[0];
  if (file) processExcelFile(file);
}

async function processExcelFile(file) {
  const allowed = ['.xlsx', '.xls', '.ods'];
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  if (!allowed.includes(ext)) {
    showToast('Formato no soportado. Usá .xlsx, .xls u .ods', 'error');
    return;
  }

  // Mostrar loading en drop zone
  const dz = document.getElementById('drop-zone');
  dz.innerHTML = `<span class="spinner"></span><p style="margin-top:12px;color:var(--text-muted)">Analizando <strong>${file.name}</strong>...</p>`;

  const formData = new FormData();
  formData.append('archivo', file);

  try {
    const res = await fetch(`${API}/importar-excel/preview`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    importData = data;
    renderImportPreview(data, file.name);
  } catch (e) {
    showToast('Error procesando Excel: ' + e.message, 'error');
    resetDropZone();
  }
}

function renderImportPreview(data, filename) {
  // Restaurar drop zone con nombre de archivo
  document.getElementById('drop-zone').innerHTML = `
    <div class="drop-icon">✅</div>
    <p class="drop-title">${filename}</p>
    <p class="drop-sub">${data.totalFilas} filas detectadas en hoja: <strong>${data.hojaUsada}</strong></p>
    <button class="btn btn-secondary" style="margin-top:12px" onclick="resetDropZone()">Cambiar archivo</button>
  `;

  // Status bar con columnas detectadas
  const c = data.columnasDetectadas;
  document.getElementById('import-status-bar').innerHTML = `
    <div class="status-chip">📊 Hoja: <strong>${data.hojaUsada}</strong></div>
    <div class="status-chip">🔢 Filas: <strong>${data.totalFilas}</strong></div>
    <div class="status-chip">🏷 RHI (interno): <strong>${c.colInterno || '⚠ No detectado'}</strong></div>
    <div class="status-chip">🏷 ACN (cliente): <strong>${c.colCliente || '⚠ No detectado'}</strong></div>
    <div class="status-chip">📝 Descripción: <strong>${c.colDesc || '⚠ No detectado'}</strong></div>
    <div class="status-chip">💰 Saldo: <strong>${c.colSaldo || '⚠ No detectado'}</strong></div>
    <div class="status-chip">📦 Unidad: <strong>${c.colUnidad || 'Usará "UN" por defecto'}</strong></div>
  `;

  // Preview table — primeras 10 filas
  document.getElementById('preview-count').textContent = data.totalFilas;
  document.getElementById('preview-cols-info').textContent =
    `Mostrando primeras ${Math.min(10, data.totalFilas)} filas de ${data.totalFilas}`;

  document.getElementById('preview-tbody').innerHTML = data.preview.map(r => `
    <tr>
      <td style="color:var(--text-muted)">${r.fila}</td>
      <td><span class="badge badge-accent">${r.codigo_sap_interno || '—'}</span></td>
      <td><span class="badge badge-accent">${r.codigo_sap_cliente || '—'}</span></td>
      <td style="max-width:250px">${r.descripcion || '—'}</td>
      <td class="num ${saldoClass(r.saldo)}">${fmt(r.saldo)}</td>
      <td>${r.unidad}</td>
    </tr>
  `).join('');

  if (data.totalFilas > 10) {
    document.getElementById('preview-more').textContent =
      `... y ${data.totalFilas - 10} filas más que también serán importadas.`;
  }

  // Sugerir nombre de OC
  const hoy = new Date().toISOString().split('T')[0].replace(/-/g, '');
  document.getElementById('oc-nombre-input').value = `SALDO_INI_${hoy}`;

  document.getElementById('import-preview-section').style.display = 'block';
}

async function confirmarImport() {
  if (!importData) return;
  const ocNombre = document.getElementById('oc-nombre-input').value.trim();
  if (!ocNombre) { showToast('Ingresá un nombre para la OC de saldo inicial', 'error'); return; }

  showConfirm(
    'Confirmar importación',
    `Se van a importar <strong>${importData.totalFilas} productos</strong> como una nueva OC llamada <strong>${ocNombre}</strong>.<br><br>
     También se crearán los vínculos entre códigos RHI y ACN en el mapa de SAP.`,
    async () => {
      try {
        const res = await apiFetch('/importar-excel/confirmar', 'POST', {
          filas: importData.todas,
          oc_numero: ocNombre,
        });
        showToast(`✅ ${res.items_importados} productos importados en OC "${res.oc_creada}"`, 'success');
        importData = null;
        document.getElementById('import-preview-section').style.display = 'none';
        resetDropZone();
        // Navegar al stock para ver el resultado
        setTimeout(() => showView('stock'), 1500);
      } catch (e) {
        showToast('Error importando: ' + e.message, 'error');
      }
    }
  );
}

function resetDropZone() {
  importData = null;
  document.getElementById('import-preview-section').style.display = 'none';
  const fileInput = document.getElementById('excel-file-input');
  if (fileInput) fileInput.value = '';
  document.getElementById('drop-zone').innerHTML = `
    <div class="drop-icon">📊</div>
    <p class="drop-title">Arrastrá tu Excel aquí</p>
    <p class="drop-sub">o hacé clic para seleccionar el archivo</p>
    <input type="file" id="excel-file-input" accept=".xlsx,.xls,.ods" style="display:none" onchange="handleFileSelect(event)" />
    <button class="btn btn-primary" style="margin-top:16px" onclick="document.getElementById('excel-file-input').click()">Seleccionar archivo</button>
  `;
}


// ===== STOCK DETALLE POR OC =====
async function openStockDetail(codigo, descripcion) {
  document.getElementById('modal-stock-title').textContent = codigo;
  document.getElementById('modal-stock-subtitle').textContent = descripcion || 'Desglose de saldo por Orden de Compra';
  document.getElementById('modal-stock-oc-tbody').innerHTML =
    '<tr class="loading-row"><td colspan="6"><span class="spinner"></span> Cargando...</td></tr>';
  openModal('modal-stock-oc');

  try {
    const rows = await apiFetch(`/stock/${encodeURIComponent(codigo)}/por-oc`);
    if (!rows.length) {
      document.getElementById('modal-stock-oc-tbody').innerHTML =
        '<tr class="loading-row"><td colspan="6" style="color:var(--text-muted)">Sin OCs con saldo para este producto.</td></tr>';
      return;
    }
    document.getElementById('modal-stock-oc-tbody').innerHTML = rows.map(r => {
      const pct = r.pct_restante ?? 0;
      const barColor = pct > 50 ? 'var(--success)' : pct > 20 ? 'var(--warning)' : 'var(--danger)';
      return `
        <tr>
          <td><strong>${r.oc_numero}</strong></td>
          <td>${formatDate(r.oc_fecha)}</td>
          <td class="num">${fmt(r.cantidad_original)}</td>
          <td class="num ${saldoClass(r.saldo_pendiente)}">${fmt(r.saldo_pendiente)}</td>
          <td style="min-width:140px">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="flex:1;background:rgba(255,255,255,0.07);border-radius:4px;height:6px;overflow:hidden">
                <div style="width:${Math.min(pct,100)}%;height:100%;background:${barColor};border-radius:4px;transition:width 0.4s"></div>
              </div>
              <span style="font-size:11px;color:var(--text-muted);width:36px;text-align:right">${pct}%</span>
            </div>
          </td>
          <td>${r.unidad}</td>
        </tr>`;
    }).join('');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
    closeModal('modal-stock-oc');
  }
}



function loadView(view) {
  if (view === 'stock') loadStock();
  if (view === 'ocs') loadOCs();
  if (view === 'remitos') loadRemitos();
}

// ===== STOCK =====
async function loadStock() {
  showTableLoading('stock-tbody', 5);
  try {
    const data = await apiFetch('/stock');
    renderStockStats(data);
    renderStockTable(data);
  } catch (e) {
    showToast('Error cargando stock: ' + e.message, 'error');
  }
}

function renderStockStats(data) {
  const total = data.length;
  const totalUnidades = data.reduce((a, r) => a + (r.saldo_general || 0), 0);
  document.getElementById('stock-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Productos distintos</div>
      <div class="stat-value">${total}</div>
      <div class="stat-sub">Con saldo disponible</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total unidades</div>
      <div class="stat-value num">${fmt(totalUnidades)}</div>
      <div class="stat-sub">Suma de todos los saldos</div>
    </div>
  `;
}

function renderStockTable(data) {
  const tbody = document.getElementById('stock-tbody');
  if (!data.length) {
    tbody.innerHTML = '';
    document.getElementById('stock-empty').style.display = 'block';
    return;
  }
  document.getElementById('stock-empty').style.display = 'none';
  tbody.innerHTML = data.map(r => `
    <tr>
      <td><span class="badge badge-accent">${r.codigo_sap_cliente}</span></td>
      <td>${r.codigo_sap_interno || '<span style="color:var(--text-muted)">\u2014</span>'}</td>
      <td style="max-width:280px">${r.descripcion || '\u2014'}</td>
      <td class="num ${saldoClass(r.saldo_general)}">${fmt(r.saldo_general)}</td>
      <td>${r.unidad || '\u2014'}</td>
      <td>
        <button class="btn-icon btn-icon-primary" title="Ver saldo por OC" onclick="openStockDetail('${r.codigo_sap_cliente}', '${escHtml(r.descripcion || '')}')">👁</button>
      </td>
    </tr>
  `).join('');
}

// ===== OCs =====
async function loadOCs() {
  showTableLoading('ocs-tbody', 7);
  try {
    const data = await apiFetch('/ocs');
    renderOCStats(data);
    renderOCTable(data);
  } catch (e) {
    showToast('Error cargando OCs: ' + e.message, 'error');
  }
}

function renderOCStats(data) {
  const total = data.length;
  const totalItems = data.reduce((a, r) => a + (r.total_items || 0), 0);
  const totalSaldo = data.reduce((a, r) => a + (r.total_saldo_pendiente || 0), 0);
  document.getElementById('ocs-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">OCs registradas</div>
      <div class="stat-value">${total}</div>
      <div class="stat-sub">Total en el sistema</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Ítems totales</div>
      <div class="stat-value">${totalItems}</div>
      <div class="stat-sub">Posiciones de OC</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Saldo pendiente total</div>
      <div class="stat-value num">${fmt(totalSaldo)}</div>
      <div class="stat-sub">Unidades por entregar</div>
    </div>
  `;
}

function renderOCTable(data) {
  const tbody = document.getElementById('ocs-tbody');
  if (!data.length) {
    tbody.innerHTML = '';
    document.getElementById('ocs-empty').style.display = 'block';
    return;
  }
  document.getElementById('ocs-empty').style.display = 'none';
  tbody.innerHTML = data.map(r => {
    const pct = r.total_cantidad_original > 0
      ? Math.round((r.total_saldo_pendiente / r.total_cantidad_original) * 100)
      : 0;
    return `
    <tr>
      <td><strong>${r.numero}</strong></td>
      <td>${formatDate(r.fecha)}</td>
      <td><span class="badge badge-accent">${r.total_items}</span></td>
      <td class="num">${fmt(r.total_cantidad_original)} ${r.unidad || ''}</td>
      <td>
        <span class="num ${saldoClass(r.total_saldo_pendiente)}">${fmt(r.total_saldo_pendiente)}</span>
        <span style="color:var(--text-muted);font-size:11px;margin-left:4px">(${pct}%)</span>
      </td>
      <td style="font-size:11px;color:var(--text-muted);max-width:140px;overflow:hidden;text-overflow:ellipsis">${r.archivo_origen || '—'}</td>
      <td>
        <div class="action-group">
          <button class="btn-icon btn-icon-primary" title="Ver detalle" onclick="openOCDetail('${r.numero}')">👁</button>
          <button class="btn-icon btn-icon-danger" title="Dar de baja" onclick="confirmDeleteOC('${r.numero}')">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

async function openOCDetail(numero) {
  document.getElementById('modal-oc-title').textContent = `OC ${numero}`;
  document.getElementById('modal-oc-subtitle').textContent = 'Detalle de ítems y saldos';
  document.getElementById('modal-oc-tbody').innerHTML = '<tr class="loading-row"><td colspan="7"><span class="spinner"></span> Cargando...</td></tr>';
  openModal('modal-oc');

  const items = await apiFetch(`/ocs/${encodeURIComponent(numero)}/items`);
  document.getElementById('modal-oc-tbody').innerHTML = items.map(it => `
    <tr>
      <td>${it.item_posicion ?? '—'}</td>
      <td><span class="badge badge-accent">${it.codigo_sap_cliente}</span></td>
      <td style="max-width:220px">${it.descripcion || '—'}</td>
      <td class="num">${fmt(it.cantidad_original)}</td>
      <td class="num ${saldoClass(it.saldo_pendiente)}">${fmt(it.saldo_pendiente)}</td>
      <td>${it.unidad}</td>
      <td>
        <button class="btn-icon btn-icon-primary" title="Editar" onclick="openEditOCItem('${numero}', ${it.id}, '${escHtml(it.descripcion || '')}', ${it.cantidad_original}, ${it.saldo_pendiente}, '${it.unidad}')">✏️</button>
      </td>
    </tr>
  `).join('');
}

function openEditOCItem(numero, id, desc, cantOrig, saldo, unidad) {
  document.getElementById('edit-oc-numero').value = numero;
  document.getElementById('edit-oc-item-id').value = id;
  document.getElementById('edit-oc-desc').value = desc;
  document.getElementById('edit-oc-cant-orig').value = cantOrig;
  document.getElementById('edit-oc-saldo').value = saldo;
  document.getElementById('edit-oc-unidad').value = unidad;
  openModal('modal-edit-oc-item');
}

async function saveOCItem(event) {
  event.preventDefault();
  const numero = document.getElementById('edit-oc-numero').value;
  const id = document.getElementById('edit-oc-item-id').value;
  try {
    await apiFetch(`/ocs/${encodeURIComponent(numero)}/items/${id}`, 'PUT', {
      descripcion: document.getElementById('edit-oc-desc').value,
      cantidad_original: parseFloat(document.getElementById('edit-oc-cant-orig').value),
      saldo_pendiente: parseFloat(document.getElementById('edit-oc-saldo').value),
      unidad: document.getElementById('edit-oc-unidad').value,
    });
    showToast('Ítem actualizado correctamente', 'success');
    closeModal('modal-edit-oc-item');
    openOCDetail(numero); // Refrescar detalle
    loadOCs(); // Refrescar lista
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

function confirmDeleteOC(numero) {
  showConfirm(
    'Dar de baja OC',
    `¿Está seguro que desea eliminar la OC <strong>${numero}</strong>? Esta acción no se puede deshacer y eliminará todos sus ítems.`,
    async () => {
      try {
        await apiFetch(`/ocs/${encodeURIComponent(numero)}`, 'DELETE');
        showToast(`OC ${numero} eliminada correctamente`, 'success');
        loadOCs();
      } catch (e) {
        showToast('Error: ' + e.message, 'error');
      }
    }
  );
}

// ===== REMITOS =====
async function loadRemitos() {
  showTableLoading('remitos-tbody', 7);
  try {
    const data = await apiFetch('/remitos');
    renderRemitoStats(data);
    renderRemitoTable(data);
  } catch (e) {
    showToast('Error cargando remitos: ' + e.message, 'error');
  }
}

function renderRemitoStats(data) {
  const total = data.length;
  const totalEntregado = data.reduce((a, r) => a + (r.total_entregado || 0), 0);
  document.getElementById('remitos-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Remitos registrados</div>
      <div class="stat-value">${total}</div>
      <div class="stat-sub">Total en el sistema</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total entregado</div>
      <div class="stat-value num">${fmt(totalEntregado)}</div>
      <div class="stat-sub">Unidades acumuladas</div>
    </div>
  `;
}

function renderRemitoTable(data) {
  const tbody = document.getElementById('remitos-tbody');
  if (!data.length) {
    tbody.innerHTML = '';
    document.getElementById('remitos-empty').style.display = 'block';
    return;
  }
  document.getElementById('remitos-empty').style.display = 'none';
  tbody.innerHTML = data.map(r => `
    <tr>
      <td><strong>${r.numero}</strong></td>
      <td>${formatDate(r.fecha)}</td>
      <td><span class="badge badge-accent">${r.ocs_asociadas || '—'}</span></td>
      <td><span class="badge badge-accent">${r.total_items}</span></td>
      <td class="num">${fmt(r.total_entregado)} ${r.unidad || ''}</td>
      <td style="font-size:11px;color:var(--text-muted);max-width:140px;overflow:hidden;text-overflow:ellipsis">${r.archivo_origen || '—'}</td>
      <td>
        <div class="action-group">
          <button class="btn-icon btn-icon-primary" title="Ver detalle" onclick="openRemitoDetail('${r.numero}')">👁</button>
          <button class="btn-icon btn-icon-danger" title="Dar de baja" onclick="confirmDeleteRemito('${r.numero}')">🗑</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function openRemitoDetail(numero) {
  document.getElementById('modal-remito-title').textContent = `Remito ${numero}`;
  document.getElementById('modal-remito-subtitle').textContent = 'Al modificar se ajusta automáticamente el saldo de la OC';
  document.getElementById('modal-remito-tbody').innerHTML = '<tr class="loading-row"><td colspan="6"><span class="spinner"></span> Cargando...</td></tr>';
  openModal('modal-remito');

  const items = await apiFetch(`/remitos/${encodeURIComponent(numero)}/items`);
  document.getElementById('modal-remito-tbody').innerHTML = items.map(it => `
    <tr>
      <td><span class="badge badge-accent">${it.oc_asociada_numero}</span></td>
      <td>${it.codigo_sap_cliente}</td>
      <td style="max-width:200px">${it.descripcion || '—'}</td>
      <td class="num">${fmt(it.cantidad_entregada)}</td>
      <td>${it.unidad}</td>
      <td>
        <button class="btn-icon btn-icon-primary" title="Editar cantidad" onclick="openEditRemitoItem('${numero}', ${it.id}, ${it.cantidad_entregada})">✏️</button>
      </td>
    </tr>
  `).join('');
}

function openEditRemitoItem(numero, id, cantActual) {
  document.getElementById('edit-remito-numero').value = numero;
  document.getElementById('edit-remito-item-id').value = id;
  document.getElementById('edit-remito-cant').value = cantActual;
  openModal('modal-edit-remito-item');
}

async function saveRemitoItem(event) {
  event.preventDefault();
  const numero = document.getElementById('edit-remito-numero').value;
  const id = document.getElementById('edit-remito-item-id').value;
  try {
    await apiFetch(`/remitos/${encodeURIComponent(numero)}/items/${id}`, 'PUT', {
      nueva_cantidad: parseFloat(document.getElementById('edit-remito-cant').value),
    });
    showToast('Ítem de remito actualizado y saldo OC ajustado', 'success');
    closeModal('modal-edit-remito-item');
    openRemitoDetail(numero);
    loadRemitos();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

function confirmDeleteRemito(numero) {
  showConfirm(
    'Dar de baja Remito',
    `¿Está seguro que desea eliminar el remito <strong>${numero}</strong>?<br><br>Los saldos descontados en la OC asociada serán <strong>restituidos automáticamente</strong>.`,
    async () => {
      try {
        await apiFetch(`/remitos/${encodeURIComponent(numero)}`, 'DELETE');
        showToast(`Remito ${numero} eliminado y saldos restituidos`, 'success');
        loadRemitos();
        // Refrescar stock si está visible
        if (currentView === 'stock') loadStock();
      } catch (e) {
        showToast('Error: ' + e.message, 'error');
      }
    }
  );
}

// ===== MODALES =====
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function showConfirm(title, message, callback) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').innerHTML = message;
  confirmCallback = callback;
  openModal('modal-confirm');
}

function executeConfirm() {
  closeModal('modal-confirm');
  if (confirmCallback) confirmCallback();
  confirmCallback = null;
}

function cancelConfirm() {
  closeModal('modal-confirm');
  confirmCallback = null;
}

// ===== TOAST =====
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type]}</span> ${msg}`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 3500);
}

// ===== UTILIDADES =====
async function apiFetch(endpoint, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + endpoint, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error del servidor');
  return data;
}

function showTableLoading(tbodyId, cols) {
  document.getElementById(tbodyId).innerHTML = `
    <tr class="loading-row"><td colspan="${cols}"><span class="spinner"></span> Cargando datos...</td></tr>`;
}

function fmt(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('es-AR', { maximumFractionDigits: 3 });
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function saldoClass(n) {
  if (!n || n <= 0) return 'num-red';
  if (n < 100) return 'num-yellow';
  return 'num-green';
}

function escHtml(s) { return s.replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

function filterTable(tableId, query) {
  const q = query.toLowerCase();
  document.querySelectorAll(`#${tableId} tbody tr`).forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

// Cerrar modales con Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  }
});

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  loadStock();
  // Verificar conexión
  apiFetch('/stock').then(() => {
    document.querySelector('.status-dot').style.background = 'var(--success)';
  }).catch(() => {
    document.querySelector('.status-dot').style.background = 'var(--danger)';
    document.querySelector('.connection-status span:last-child').textContent = 'Sin conexión';
  });
});

// ===== PDF UPLOAD =====
let pdfTipo = 'OC';         // 'OC' o 'REMITO'
let pdfPreviewData = null;  // datos extraídos por Gemini

function setPdfTipo(tipo) {
  pdfTipo = tipo;
  document.getElementById('btn-tipo-oc').classList.toggle('active', tipo === 'OC');
  document.getElementById('btn-tipo-remito').classList.toggle('active', tipo === 'REMITO');
  // Resetear si ya había un PDF cargado
  resetPdfZone();
}

function handlePdfDrop(event) {
  event.preventDefault();
  document.getElementById('pdf-drop-zone').classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (file) processPdfFile(file);
}

function handlePdfSelect(event) {
  const file = event.target.files[0];
  if (file) processPdfFile(file);
}

async function processPdfFile(file) {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    showToast('Solo se aceptan archivos PDF', 'error');
    return;
  }

  // Mostrar spinner de análisis en la drop zone
  const dz = document.getElementById('pdf-drop-zone');
  dz.innerHTML = `
    <div class="pdf-analyzing">
      <span class="spinner big-spinner"></span>
      <p>🤖 Analizando <strong>${file.name}</strong> con IA...</p>
      <p style="font-size:12px;color:var(--text-muted)">Esto puede tardar 10-15 segundos</p>
    </div>`;

  // Ocultar panel de preview mientras procesa
  document.getElementById('pdf-preview-panel').style.display = 'none';

  const formData = new FormData();
  formData.append('archivo', file);
  formData.append('tipo', pdfTipo);

  try {
    const res = await fetch(`${API}/procesar-pdf/preview`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    pdfPreviewData = { ...data, nombreArchivo: file.name };
    renderPdfPreview(data, file.name);
  } catch (e) {
    showToast('Error procesando PDF: ' + e.message, 'error');
    resetPdfZone();
  }
}

function renderPdfPreview(data, filename) {
  const { tipo, datos, yaExiste, ocAsociadaExiste } = data;
  const panel = document.getElementById('pdf-preview-panel');
  const header = document.getElementById('pdf-doc-header');

  // Restaurar drop zone con ícono de éxito
  document.getElementById('pdf-drop-zone').innerHTML = `
    <div class="drop-icon">✅</div>
    <p class="drop-title">${filename}</p>
    <p class="drop-sub">PDF analizado correctamente</p>
    <button class="btn btn-secondary" style="margin-top:12px" onclick="resetPdfZone()">Cambiar archivo</button>`;

  // --- Header del documento ---
  let headerHtml = `<div class="pdf-doc-meta">`;

  if (tipo === 'OC') {
    headerHtml += `
      <div class="pdf-doc-meta-item">
        <span class="label">Tipo</span>
        <span class="value">📋 Orden de Compra</span>
      </div>
      <div class="pdf-doc-meta-item">
        <span class="label">N° OC</span>
        <span class="value oc-num">${datos.numero}</span>
      </div>
      <div class="pdf-doc-meta-item">
        <span class="label">Fecha</span>
        <span class="value">${formatDate(datos.fecha)}</span>
      </div>
      <div class="pdf-doc-meta-item">
        <span class="label">Ítems</span>
        <span class="value">${datos.items?.length || 0}</span>
      </div>`;
  } else {
    headerHtml += `
      <div class="pdf-doc-meta-item">
        <span class="label">Tipo</span>
        <span class="value">🚚 Remito</span>
      </div>
      <div class="pdf-doc-meta-item">
        <span class="label">N° Remito</span>
        <span class="value oc-num">${datos.numero}</span>
      </div>
      <div class="pdf-doc-meta-item">
        <span class="label">Fecha</span>
        <span class="value">${formatDate(datos.fecha)}</span>
      </div>
      <div class="pdf-doc-meta-item">
        <span class="label">OC Asociada</span>
        <span class="value oc-num">${datos.oc_asociada_numero}</span>
      </div>
      <div class="pdf-doc-meta-item">
        <span class="label">Ítems</span>
        <span class="value">${datos.items?.length || 0}</span>
      </div>`;
  }
  headerHtml += `</div>`;

  // Alertas de validación
  if (yaExiste) {
    headerHtml += `
      <div class="pdf-duplicate-alert">
        ⚠️ <strong>Este documento ya existe en el sistema.</strong> No se puede volver a cargar.
      </div>`;
    // Deshabilitar botón confirmar
    setTimeout(() => {
      const btn = document.getElementById('pdf-confirm-btn');
      if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; btn.style.cursor = 'not-allowed'; }
    }, 100);
  } else {
    setTimeout(() => {
      const btn = document.getElementById('pdf-confirm-btn');
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
    }, 100);
  }

  if (tipo === 'REMITO') {
    if (ocAsociadaExiste === false) {
      headerHtml += `
        <div class="pdf-oc-missing-alert">
          ⚠️ La OC <strong>${datos.oc_asociada_numero}</strong> no existe en el sistema. Importá la OC primero antes de cargar este remito.
        </div>`;
      setTimeout(() => {
        const btn = document.getElementById('pdf-confirm-btn');
        if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; btn.style.cursor = 'not-allowed'; }
      }, 100);
    } else if (ocAsociadaExiste === true) {
      headerHtml += `
        <div style="margin-top:12px">
          <span class="pdf-oc-ok-badge">✓ OC ${datos.oc_asociada_numero} encontrada en el sistema</span>
        </div>`;
    }
  }

  header.innerHTML = headerHtml;

  // --- Tabla de ítems ---
  document.getElementById('pdf-preview-title').textContent =
    `${datos.items?.length || 0} ítems detectados`;

  if (tipo === 'OC') {
    document.getElementById('pdf-preview-thead').innerHTML = `
      <tr>
        <th>Posición</th>
        <th>Código SAP Cliente</th>
        <th>Descripción</th>
        <th>Cantidad</th>
        <th>Unidad</th>
      </tr>`;
    document.getElementById('pdf-preview-tbody').innerHTML = (datos.items || []).map(it => `
      <tr>
        <td style="color:var(--text-muted)">${it.item_posicion}</td>
        <td><span class="badge badge-accent">${it.codigo_sap_cliente}</span></td>
        <td style="max-width:280px">${it.descripcion}</td>
        <td class="num">${fmt(it.cantidad_original)}</td>
        <td>${it.unidad}</td>
      </tr>`).join('');
  } else {
    document.getElementById('pdf-preview-thead').innerHTML = `
      <tr>
        <th>Cód. Interno</th>
        <th>Cód. Cliente</th>
        <th>Descripción</th>
        <th>Cant. Entregada</th>
        <th>Unidad</th>
      </tr>`;
    document.getElementById('pdf-preview-tbody').innerHTML = (datos.items || []).map(it => `
      <tr>
        <td><span class="badge badge-accent">${it.codigo_sap_interno || '—'}</span></td>
        <td><span class="badge badge-accent">${it.codigo_sap_cliente}</span></td>
        <td style="max-width:280px">${it.descripcion}</td>
        <td class="num">${fmt(it.cantidad_entregada)}</td>
        <td>${it.unidad}</td>
      </tr>`).join('');
  }

  panel.style.display = 'block';
}

async function confirmarPdf() {
  if (!pdfPreviewData) return;
  const { tipo, datos, nombreArchivo } = pdfPreviewData;

  const tipoLabel = tipo === 'OC' ? 'Orden de Compra' : 'Remito';
  const docNum = datos.numero;

  showConfirm(
    `Confirmar ${tipoLabel}`,
    `¿Guardar el documento <strong>${docNum}</strong> con <strong>${datos.items?.length || 0} ítems</strong>?
     ${tipo === 'REMITO' ? `<br><br>⚠️ Se descontará el stock de la OC <strong>${datos.oc_asociada_numero}</strong>.` : ''}`,
    async () => {
      try {
        let res;
        if (tipo === 'OC') {
          res = await apiFetch('/procesar-pdf/confirmar-oc', 'POST', {
            numero: datos.numero,
            fecha: datos.fecha,
            items: datos.items,
            archivo_origen: nombreArchivo,
          });
          showToast(`✅ OC ${res.oc_creada} guardada con ${res.items_insertados} ítems`, 'success');
          resetPdfZone();
          setTimeout(() => showView('ocs'), 1500);
        } else {
          res = await apiFetch('/procesar-pdf/confirmar-remito', 'POST', {
            numero: datos.numero,
            fecha: datos.fecha,
            oc_asociada_numero: datos.oc_asociada_numero,
            items: datos.items,
            archivo_origen: nombreArchivo,
          });
          showToast(`✅ Remito ${res.remito_creado} guardado. Stock descontado de OC ${datos.oc_asociada_numero}`, 'success');
          resetPdfZone();
          setTimeout(() => showView('remitos'), 1500);
        }
      } catch (e) {
        showToast('Error guardando: ' + e.message, 'error');
      }
    }
  );
}

function resetPdfZone() {
  pdfPreviewData = null;
  document.getElementById('pdf-preview-panel').style.display = 'none';
  const fi = document.getElementById('pdf-file-input');
  if (fi) fi.value = '';
  document.getElementById('pdf-drop-zone').innerHTML = `
    <div class="drop-icon">📄</div>
    <p class="drop-title">Arrastrá el PDF aquí</p>
    <p class="drop-sub">o hacé clic para seleccionar</p>
    <input type="file" id="pdf-file-input" accept=".pdf" style="display:none" onchange="handlePdfSelect(event)" />
    <button class="btn btn-primary" style="margin-top:16px" onclick="document.getElementById('pdf-file-input').click()">Seleccionar PDF</button>`;
}

// ===== CERRAR AUTOCOMPLETE AL HACER CLICK AFUERA =====
document.addEventListener('click', (e) => {
  if (!e.target.closest('.ac-wrapper')) {
    document.querySelectorAll('.ac-dropdown').forEach(d => d.style.display = 'none');
  }
});

// =========================================================
// ===== NUEVA OC MANUAL ===================================
// =========================================================
let _ocItemsManual = [];

function abrirModalNuevaOC() {
  _ocItemsManual = [];
  document.getElementById('noc-numero').value = '';
  document.getElementById('noc-fecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('noc-items-tbody').innerHTML = '';
  document.getElementById('noc-item-count').textContent = '0';
  openModal('modal-nueva-oc');
  agregarFilaOC(); // Empezar con una fila vacía
}

function cerrarNuevaOC() {
  _ocItemsManual = [];
  closeModal('modal-nueva-oc');
}

function _renderFilasOC() {
  const tbody = document.getElementById('noc-items-tbody');
  tbody.innerHTML = '';
  _ocItemsManual.forEach((item, idx) => {
    const pos = (idx + 1) * 10;
    item.pos = pos;
    const tr = document.createElement('tr');
    tr.id = `noc-row-${idx}`;
    const unidades = ['UN','KG','TN','LT','MT','M2','ML'];
    const opts = unidades.map(u => `<option value="${u}"${item.unidad===u?' selected':''}>${u}</option>`).join('');
    tr.innerHTML = `
      <td style="color:var(--accent);font-weight:700;font-size:13px;text-align:center">${pos}</td>
      <td><input class="inline-input" style="width:130px" type="text" value="${escHtml(item.codigo_sap_cliente)}" placeholder="Cód. SAP" oninput="_ocItemsManual[${idx}].codigo_sap_cliente=this.value" /></td>
      <td><input class="inline-input" style="width:100%;min-width:200px" type="text" value="${escHtml(item.descripcion)}" placeholder="Descripción del producto" oninput="_ocItemsManual[${idx}].descripcion=this.value" /></td>
      <td><input class="inline-input" style="width:110px" type="number" value="${item.cantidad_original||''}" placeholder="0" min="0.001" step="0.001" oninput="_ocItemsManual[${idx}].cantidad_original=this.value" /></td>
      <td><select class="inline-select" onchange="_ocItemsManual[${idx}].unidad=this.value">${opts}</select></td>
      <td><button class="btn-icon btn-icon-danger" onclick="_eliminarFilaOC(${idx})" title="Eliminar">✕</button></td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('noc-item-count').textContent = _ocItemsManual.length;
}

function agregarFilaOC() {
  if (_ocItemsManual.length >= 30) {
    showToast('Máximo 30 ítems (hasta posición 300)', 'error');
    return;
  }
  _ocItemsManual.push({ pos: 0, codigo_sap_cliente: '', descripcion: '', cantidad_original: '', unidad: 'UN' });
  _renderFilasOC();
  // Scroll al final de la tabla
  const wrapper = document.querySelector('#modal-nueva-oc .table-wrapper');
  if (wrapper) setTimeout(() => { wrapper.scrollTop = wrapper.scrollHeight; }, 50);
}

function _eliminarFilaOC(idx) {
  _ocItemsManual.splice(idx, 1);
  _renderFilasOC();
}

async function guardarNuevaOC() {
  const numero = document.getElementById('noc-numero').value.trim();
  const fecha  = document.getElementById('noc-fecha').value;

  if (!numero) { showToast('Ingresá el número de OC', 'error'); return; }
  if (!fecha)  { showToast('Ingresá la fecha',         'error'); return; }

  const items = _ocItemsManual
    .filter(it => it.codigo_sap_cliente.trim() && parseFloat(it.cantidad_original) > 0)
    .map((it, idx) => ({
      item_posicion:    (idx + 1) * 10,
      codigo_sap_cliente: it.codigo_sap_cliente.trim(),
      descripcion:       it.descripcion.trim(),
      cantidad_original: parseFloat(it.cantidad_original),
      unidad:            it.unidad || 'UN',
    }));

  if (!items.length) { showToast('Agregá al menos un ítem con código y cantidad', 'error'); return; }

  try {
    const res = await apiFetch('/procesar-pdf/confirmar-oc', 'POST', {
      numero, fecha, items, archivo_origen: 'MANUAL',
    });
    showToast(`✅ OC ${res.oc_creada} guardada con ${res.items_insertados} ítems`, 'success');
    cerrarNuevaOC();
    loadOCs();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

// =========================================================
// ===== NUEVO REMITO MANUAL ================================
// =========================================================
let _remitoItemsManual = [];
let _ocsConSaldo       = [];
let _prodsPorOC        = [];   // productos cargados de la OC seleccionada
let _ocSeleccionada    = null;

// Cache de últimos resultados del autocomplete de producto (por fila)
const _acProdCache = {};

async function abrirModalNuevoRemito() {
  _remitoItemsManual = [];
  _ocSeleccionada    = null;
  _prodsPorOC        = [];

  document.getElementById('nr-numero').value   = '';
  document.getElementById('nr-fecha').value    = new Date().toISOString().split('T')[0];
  document.getElementById('nr-oc-input').value = '';
  document.getElementById('nr-oc-seleccionada').value = '';
  document.getElementById('nr-oc-status').textContent = '';
  document.getElementById('nr-oc-dropdown').style.display = 'none';
  document.getElementById('nr-items-tbody').innerHTML    = '';
  document.getElementById('nr-items-section').style.display = 'none';

  // Cargar OCs con saldo
  try {
    _ocsConSaldo = await apiFetch('/ocs/con-saldo');
    document.getElementById('nr-oc-status').textContent =
      `${_ocsConSaldo.length} OCs con saldo disponible`;
  } catch (e) {
    showToast('Error cargando OCs: ' + e.message, 'error');
  }
  openModal('modal-nuevo-remito');
}

function cerrarNuevoRemito() {
  _remitoItemsManual = [];
  closeModal('modal-nuevo-remito');
}

function filtrarOCRemito(query) {
  const dropdown = document.getElementById('nr-oc-dropdown');
  const q = query.toLowerCase().trim();

  const lista = q
    ? _ocsConSaldo.filter(oc => oc.numero.toLowerCase().includes(q))
    : _ocsConSaldo;

  if (!lista.length) {
    dropdown.innerHTML = '<div class="ac-no-results">Sin OCs con saldo disponible</div>';
    dropdown.style.display = 'block';
    return;
  }

  dropdown.innerHTML = lista.slice(0, 12).map(oc => `
    <div class="ac-item" onclick="seleccionarOCRemito('${escHtml(oc.numero)}')">
      <span class="ac-main">${oc.numero}</span>
      <span class="ac-sub">${formatDate(oc.fecha)} &nbsp;·&nbsp; ${oc.total_items} ítems &nbsp;·&nbsp; Saldo: ${fmt(oc.saldo_total)}</span>
    </div>`).join('');
  dropdown.style.display = 'block';
}

async function seleccionarOCRemito(numero) {
  document.getElementById('nr-oc-input').value = numero;
  document.getElementById('nr-oc-seleccionada').value = numero;
  document.getElementById('nr-oc-dropdown').style.display = 'none';
  document.getElementById('nr-oc-status').textContent = `Cargando productos de OC ${numero}...`;

  _ocSeleccionada    = numero;
  _remitoItemsManual = [];
  document.getElementById('nr-items-tbody').innerHTML = '';
  document.getElementById('nr-items-section').style.display = 'none';

  try {
    _prodsPorOC = await apiFetch(`/ocs/${encodeURIComponent(numero)}/productos`);
    document.getElementById('nr-oc-status').textContent =
      `✅ ${_prodsPorOC.length} productos con saldo disponible en OC ${numero}`;
    document.getElementById('nr-items-section').style.display = 'block';
    agregarFilaRemito();
  } catch (e) {
    document.getElementById('nr-oc-status').textContent = 'Error cargando productos';
    showToast('Error: ' + e.message, 'error');
  }
}

function agregarFilaRemito() {
  const idx = _remitoItemsManual.length;
  _remitoItemsManual.push({
    codigo_sap_cliente: '', codigo_sap_interno: '',
    descripcion: '', cantidad_entregada: '', unidad: 'UN', saldo_max: null,
  });

  const tr = document.createElement('tr');
  tr.id = `nr-row-${idx}`;
  tr.innerHTML = `
    <td style="position:relative;min-width:260px">
      <div class="ac-wrapper">
        <input class="ac-input" id="nr-prod-${idx}" type="text" placeholder="Escribí la descripción del producto..."
               oninput="filtrarProdRemito(${idx},this.value)" onfocus="filtrarProdRemito(${idx},this.value)" autocomplete="off" />
        <div class="ac-dropdown" id="nr-drop-${idx}"></div>
      </div>
    </td>
    <td><span class="badge badge-accent" id="nr-rhim-${idx}" style="min-width:80px">—</span></td>
    <td><span class="badge badge-accent" id="nr-acn-${idx}"  style="min-width:80px">—</span></td>
    <td class="num num-yellow" id="nr-disp-${idx}" style="white-space:nowrap">—</td>
    <td><input class="inline-input" id="nr-cant-${idx}" type="number" placeholder="0" min="0.001" step="0.001" style="width:110px"
              oninput="_remitoItemsManual[${idx}].cantidad_entregada=this.value" /></td>
    <td id="nr-und-${idx}" style="color:var(--text-muted);font-size:12px">—</td>
    <td><button class="btn-icon btn-icon-danger" onclick="_eliminarFilaRemito(${idx})" title="Eliminar">✕</button></td>`;
  document.getElementById('nr-items-tbody').appendChild(tr);

  // Scroll al final
  const wrapper = document.querySelector('#modal-nuevo-remito .table-wrapper');
  if (wrapper) setTimeout(() => { wrapper.scrollTop = wrapper.scrollHeight; }, 50);
}

function filtrarProdRemito(idx, query) {
  const dropdown = document.getElementById(`nr-drop-${idx}`);
  const q = query.toLowerCase().trim();

  if (!q || q.length < 1) { dropdown.style.display = 'none'; return; }

  const matches = _prodsPorOC.filter(p =>
    (p.descripcion        || '').toLowerCase().includes(q) ||
    (p.codigo_sap_cliente || '').toLowerCase().includes(q) ||
    (p.codigo_sap_interno || '').toLowerCase().includes(q)
  );

  if (!matches.length) {
    dropdown.innerHTML = '<div class="ac-no-results">Sin productos que coincidan</div>';
    dropdown.style.display = 'block';
    return;
  }

  _acProdCache[idx] = matches.slice(0, 10);
  dropdown.innerHTML = _acProdCache[idx].map((p, i) => `
    <div class="ac-item" onclick="seleccionarProdRemito(${idx},${i})">
      <span class="ac-main">${p.descripcion || '—'}</span>
      <span class="ac-sub">ACN: ${p.codigo_sap_cliente} &nbsp;·&nbsp; RHIM: ${p.codigo_sap_interno||'—'} &nbsp;·&nbsp; Disponible: ${fmt(p.saldo_pendiente)} ${p.unidad}</span>
    </div>`).join('');
  dropdown.style.display = 'block';
}

function seleccionarProdRemito(idx, prodIdx) {
  const p = _acProdCache[idx]?.[prodIdx];
  if (!p) return;

  document.getElementById(`nr-prod-${idx}`).value = p.descripcion || '';
  document.getElementById(`nr-drop-${idx}`).style.display = 'none';
  document.getElementById(`nr-rhim-${idx}`).textContent  = p.codigo_sap_interno || '—';
  document.getElementById(`nr-acn-${idx}`).textContent   = p.codigo_sap_cliente;
  document.getElementById(`nr-disp-${idx}`).textContent  = `${fmt(p.saldo_pendiente)} ${p.unidad}`;
  document.getElementById(`nr-und-${idx}`).textContent   = p.unidad;

  const cantInput = document.getElementById(`nr-cant-${idx}`);
  cantInput.max   = p.saldo_pendiente;

  Object.assign(_remitoItemsManual[idx], {
    codigo_sap_cliente: p.codigo_sap_cliente,
    codigo_sap_interno: p.codigo_sap_interno || '',
    descripcion:        p.descripcion || '',
    unidad:             p.unidad,
    saldo_max:          p.saldo_pendiente,
  });
}

function _eliminarFilaRemito(idx) {
  // Quitar del array y re-render completando los índices correctos
  _remitoItemsManual.splice(idx, 1);
  const snapshot = [..._remitoItemsManual];
  _remitoItemsManual = [];
  document.getElementById('nr-items-tbody').innerHTML = '';

  snapshot.forEach(item => {
    const newIdx = _remitoItemsManual.length;
    agregarFilaRemito(); // crea fila vacía y empuja al array
    if (item.codigo_sap_cliente) {
      // Restaurar datos del producto seleccionado
      _acProdCache[newIdx] = [{ ...item, saldo_pendiente: item.saldo_max }];
      seleccionarProdRemito(newIdx, 0);
      const cantEl = document.getElementById(`nr-cant-${newIdx}`);
      if (cantEl) { cantEl.value = item.cantidad_entregada; _remitoItemsManual[newIdx].cantidad_entregada = item.cantidad_entregada; }
    }
  });
}

async function guardarNuevoRemito() {
  const numero = document.getElementById('nr-numero').value.trim();
  const fecha  = document.getElementById('nr-fecha').value;
  const ocNum  = document.getElementById('nr-oc-seleccionada').value;

  if (!numero) { showToast('Ingresá el número de remito', 'error'); return; }
  if (!fecha)  { showToast('Ingresá la fecha',            'error'); return; }
  if (!ocNum)  { showToast('Seleccioná una OC asociada',  'error'); return; }

  const items = _remitoItemsManual.filter(it =>
    it.codigo_sap_cliente && parseFloat(it.cantidad_entregada) > 0
  );
  if (!items.length) { showToast('Agregá al menos un ítem con producto y cantidad', 'error'); return; }

  // Validar que la cantidad no supere el saldo disponible
  for (const item of items) {
    const cant = parseFloat(item.cantidad_entregada);
    if (item.saldo_max !== null && cant > item.saldo_max) {
      showToast(`"${item.descripcion}": cantidad (${fmt(cant)}) supera el saldo disponible (${fmt(item.saldo_max)})`, 'error');
      return;
    }
  }

  const itemsFormatted = items.map(it => ({
    codigo_sap_cliente: it.codigo_sap_cliente,
    codigo_sap_interno: it.codigo_sap_interno || '',
    descripcion:        it.descripcion,
    cantidad_entregada: parseFloat(it.cantidad_entregada),
    unidad:             it.unidad || 'UN',
  }));

  try {
    const res = await apiFetch('/procesar-pdf/confirmar-remito', 'POST', {
      numero, fecha,
      oc_asociada_numero: ocNum,
      items: itemsFormatted,
      archivo_origen: 'MANUAL',
    });
    showToast(`✅ Remito ${res.remito_creado} guardado. Stock descontado de OC ${ocNum}`, 'success');
    cerrarNuevoRemito();
    loadRemitos();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}
