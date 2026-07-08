/**
 * SPARSH - Exams Management Logic
 *
 * Handles CRUD for Exam entities via /api/v1/academic/exams.
 * Pattern mirrors academic_years.js exactly.
 */

document.addEventListener('DOMContentLoaded', () => {
    const viewEl = document.getElementById('view-exams');
    if (!viewEl) return;

    let modalInstance = null;
    const tableBody = document.getElementById('examsTableBody');
    const form = document.getElementById('examForm');

    // --- Alert Helper ---
    function showAlert(message, type = 'danger') {
        const area = document.getElementById('examsAlertArea');
        if (!message) { area.innerHTML = ''; return; }
        area.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>`;
    }

    // --- Load & Render ---
    async function loadExams() {
        try {
            tableBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Loading...</td></tr>';
            const items = await apiClient.fetch('/academic/exams');
            renderTable(items);
        } catch (err) {
            showAlert('Failed to load exams: ' + err.message);
            tableBody.innerHTML = '';
        }
    }

    function renderTable(items) {
        if (!items || items.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No exams configured yet.</td></tr>';
            return;
        }
        tableBody.innerHTML = '';
        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${item.exam_name}</strong></td>
                <td><span class="badge bg-light text-dark border">${item.display_order}</span></td>
                <td class="text-end">
                    <button class="btn btn-sm btn-outline-primary btn-edit"
                        data-id="${item.id}"
                        data-name="${item.exam_name}"
                        data-order="${item.display_order}"
                        title="Edit">
                        <i class="bi bi-pencil me-1"></i>Edit
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
                const { id, name, order } = e.currentTarget.dataset;
                openModal(id, name, parseInt(order));
            });
        });
    }

    // --- Modal ---
    function openModal(id = '', name = '', order = '') {
        form.reset();
        document.getElementById('examModalTitle').textContent = id ? 'Edit Exam' : 'Add Exam';
        document.getElementById('examId').value = id;
        document.getElementById('examName').value = name;
        document.getElementById('examOrder').value = order;

        if (!modalInstance) modalInstance = new bootstrap.Modal(document.getElementById('examModal'));
        modalInstance.show();
    }

    document.getElementById('btnNewExam').addEventListener('click', () => openModal());

    // --- Save (Create / Update) ---
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = document.getElementById('btnSaveExam');
        btn.disabled = true;

        const id = document.getElementById('examId').value;
        const payload = {
            exam_name: document.getElementById('examName').value.trim(),
            display_order: parseInt(document.getElementById('examOrder').value),
        };

        try {
            if (id) {
                await apiClient.fetch(`/academic/exams/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
                showAlert('Exam updated successfully.', 'success');
            } else {
                await apiClient.fetch('/academic/exams', { method: 'POST', body: JSON.stringify(payload) });
                showAlert('Exam created successfully.', 'success');
            }
            modalInstance.hide();
            loadExams();
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
                loadExams();
            }
        });
    });
    observer.observe(viewEl, { attributes: true });

    if (!viewEl.classList.contains('hidden')) loadExams();
});
