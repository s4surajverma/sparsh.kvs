/**
 * SPARSH - Subjects Management Logic
 *
 * Handles CRUD for Subject entities via /api/v1/academic/subjects.
 * Pattern mirrors academic_years.js exactly.
 */

document.addEventListener('DOMContentLoaded', () => {
    const viewEl = document.getElementById('view-subjects');
    if (!viewEl) return;

    let modalInstance = null;
    const tableBody = document.getElementById('subjectsTableBody');
    const form = document.getElementById('subjectForm');

    // --- Alert Helper ---
    function showAlert(message, type = 'danger') {
        const area = document.getElementById('subjectsAlertArea');
        if (!message) { area.innerHTML = ''; return; }
        area.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>`;
    }

    // --- Load & Render ---
    async function loadSubjects() {
        try {
            tableBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Loading...</td></tr>';
            const items = await apiClient.fetch('/academic/subjects');
            renderTable(items);
        } catch (err) {
            showAlert('Failed to load subjects: ' + err.message);
            tableBody.innerHTML = '';
        }
    }

    function renderTable(items) {
        if (!items || items.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No subjects configured yet.</td></tr>';
            return;
        }
        tableBody.innerHTML = '';
        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${item.subject_name}</strong></td>
                <td>${item.subject_code ? `<code class="text-primary">${item.subject_code}</code>` : '<span class="text-muted">—</span>'}</td>
                <td class="text-end">
                    <button class="btn btn-sm btn-outline-primary btn-edit"
                        data-id="${item.id}"
                        data-name="${item.subject_name}"
                        data-code="${item.subject_code || ''}"
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
                const { id, name, code } = e.currentTarget.dataset;
                openModal(id, name, code);
            });
        });
    }

    // --- Modal ---
    function openModal(id = '', name = '', code = '') {
        form.reset();
        document.getElementById('subjectModalTitle').textContent = id ? 'Edit Subject' : 'Add Subject';
        document.getElementById('subjectId').value = id;
        document.getElementById('subjectName').value = name;
        document.getElementById('subjectCode').value = code;

        if (!modalInstance) modalInstance = new bootstrap.Modal(document.getElementById('subjectModal'));
        modalInstance.show();
    }

    document.getElementById('btnNewSubject').addEventListener('click', () => openModal());

    // --- Save (Create / Update) ---
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = document.getElementById('btnSaveSubject');
        btn.disabled = true;

        const id = document.getElementById('subjectId').value;
        const codeVal = document.getElementById('subjectCode').value.trim();
        const payload = {
            subject_name: document.getElementById('subjectName').value.trim(),
            subject_code: codeVal || null,
        };

        try {
            if (id) {
                await apiClient.fetch(`/academic/subjects/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
                showAlert('Subject updated successfully.', 'success');
            } else {
                await apiClient.fetch('/academic/subjects', { method: 'POST', body: JSON.stringify(payload) });
                showAlert('Subject created successfully.', 'success');
            }
            modalInstance.hide();
            loadSubjects();
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
                loadSubjects();
            }
        });
    });
    observer.observe(viewEl, { attributes: true });

    if (!viewEl.classList.contains('hidden')) loadSubjects();
});
