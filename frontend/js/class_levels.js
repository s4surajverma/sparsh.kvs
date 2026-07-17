/**
 * SPARSH - Class Levels Management Logic
 *
 * Handles CRUD for ClassLevel entities via /api/v1/academic/classes.
 * Pattern mirrors academic_years.js exactly.
 */

document.addEventListener('DOMContentLoaded', () => {
    const viewEl = document.getElementById('view-class-levels');
    if (!viewEl) return;

    let modalInstance = null;
    const tableBody = document.getElementById('classLevelsTableBody');
    const form = document.getElementById('classLevelForm');

    // --- Alert Helper ---
    function showAlert(message, type = 'danger') {
        const area = document.getElementById('classLevelsAlertArea');
        if (!message) { area.innerHTML = ''; return; }
        area.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>`;
    }

    // --- Load & Render ---
    async function loadClassLevels() {
        try {
            tableBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Loading...</td></tr>';
            const items = await apiClient.fetch('/academic/classes');
            renderTable(items);
        } catch (err) {
            showAlert('Failed to load class levels: ' + err.message);
            tableBody.innerHTML = '';
        }
    }

    function renderTable(items) {
        if (!items || items.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No class levels configured yet.</td></tr>';
            return;
        }
        tableBody.innerHTML = '';
        items.forEach(item => {
            const sectionsList = item.sections ? item.sections.split(',') : [];
            const sectionsHtml = sectionsList.length > 0 
                ? sectionsList.map(s => `<span class="badge bg-secondary me-1">${s}</span>`).join('')
                : '<span class="text-muted small">None</span>';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${item.class_name}</strong></td>
                <td><span class="badge bg-light text-dark border">${item.display_order}</span></td>
                <td>${sectionsHtml}</td>
                <td class="text-end">
                    <button class="btn btn-sm btn-outline-primary btn-edit me-1"
                        data-id="${item.id}"
                        data-name="${item.class_name}"
                        data-order="${item.display_order}"
                        data-sections="${item.sections || ''}"
                        title="Edit">
                        <i class="bi bi-pencil me-1"></i>Edit
                    </button>
                    <button class="btn btn-sm btn-outline-danger btn-delete"
                        data-id="${item.id}"
                        data-name="${item.class_name}"
                        title="Delete">
                        <i class="bi bi-trash me-1"></i>Delete
                    </button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
        attachListeners();
    }

    function attachListeners() {
        tableBody.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', e => {
                const { id, name, order, sections } = e.currentTarget.dataset;
                openModal(id, name, parseInt(order), sections);
            });
        });

        tableBody.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', async e => {
                const { id, name } = e.currentTarget.dataset;
                if (!confirm(`Are you sure you want to delete class level "${name}"? This action cannot be undone.`)) return;
                try {
                    await apiClient.fetch(`/academic/classes/${id}`, { method: 'DELETE' });
                    showAlert('Class level deleted successfully.', 'success');
                    loadClassLevels();
                } catch (err) {
                    showAlert('Failed to delete class level: ' + err.message);
                }
            });
        });
    }

    // --- Modal ---
    function openModal(id = '', name = '', order = '', sections = '') {
        form.reset();
        document.getElementById('classLevelModalTitle').textContent = id ? 'Edit Class Level' : 'Add Class Level';
        document.getElementById('classLevelId').value = id;
        document.getElementById('classLevelName').value = name;
        document.getElementById('classLevelOrder').value = order;
        
        // Handle checkboxes
        const secList = sections ? sections.split(',') : [];
        document.querySelectorAll('.section-cb').forEach(cb => {
            cb.checked = secList.includes(cb.value);
        });

        if (!modalInstance) modalInstance = new bootstrap.Modal(document.getElementById('classLevelModal'));
        modalInstance.show();
    }

    document.getElementById('btnNewClassLevel').addEventListener('click', () => openModal());

    // --- Save (Create / Update) ---
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = document.getElementById('btnSaveClassLevel');
        btn.disabled = true;

        const id = document.getElementById('classLevelId').value;
        
        // Collect checked sections
        const checkedSections = Array.from(document.querySelectorAll('.section-cb:checked'))
                                    .map(cb => cb.value)
                                    .join(',');

        const payload = {
            class_name: document.getElementById('classLevelName').value.trim(),
            display_order: parseInt(document.getElementById('classLevelOrder').value),
            sections: checkedSections
        };

        try {
            if (id) {
                await apiClient.fetch(`/academic/classes/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
                showAlert('Class level updated successfully.', 'success');
            } else {
                await apiClient.fetch('/academic/classes', { method: 'POST', body: JSON.stringify(payload) });
                showAlert('Class level created successfully.', 'success');
            }
            modalInstance.hide();
            loadClassLevels();
        } catch (err) {
            alert('Error: ' + err.message);
        } finally {
            btn.disabled = false;
        }
    });

    // --- Observe view visibility ---
    const observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
            if (m.attributeName === 'class' && !viewEl.classList.contains('hidden')) {
                loadClassLevels();
            }
        });
    });
    observer.observe(viewEl, { attributes: true });

    if (!viewEl.classList.contains('hidden')) loadClassLevels();
});
