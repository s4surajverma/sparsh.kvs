/**
 * SPARSH - Bulk Student Import Wizard
 *
 * 4-step wizard for the student-import view:
 *  Step 1 — Upload xlsx + choose target year → Analyze
 *  Step 2 — Preview detected columns → Run Validation
 *  Step 3 — Review new / existing / conflict rows; admin decides per-row → Commit
 *  Step 4 — Result summary
 *
 * Existing student rows show a per-row "Keep / Update Name" toggle.
 * The admin's decisions are sent as a JSON map { admission_number: "keep"|"update_name" }.
 */

document.addEventListener('DOMContentLoaded', () => {
    const viewEl = document.getElementById('view-student-import');
    if (!viewEl) return;

    // ── State ──────────────────────────────────────────────────────────
    let analysisResult = null;
    let dryRunResult   = null;
    let uploadedFile   = null;

    // Column mapping state (from analysis — user can view but not change in this simplified UI)
    let detectedCols = {};

    // ── Helpers ────────────────────────────────────────────────────────

    function showAlert(msg, type = 'danger') {
        const area = document.getElementById('siAlertArea');
        area.innerHTML = msg
            ? `<div class="alert alert-${type} alert-dismissible fade show">${msg}<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`
            : '';
    }

    function showStep(n) {
        [1, 2, 3, 4].forEach(i => {
            const el = document.getElementById(`siStep${i}`);
            if (el) el.classList.toggle('hidden', i !== n);
        });
        showAlert('');
    }

    function badge(count, type) {
        return `<span class="badge bg-${type} me-1">${count}</span>`;
    }

    // ── Load Academic Years into target year dropdown ──────────────────

    async function loadYears() {
        const sel = document.getElementById('siTargetYear');
        if (!sel || sel.options.length > 1) return;
        try {
            const years = await apiClient.fetch('/academic/years');
            years.forEach(y => {
                const opt = document.createElement('option');
                opt.value = y.id;
                opt.textContent = y.year_label + (y.is_current ? ' (Current)' : '');
                sel.appendChild(opt);
            });
        } catch (e) { console.error('Failed to load years:', e); }
    }

    // ── Step 1 → Analyze ──────────────────────────────────────────────

    document.getElementById('btnSiAnalyze')?.addEventListener('click', async () => {
        const yearId = document.getElementById('siTargetYear').value;
        const file   = document.getElementById('siFile').files[0];

        if (!yearId)  { showAlert('Please select a target academic year.', 'warning'); return; }
        if (!file)    { showAlert('Please select an Excel file to upload.', 'warning'); return; }
        if (!file.name.endsWith('.xlsx')) { showAlert('Only .xlsx files are supported.', 'warning'); return; }

        uploadedFile = file;
        showAlert('');

        try {
            const fd = new FormData();
            fd.append('file', file);
            const result = await apiClient.fetchRaw('/students/import/analyze', { method: 'POST', body: fd });
            analysisResult = result;
            detectedCols   = result.detected_columns || {};
            renderColumnPreview(result);
            showStep(2);
        } catch (err) {
            showAlert('Analysis failed: ' + err.message);
        }
    });

    function renderColumnPreview(result) {
        const el = document.getElementById('siColumnPreview');
        const cols = result.detected_columns || {};

        const rows = [
            ['Admission Number', cols.admission_number || '<span class="text-danger">Not detected</span>'],
            ['Student Name',     cols.student_name     || '<span class="text-danger">Not detected</span>'],
            ['Class Name',       cols.class_level_id   || '<span class="text-muted">—</span>'],
            ['Section',          cols.section          || '<span class="text-muted">—</span>'],
            ['Roll Number',      cols.roll_number      || '<span class="text-muted">—</span>'],
        ];

        el.innerHTML = `
            <table class="table table-sm table-bordered" style="max-width:480px;">
                <thead class="table-light"><tr><th>Expected Field</th><th>Detected Column</th></tr></thead>
                <tbody>${rows.map(([f, c]) => `<tr><td>${f}</td><td>${c}</td></tr>`).join('')}</tbody>
            </table>
            <p class="text-muted small mt-2 mb-0">Total rows detected: <strong>${result.total_rows}</strong></p>
        `;

        const noteEl = document.getElementById('siEnrollmentNote');
        if (result.has_enrollment_columns) {
            noteEl.innerHTML = '<i class="bi bi-info-circle me-1"></i> Enrollment columns (class, section, roll number) detected. StudentEnrollment records will be created for the selected target year where possible.';
        } else {
            noteEl.innerHTML = '<i class="bi bi-info-circle me-1"></i> No enrollment columns detected. Only Student identity records will be created (no enrollment).';
        }

        if (result.issues && result.issues.length) {
            showAlert(result.issues.join('<br>'), 'warning');
        }
    }

    // ── Step 2 → Dry-run ──────────────────────────────────────────────

    document.getElementById('btnSiBack1')?.addEventListener('click', () => showStep(1));

    document.getElementById('btnSiDryRun')?.addEventListener('click', async () => {
        const yearId = document.getElementById('siTargetYear').value;

        const fd = new FormData();
        fd.append('file', uploadedFile);
        fd.append('target_year_id', yearId);
        if (detectedCols.admission_number) fd.append('adm_col', detectedCols.admission_number);
        if (detectedCols.student_name)     fd.append('name_col', detectedCols.student_name);
        if (detectedCols.class_level_id)   fd.append('class_col', detectedCols.class_level_id);
        if (detectedCols.section)          fd.append('section_col', detectedCols.section);
        if (detectedCols.roll_number)      fd.append('roll_col', detectedCols.roll_number);

        try {
            dryRunResult = await apiClient.fetchRaw('/students/import/dry-run', { method: 'POST', body: fd });
            renderDryRun(dryRunResult);
            showStep(3);
        } catch (err) {
            showAlert('Validation failed: ' + err.message);
        }
    });

    function renderDryRun(result) {
        const s = result.summary;
        document.getElementById('siDryRunSummary').innerHTML = `
            <div class="d-flex flex-wrap gap-3">
                <span class="badge bg-success fs-6 px-3 py-2">✚ ${s.will_create} New</span>
                <span class="badge bg-warning text-dark fs-6 px-3 py-2">⚠ ${s.require_decision} Need Decision</span>
                <span class="badge bg-info text-dark fs-6 px-3 py-2">↷ ${s.conflicts_skipped} Conflicts</span>
                ${s.errors ? `<span class="badge bg-danger fs-6 px-3 py-2">✕ ${s.errors} Errors</span>` : ''}
            </div>`;

        // New students
        const newSec  = document.getElementById('siNewStudentsSection');
        const newBody = document.getElementById('siNewStudentsBody');
        if (result.new_students.length) {
            document.getElementById('siNewCount').textContent = result.new_students.length;
            newBody.innerHTML = result.new_students.map(r => `
                <tr>
                    <td>${r.row}</td>
                    <td><code>${r.admission_number}</code></td>
                    <td>${r.file_name}</td>
                    <td>${r.section || '—'}</td>
                    <td>${r.section || '—'}</td>
                    <td>${r.roll_number || '—'}</td>
                </tr>`).join('');
            newSec.classList.remove('hidden');
        } else {
            newSec.classList.add('hidden');
        }

        // Existing students — per-row decision toggle
        const exSec  = document.getElementById('siExistingSection');
        const exBody = document.getElementById('siExistingBody');
        if (result.existing_students.length) {
            document.getElementById('siExistingCount').textContent = result.existing_students.length;
            exBody.innerHTML = result.existing_students.map(r => `
                <tr>
                    <td>${r.row}</td>
                    <td><code>${r.admission_number}</code></td>
                    <td>${r.file_name}</td>
                    <td>${r.db_name || '—'} ${r.name_changed ? '<span class="badge bg-warning text-dark ms-1">Changed</span>' : ''}</td>
                    <td>
                        <div class="btn-group btn-group-sm" role="group">
                            <input type="radio" class="btn-check" name="decision_${r.admission_number}" id="keep_${r.admission_number}" value="keep" autocomplete="off" checked>
                            <label class="btn btn-outline-secondary" for="keep_${r.admission_number}">Keep</label>
                            <input type="radio" class="btn-check" name="decision_${r.admission_number}" id="upd_${r.admission_number}" value="update_name" autocomplete="off">
                            <label class="btn btn-outline-primary" for="upd_${r.admission_number}">Update Name</label>
                        </div>
                    </td>
                </tr>`).join('');
            exSec.classList.remove('hidden');
        } else {
            exSec.classList.add('hidden');
        }

        // Conflicts
        const conflSec  = document.getElementById('siConflictSection');
        const conflBody = document.getElementById('siConflictBody');
        if (result.enrollment_conflicts.length) {
            document.getElementById('siConflictCount').textContent = result.enrollment_conflicts.length;
            conflBody.innerHTML = result.enrollment_conflicts.map(r =>
                `<tr><td><code>${r.admission_number}</code></td><td>${r.file_name}</td></tr>`).join('');
            conflSec.classList.remove('hidden');
        } else {
            conflSec.classList.add('hidden');
        }

        // Errors
        const errSec  = document.getElementById('siErrorSection');
        const errList = document.getElementById('siErrorList');
        if (result.errors.length) {
            document.getElementById('siErrorCount').textContent = result.errors.length;
            errList.innerHTML = result.errors.map(e =>
                `<div class="alert alert-danger py-1 px-2 mb-1 small">Row ${e.row}: ${e.message}</div>`).join('');
            errSec.classList.remove('hidden');
        } else {
            errSec.classList.add('hidden');
        }
    }

    // ── Step 3 → Commit ───────────────────────────────────────────────

    document.getElementById('btnSiBack2')?.addEventListener('click', () => showStep(2));

    document.getElementById('btnSiCommit')?.addEventListener('click', async () => {
        const yearId = document.getElementById('siTargetYear').value;

        // Collect admin decisions for existing students
        const decisions = {};
        if (dryRunResult?.existing_students) {
            dryRunResult.existing_students.forEach(r => {
                const selected = document.querySelector(`input[name="decision_${r.admission_number}"]:checked`);
                decisions[r.admission_number] = selected?.value || 'keep';
            });
        }

        const fd = new FormData();
        fd.append('file', uploadedFile);
        fd.append('target_year_id', yearId);
        fd.append('decisions_json', JSON.stringify(decisions));
        if (detectedCols.admission_number) fd.append('adm_col', detectedCols.admission_number);
        if (detectedCols.student_name)     fd.append('name_col', detectedCols.student_name);
        if (detectedCols.class_level_id)   fd.append('class_col', detectedCols.class_level_id);
        if (detectedCols.section)          fd.append('section_col', detectedCols.section);
        if (detectedCols.roll_number)      fd.append('roll_col', detectedCols.roll_number);

        try {
            const result = await apiClient.fetchRaw('/students/import/commit', { method: 'POST', body: fd });
            renderCommitResult(result);
            showStep(4);
        } catch (err) {
            showAlert('Commit failed: ' + err.message);
        }
    });

    function renderCommitResult(result) {
        const s = result.summary;
        document.getElementById('siResultSummary').innerHTML = `
            <div class="alert alert-success">
                <h5 class="fw-bold mb-2"><i class="bi bi-check-circle me-2"></i>Import Complete</h5>
                <ul class="mb-0">
                    <li><strong>${s.students_created}</strong> students created</li>
                    <li><strong>${s.students_updated}</strong> student names updated</li>
                    <li><strong>${s.students_kept}</strong> existing records kept unchanged</li>
                    <li><strong>${s.enrollments_created}</strong> enrollments created</li>
                    ${s.enrollment_conflicts_skipped ? `<li class="text-warning">${s.enrollment_conflicts_skipped} enrollment conflicts skipped (already enrolled)</li>` : ''}
                    ${s.errors ? `<li class="text-danger">${s.errors} rows had errors</li>` : ''}
                </ul>
            </div>`;
    }

    document.getElementById('btnSiReset')?.addEventListener('click', () => {
        analysisResult = null; dryRunResult = null; uploadedFile = null;
        document.getElementById('siFile').value = '';
        document.getElementById('siTargetYear').selectedIndex = 0;
        showStep(1);
        showAlert('');
    });

    // ── Observe view show → load years ────────────────────────────────
    const obs = new MutationObserver(mutations => {
        mutations.forEach(m => {
            if (m.attributeName === 'class' && !viewEl.classList.contains('hidden')) {
                loadYears();
            }
        });
    });
    obs.observe(viewEl, { attributes: true });
    if (!viewEl.classList.contains('hidden')) loadYears();

    // ── Template Download ─────────────────────────────────────────────
    document.getElementById('btnDownloadStudentMasterTemplate')?.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            await apiClient.downloadFile('/templates/download/student_master', 'student_master_template.xlsx');
        } catch (err) {
            showAlert('Failed to download template: ' + err.message);
        }
    });
});
