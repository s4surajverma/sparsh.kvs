/**
 * SPARSH - Student Entry UI
 *
 * Handles the student-entry view:
 *  - Paginated search table (admission number or name)
 *  - Add / Edit modal (POST /students/, PUT /students/{adm})
 *  - Export button wiring in marks-entry view
 *
 * Pattern mirrors class_levels.js.
 */

document.addEventListener('DOMContentLoaded', () => {

    // ── Student Entry ──────────────────────────────────────────────
    const viewEl = document.getElementById('view-student-entry');
    if (!viewEl) return;

    const tableBody = document.getElementById('studentRegistryTableBody');
    const form      = document.getElementById('studentForm');
    let modalInstance = null;

    const PAGE_SIZE = 25;
    let currentPage = 1;
    let totalCount  = 0;
    let lastQuery   = '';

    function showAlert(msg, type = 'danger') {
        const area = document.getElementById('studentRegistryAlertArea');
        area.innerHTML = msg
            ? `<div class="alert alert-${type} alert-dismissible fade show">${msg}<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`
            : '';
    }

    // ── Load / Render ──────────────────────────────────────────────────

    async function loadStudents(query = '', page = 1) {
        lastQuery   = query;
        currentPage = page;
        tableBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Loading…</td></tr>';
        try {
            const skip   = (page - 1) * PAGE_SIZE;
            let url = `/students/?limit=${PAGE_SIZE}&skip=${skip}`;
            if (query.trim()) url += `&search=${encodeURIComponent(query.trim())}`;

            // Try /students/search if the query looks like an admission number,
            // otherwise use the list endpoint with search param.
            const data = await apiClient.fetch(url);

            // API returns array or { students, total } — handle both shapes
            let students, total;
            if (Array.isArray(data)) {
                students = data;
                total    = data.length;
            } else {
                students = data.students || data.items || [];
                total    = data.total   || students.length;
            }

            totalCount = total;
            renderTable(students);
            renderPagination();
        } catch (err) {
            showAlert('Failed to load students: ' + err.message);
            tableBody.innerHTML = '';
        }
    }

    function renderTable(students) {
        if (!students || students.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No students found.</td></tr>';
            document.getElementById('studentRegistryPagination').classList.add('hidden');
            return;
        }
        tableBody.innerHTML = '';
        students.forEach(s => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><code>${s.admission_number}</code></td>
                <td>${s.student_name}</td>
                <td class="text-end">
                    <button class="btn btn-sm btn-outline-primary btn-edit-student"
                        data-adm="${s.admission_number}" data-name="${s.student_name}">
                        <i class="bi bi-pencil me-1"></i>Edit
                    </button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
        tableBody.querySelectorAll('.btn-edit-student').forEach(btn => {
            btn.addEventListener('click', e => {
                const { adm, name } = e.currentTarget.dataset;
                openModal(adm, name);
            });
        });
    }

    function renderPagination() {
        const pag   = document.getElementById('studentRegistryPagination');
        const info  = document.getElementById('studentPaginationInfo');
        const prev  = document.getElementById('btnStudentPrev');
        const next  = document.getElementById('btnStudentNext');
        const start = (currentPage - 1) * PAGE_SIZE + 1;
        const end   = Math.min(currentPage * PAGE_SIZE, totalCount);

        if (totalCount <= PAGE_SIZE) { pag.classList.add('hidden'); return; }
        pag.classList.remove('hidden');
        info.textContent  = `Showing ${start}–${end} of ${totalCount}`;
        prev.disabled = currentPage <= 1;
        next.disabled = currentPage * PAGE_SIZE >= totalCount;
    }

    // ── Search buttons ─────────────────────────────────────────────────

    document.getElementById('btnStudentSearch')?.addEventListener('click', () => {
        loadStudents(document.getElementById('studentSearchInput').value);
    });
    document.getElementById('studentSearchInput')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') loadStudents(e.target.value);
    });
    document.getElementById('btnStudentShowAll')?.addEventListener('click', () => {
        document.getElementById('studentSearchInput').value = '';
        loadStudents('');
    });
    document.getElementById('btnStudentPrev')?.addEventListener('click', () => loadStudents(lastQuery, currentPage - 1));
    document.getElementById('btnStudentNext')?.addEventListener('click', () => loadStudents(lastQuery, currentPage + 1));

    // ── Modal ──────────────────────────────────────────────────────────

    function openModal(adm = '', name = '') {
        form.reset();
        const isEdit = !!adm;
        document.getElementById('studentModalTitle').textContent = isEdit ? 'Edit Student' : 'Add Student';
        document.getElementById('studentModalAdm').value      = adm;
        document.getElementById('studentModalAdmInput').value = adm;
        document.getElementById('studentModalAdmInput').readOnly = isEdit;
        document.getElementById('studentAdmHelp').textContent = isEdit
            ? 'Admission number cannot be changed.'
            : 'Must be unique. Cannot be changed after creation.';
        document.getElementById('studentModalName').value = name;

        if (!modalInstance) modalInstance = new bootstrap.Modal(document.getElementById('studentModal'));
        modalInstance.show();
    }

    document.getElementById('btnNewStudent')?.addEventListener('click', () => openModal());

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const btn  = document.getElementById('btnSaveStudent');
        btn.disabled = true;

        const adm  = document.getElementById('studentModalAdm').value;
        const admInput = document.getElementById('studentModalAdmInput').value.trim();
        const name = document.getElementById('studentModalName').value.trim();
        const payload = { admission_number: admInput, student_name: name };

        try {
            if (adm) {
                await apiClient.fetch(`/students/${encodeURIComponent(adm)}`, { method: 'PUT', body: JSON.stringify({ student_name: name }) });
                showAlert('Student updated successfully.', 'success');
            } else {
                await apiClient.fetch('/students/', { method: 'POST', body: JSON.stringify(payload) });
                showAlert('Student added successfully.', 'success');
            }
            modalInstance.hide();
            loadStudents(lastQuery, currentPage);
        } catch (err) {
            alert('Error: ' + err.message);
        } finally {
            btn.disabled = false;
        }
    });

    // ── Observe view show ──────────────────────────────────────────────
    const observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
            if (m.attributeName === 'class' && !viewEl.classList.contains('hidden')) {
                // Don't auto-load all — wait for user to search or click Show All
                tableBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Search or click Show All to load students.</td></tr>';
                document.getElementById('studentRegistryPagination').classList.add('hidden');
            }
        });
    });
    observer.observe(viewEl, { attributes: true });


    // ── Export Excel button in Marks Entry ─────────────────────────────
    // Wired here because it needs access to the marks form values.
    // The button href is updated when a class/exam is loaded.
    const btnExport = document.getElementById('btnExportMarks');
    if (btnExport) {
        // Called by marks_entry.js indirectly via a custom event, or we
        // watch the marksGridContainer visibility change for simplicity.
        const marksGrid = document.getElementById('marksGridContainer');
        if (marksGrid) {
            const exportObs = new MutationObserver(() => {
                if (!marksGrid.classList.contains('hidden')) {
                    updateExportLink();
                }
            });
            exportObs.observe(marksGrid, { attributes: true });
        }
        
        btnExport.addEventListener('click', async (e) => {
            e.preventDefault();
            if (btnExport.classList.contains('disabled')) return;
            const url = btnExport.dataset.url;
            if (url) {
                try {
                    await apiClient.downloadFile(url, 'marks_export.xlsx');
                } catch (err) {
                    alert('Export failed: ' + err.message);
                }
            }
        });
    }

    function updateExportLink() {
        const classEl = document.getElementById('marksClass');
        const sectEl  = document.getElementById('marksSection');
        const examEl  = document.getElementById('marksExam');
        const btn     = document.getElementById('btnExportMarks');
        if (!btn || !classEl || !sectEl || !examEl) return;

        const classId = classEl.value;
        const section = sectEl.value.trim().toUpperCase();
        const examId  = examEl.value;

        // We need the academic_year_id — read from the year display hidden input used by marks_entry.js
        const yearHidden = document.getElementById('marksYearId') || document.getElementById('importYearId');
        const acYearId   = yearHidden?.value;

        if (acYearId && classId && section && examId) {
            // Store endpoint in data-url instead of href to trigger authenticated fetch
            btn.dataset.url = `/marks/export?academic_year_id=${acYearId}&class_level_id=${classId}&section=${section}&exam_id=${examId}`;
            btn.classList.remove('disabled');
        } else {
            btn.dataset.url = '';
            btn.classList.add('disabled');
        }
    }

    // Also update when marksClass/marksExam/marksSection change
    ['marksClass', 'marksExam', 'marksSection'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', updateExportLink);
    });

    // ── Student Entry Action Buttons ──────────────────────────────────
    document.getElementById('btnDownloadStudentMasterTemplateEntry')?.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            await apiClient.downloadFile('/templates/download/student_master', 'student_master_template.xlsx');
        } catch (err) {
            showAlert('Failed to download template: ' + err.message);
        }
    });

    document.getElementById('btnGoToBulkStudentImport')?.addEventListener('click', () => {
        // Navigate to the Bulk Student Import view
        const link = document.querySelector('a[data-view="student-import"]');
        if (link) link.click();
    });
});
