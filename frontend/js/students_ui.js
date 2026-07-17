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

    function showModalAlert(msg, type = 'danger') {
        const area = document.getElementById('studentModalAlertArea');
        if (!area) return;
        area.innerHTML = msg
            ? `<div class="alert alert-${type} alert-dismissible fade show py-2 mb-2">${msg}<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`
            : '';
    }

    // ── Load / Render ──────────────────────────────────────────────────

    async function loadStudents(query = '', page = 1) {
        lastQuery   = query;
        currentPage = page;
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Loading…</td></tr>';
        try {
            const skip   = (page - 1) * PAGE_SIZE;
            let url = `/students/search?limit=${PAGE_SIZE}&skip=${skip}`;
            if (query.trim()) url += `&q=${encodeURIComponent(query.trim())}`;

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
            tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No students found.</td></tr>';
            document.getElementById('studentRegistryPagination').classList.add('hidden');
            return;
        }
        tableBody.innerHTML = '';
        students.forEach(s => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><code>${s.admission_number}</code></td>
                <td>${s.student_name}</td>
                <td>${s.class_name || '<span class="text-muted">-</span>'}</td>
                <td>${s.section ? `<span class="badge bg-secondary">${s.section}</span>` : '<span class="text-muted">-</span>'}</td>
                <td>${s.roll_number || '<span class="text-muted">-</span>'}</td>
                <td class="text-end">
                    <button class="btn btn-sm btn-outline-primary btn-edit-student me-1"
                        data-adm="${s.admission_number}"
                        data-name="${s.student_name}"
                        data-enrollment-id="${s.enrollment_id || ''}"
                        data-class-id="${s.class_id || ''}"
                        data-section="${s.section || ''}"
                        data-roll="${s.roll_number || ''}">
                        <i class="bi bi-pencil me-1"></i>Edit
                    </button>
                    <button class="btn btn-sm btn-outline-danger btn-delete-student"
                        data-adm="${s.admission_number}" data-name="${s.student_name}">
                        <i class="bi bi-trash me-1"></i>Delete
                    </button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
        tableBody.querySelectorAll('.btn-edit-student').forEach(btn => {
            btn.addEventListener('click', e => {
                const { adm, name, enrollmentId, classId, section, roll } = e.currentTarget.dataset;
                openModal(adm, name, enrollmentId, classId, section, roll);
            });
        });
        tableBody.querySelectorAll('.btn-delete-student').forEach(btn => {
            btn.addEventListener('click', async e => {
                const { adm, name } = e.currentTarget.dataset;
                if (!confirm(`Are you sure you want to delete student "${name}" (${adm}) and their enrollments/results? This action cannot be undone.`)) return;
                try {
                    await apiClient.fetch(`/students/${encodeURIComponent(adm)}`, { method: 'DELETE' });
                    showAlert('Student deleted successfully.', 'success');
                    loadStudents(lastQuery, currentPage);
                } catch (err) {
                    showAlert('Failed to delete student: ' + err.message);
                }
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

    function openModal(adm = '', name = '', enrollmentId = '', classId = '', section = '', roll = '') {
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

        // Store enrollment id for PUT /enrollments/{id} on save
        let enrollmentIdField = document.getElementById('studentModalEnrollmentId');
        if (!enrollmentIdField) {
            enrollmentIdField = document.createElement('input');
            enrollmentIdField.type = 'hidden';
            enrollmentIdField.id   = 'studentModalEnrollmentId';
            form.appendChild(enrollmentIdField);
        }
        enrollmentIdField.value = enrollmentId || '';

        // Clear any previous modal error
        showModalAlert('');

        const enrollmentContainer = document.getElementById('studentModalEnrollmentFields');
        if (enrollmentContainer) {
            // Always show enrollment fields (both add and edit)
            enrollmentContainer.classList.remove('hidden');
            // Load classes, then pre-select current values when editing
            loadClassesForStudentModal(classId, section, roll);
        }

        if (!modalInstance) modalInstance = new bootstrap.Modal(document.getElementById('studentModal'));
        modalInstance.show();
    }

    async function loadClassesForStudentModal(selectedClassId = '', selectedSection = '', selectedRoll = '') {
        const classSelect   = document.getElementById('studentModalClass');
        const sectionSelect = document.getElementById('studentModalSection');
        const rollInput     = document.getElementById('studentModalRoll');
        if (!classSelect || !sectionSelect) return;

        classSelect.innerHTML   = '<option value="">Loading classes...</option>';
        
        // Immediately populate default A–H sections and keep dropdown enabled
        populateSectionsDropdown(sectionSelect, 'A,B,C,D,E,F,G,H', selectedSection);
        sectionSelect.disabled = false;

        try {
            const classes = await apiClient.fetch('/academic/classes');
            classSelect.innerHTML = '<option value="">Select class...</option>';
            classes.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.class_name;
                opt.dataset.sections = c.sections || '';
                if (String(c.id) === String(selectedClassId)) opt.selected = true;
                classSelect.appendChild(opt);
            });

            // If pre-selecting a class, populate sections for that class and select the right one
            if (selectedClassId) {
                classSelect.dispatchEvent(new Event('change'));
                setTimeout(() => {
                    if (selectedSection) sectionSelect.value = selectedSection;
                    if (selectedRoll && rollInput) rollInput.value = selectedRoll;
                }, 50);
            } else if (selectedRoll && rollInput) {
                rollInput.value = selectedRoll;
            }
        } catch (err) {
            classSelect.innerHTML = '<option value="">Failed to load classes</option>';
        }
    }

    function populateSectionsDropdown(selectElement, sectionsStr, selectedVal = '') {
        selectElement.innerHTML = '<option value="">Select section...</option>';
        const sections = (sectionsStr || 'A,B,C,D,E,F,G,H').split(',').map(s => s.trim()).filter(Boolean);
        sections.forEach(sec => {
            const opt = document.createElement('option');
            opt.value = sec;
            opt.textContent = sec;
            if (sec === selectedVal) opt.selected = true;
            selectElement.appendChild(opt);
        });
        selectElement.disabled = false;
    }

    document.getElementById('studentModalClass')?.addEventListener('change', (e) => {
        const sectionSelect = document.getElementById('studentModalSection');
        if (!sectionSelect) return;
        const selectedOpt = e.target.options[e.target.selectedIndex];
        const raw = selectedOpt?.dataset.sections?.trim();
        const sectionsStr = raw || 'A,B,C,D,E,F,G,H';

        const currentVal = sectionSelect.value;
        populateSectionsDropdown(sectionSelect, sectionsStr, currentVal);
    });

    document.getElementById('btnNewStudent')?.addEventListener('click', () => openModal());

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const btn  = document.getElementById('btnSaveStudent');
        btn.disabled = true;

        const adm        = document.getElementById('studentModalAdm').value;
        const admInput   = document.getElementById('studentModalAdmInput').value.trim();
        const name       = document.getElementById('studentModalName').value.trim();
        const enrollmentId = document.getElementById('studentModalEnrollmentId')?.value || '';
        const classId    = document.getElementById('studentModalClass')?.value;
        const section    = document.getElementById('studentModalSection')?.value;
        const rollStr    = document.getElementById('studentModalRoll')?.value;

        const payload = { admission_number: admInput, student_name: name };

        try {
            if (adm) {
                // Update student name
                await apiClient.fetch(`/students/${encodeURIComponent(adm)}`, {
                    method: 'PUT',
                    body: JSON.stringify({ student_name: name }),
                });

                // Update enrollment (class / section / roll) if we have an enrollment ID
                if (enrollmentId && (classId || section || rollStr)) {
                    const enrollPayload = {};
                    if (classId)  enrollPayload.class_level_id = parseInt(classId, 10);
                    if (section)  enrollPayload.section        = section.toUpperCase();
                    if (rollStr)  enrollPayload.roll_number    = parseInt(rollStr, 10);
                    await apiClient.fetch(`/students/enrollments/${enrollmentId}`, {
                        method: 'PUT',
                        body: JSON.stringify(enrollPayload),
                    });
                }

                showAlert('Student updated successfully.', 'success');
            } else {
                if (classId && section && rollStr) {
                    payload.class_level_id = parseInt(classId, 10);
                    payload.section        = section;
                    payload.roll_number    = parseInt(rollStr, 10);
                }
                await apiClient.fetch('/students/', { method: 'POST', body: JSON.stringify(payload) });
                showAlert('Student added successfully.', 'success');
            }
            modalInstance.hide();
            loadStudents(lastQuery, currentPage);
        } catch (err) {
            showModalAlert(err.message || 'An unexpected error occurred.');
        } finally {
            btn.disabled = false;
        }
    });

    // ── Observe view show ──────────────────────────────────────────────
    const observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
            if (m.attributeName === 'class' && !viewEl.classList.contains('hidden')) {
                // Don't auto-load all — wait for user to search or click Show All
                tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Search or click Show All to load students.</td></tr>';
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
        if (typeof window.switchView === 'function') {
            window.switchView('student-import');
        } else {
            const link = document.querySelector('a[data-view="student-import"]');
            if (link) link.click();
        }
    });
});
