/**
 * SPARSH - Database Management Module
 * 
 * Provides UI for viewing database tables, record counts, and resetting
 * individual tables or the entire database. Admin only.
 */

(function () {
    'use strict';

    const viewEl = document.getElementById('view-database-management');
    if (!viewEl) return;

    // DOM references
    const alertArea       = document.getElementById('dbAlertArea');
    const dbTypeDisplay   = document.getElementById('dbTypeDisplay');
    const dbTableCount    = document.getElementById('dbTableCount');
    const dbTotalRecords  = document.getElementById('dbTotalRecords');
    const connectionBadge = document.getElementById('dbConnectionBadge');
    const tablesBody      = document.getElementById('dbTablesBody');
    const btnRefresh      = document.getElementById('btnRefreshDbInfo');
    const btnResetAll     = document.getElementById('btnResetEntireDb');

    // Table reset modal
    const tableResetModal       = document.getElementById('confirmTableResetModal');
    const resetTableNameDisplay = document.getElementById('resetTableNameDisplay');
    const resetTableNameHidden  = document.getElementById('resetTableNameHidden');
    const confirmTableNameInput = document.getElementById('confirmTableNameInput');
    const btnConfirmTableReset  = document.getElementById('btnConfirmTableReset');

    // Full reset modal
    const fullResetModal        = document.getElementById('confirmFullResetModal');
    const confirmFullResetInput = document.getElementById('confirmFullResetInput');
    const btnConfirmFullReset   = document.getElementById('btnConfirmFullReset');

    let tableResetModalInstance = null;
    let fullResetModalInstance  = null;

    // Target Selection
    const dbTargetRadios = document.getElementsByName('dbTarget');
    
    function getSelectedTarget() {
        for (const radio of dbTargetRadios) {
            if (radio.checked) return radio.value;
        }
        return 'local';
    }

    dbTargetRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            alertArea.innerHTML = '';
            loadDatabaseInfo();
        });
    });

    // ── Alert Helper ───────────────────────────────────────────────────
    function showAlert(message, type = 'danger') {
        alertArea.innerHTML = `
            <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                <i class="bi ${type === 'success' ? 'bi-check-circle' : 'bi-exclamation-triangle'} me-2"></i>
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>
        `;
    }

    // ── Human-readable table names ─────────────────────────────────────
    const TABLE_LABELS = {
        'students':             'Students',
        'student_enrollments':  'Student Enrollments',
        'student_results':      'Student Results',
        'academic_years':       'Academic Years',
        'class_levels':         'Class Levels',
        'subjects':             'Subjects',
        'exams':                'Exams',
        'users':                'Users',
        'import_batches':       'Import Batches',
        'import_templates':     'Import Templates',
        'historical_reports':   'Historical Reports',
        'app_settings':         'App Settings',
    };

    function getTableLabel(tableName) {
        return TABLE_LABELS[tableName] || tableName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    // ── Load Database Info ─────────────────────────────────────────────
    async function loadDatabaseInfo() {
        tablesBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-muted py-4">
                    <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
                    Loading table information...
                </td>
            </tr>
        `;
        dbTypeDisplay.textContent = 'Loading...';
        dbTableCount.textContent = '--';
        dbTotalRecords.textContent = '--';
        connectionBadge.textContent = 'Checking...';
        connectionBadge.className = 'badge rounded-pill px-3 py-2 bg-secondary';

        try {
            const target = getSelectedTarget();
            const data = await apiClient.fetch(`/database/info?target=${target}`);

            // Update info cards
            dbTypeDisplay.textContent = data.database_type;
            dbTableCount.textContent = data.table_count;
            dbTotalRecords.textContent = data.total_records.toLocaleString();

            // Connection badge
            if (data.connected) {
                connectionBadge.textContent = 'Connected';
                connectionBadge.className = 'badge rounded-pill px-3 py-2 bg-success';
            } else {
                connectionBadge.textContent = 'Disconnected';
                connectionBadge.className = 'badge rounded-pill px-3 py-2 bg-danger';
            }

            // Render tables
            renderTables(data.tables);

        } catch (err) {
            connectionBadge.textContent = 'Error';
            connectionBadge.className = 'badge rounded-pill px-3 py-2 bg-danger';
            dbTypeDisplay.textContent = 'Error';
            tablesBody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center text-danger py-4">
                        <i class="bi bi-exclamation-triangle me-2"></i>
                        Failed to load database info: ${err.message}
                    </td>
                </tr>
            `;
        }
    }

    function renderTables(tables) {
        if (!tables || tables.length === 0) {
            tablesBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No tables found.</td></tr>';
            return;
        }

        tablesBody.innerHTML = tables.map((table, index) => {
            const statusBadge = table.is_empty
                ? '<span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-25 px-2 py-1">Empty</span>'
                : '<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 px-2 py-1">Has Data</span>';

            const protectedBadge = table.is_protected
                ? ' <span class="badge bg-warning bg-opacity-10 text-warning border border-warning border-opacity-25 px-2 py-1 ms-1" title="Protected table"><i class="bi bi-shield-lock-fill"></i></span>'
                : '';

            const resetBtn = table.is_protected
                ? '<button class="btn btn-sm btn-outline-secondary" disabled title="Protected table"><i class="bi bi-lock me-1"></i>Protected</button>'
                : table.is_empty
                    ? '<button class="btn btn-sm btn-outline-secondary" disabled>No Data</button>'
                    : `<button class="btn btn-sm btn-outline-danger btn-reset-table" data-table="${table.table_name}" title="Reset ${getTableLabel(table.table_name)}">
                           <i class="bi bi-trash me-1"></i>Reset
                       </button>`;

            return `
                <tr>
                    <td class="px-4 py-3 text-muted">${index + 1}</td>
                    <td class="px-4 py-3">
                        <div class="d-flex align-items-center">
                            <i class="bi bi-table text-primary me-2"></i>
                            <div>
                                <span class="fw-semibold">${getTableLabel(table.table_name)}</span>
                                <br><small class="text-muted font-monospace">${table.table_name}</small>
                            </div>
                        </div>
                    </td>
                    <td class="px-4 py-3">${table.column_count}</td>
                    <td class="px-4 py-3">
                        <span class="fw-bold ${table.row_count > 0 ? 'text-primary' : 'text-muted'}">${table.row_count.toLocaleString()}</span>
                    </td>
                    <td class="px-4 py-3">${statusBadge}${protectedBadge}</td>
                    <td class="px-4 py-3 text-end">${resetBtn}</td>
                </tr>
            `;
        }).join('');

        // Attach click handlers for individual reset buttons
        tablesBody.querySelectorAll('.btn-reset-table').forEach(btn => {
            btn.addEventListener('click', () => openTableResetModal(btn.dataset.table));
        });
    }

    // ── Individual Table Reset Modal ───────────────────────────────────
    function openTableResetModal(tableName) {
        resetTableNameDisplay.textContent = tableName;
        resetTableNameHidden.value = tableName;
        confirmTableNameInput.value = '';
        btnConfirmTableReset.disabled = true;

        if (!tableResetModalInstance) {
            tableResetModalInstance = new bootstrap.Modal(tableResetModal);
        }
        tableResetModalInstance.show();
    }

    confirmTableNameInput?.addEventListener('input', () => {
        const expected = resetTableNameHidden.value;
        btnConfirmTableReset.disabled = confirmTableNameInput.value.trim() !== expected;
    });

    btnConfirmTableReset?.addEventListener('click', async () => {
        const tableName = resetTableNameHidden.value;
        btnConfirmTableReset.disabled = true;
        btnConfirmTableReset.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Resetting...';

        try {
            const target = getSelectedTarget();
            const result = await apiClient.fetch(`/database/tables/${encodeURIComponent(tableName)}?target=${target}`, {
                method: 'DELETE',
            });

            tableResetModalInstance.hide();

            let msg = result.message || `Table '${tableName}' has been reset.`;
            if (result.dependent_tables_cleared && result.dependent_tables_cleared.length > 0) {
                msg += ` Dependent tables also cleared: ${result.dependent_tables_cleared.join(', ')}.`;
            }
            showAlert(msg, 'success');
            loadDatabaseInfo();
        } catch (err) {
            showAlert(`Failed to reset table '${tableName}': ${err.message}`);
            tableResetModalInstance.hide();
        } finally {
            btnConfirmTableReset.innerHTML = '<i class="bi bi-trash me-1"></i> Reset Table';
            btnConfirmTableReset.disabled = false;
        }
    });

    // ── Full Database Reset Modal ──────────────────────────────────────
    btnResetAll?.addEventListener('click', () => {
        confirmFullResetInput.value = '';
        btnConfirmFullReset.disabled = true;

        if (!fullResetModalInstance) {
            fullResetModalInstance = new bootstrap.Modal(fullResetModal);
        }
        fullResetModalInstance.show();
    });

    confirmFullResetInput?.addEventListener('input', () => {
        btnConfirmFullReset.disabled = confirmFullResetInput.value.trim() !== 'RESET ALL DATA';
    });

    btnConfirmFullReset?.addEventListener('click', async () => {
        btnConfirmFullReset.disabled = true;
        btnConfirmFullReset.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Resetting...';

        try {
            const target = getSelectedTarget();
            const result = await apiClient.fetch(`/database/reset?target=${target}`, { method: 'DELETE' });
            fullResetModalInstance.hide();
            showAlert(result.message || 'Database has been completely reset and re-seeded.', 'success');
            loadDatabaseInfo();
        } catch (err) {
            showAlert('Full database reset failed: ' + err.message);
            fullResetModalInstance.hide();
        } finally {
            btnConfirmFullReset.innerHTML = '<i class="bi bi-nuclear me-1"></i> Reset Entire Database';
            btnConfirmFullReset.disabled = false;
        }
    });

    // ── Refresh Button ─────────────────────────────────────────────────
    btnRefresh?.addEventListener('click', () => {
        alertArea.innerHTML = '';
        loadDatabaseInfo();
    });

    // ── Observe view visibility ────────────────────────────────────────
    const observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
            if (m.attributeName === 'class' && !viewEl.classList.contains('hidden')) {
                alertArea.innerHTML = '';
                loadDatabaseInfo();
            }
        });
    });
    observer.observe(viewEl, { attributes: true });

})();
