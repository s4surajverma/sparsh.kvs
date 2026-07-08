/**
 * SPARSH - Bulk Promotion Wizard
 *
 * 3-step wizard for the bulk-promotion view:
 *  Step 1 — Configure source/target class+section+year + roll-number mode
 *  Step 2 — Preview student list with per-student exclusion checkboxes
 *  Step 3 — Result summary
 *
 * Calls POST /api/v1/students/promote
 */

document.addEventListener('DOMContentLoaded', () => {
    const viewEl = document.getElementById('view-bulk-promotion');
    if (!viewEl) return;

    // ── State ──────────────────────────────────────────────────────────
    // Students loaded from the source enrollment — fetched via /students/ filtered endpoint
    let previewStudents = [];
    let dropdownsLoaded = false;

    // ── Helpers ────────────────────────────────────────────────────────

    function showAlert(msg, type = 'danger') {
        const area = document.getElementById('promoAlertArea');
        area.innerHTML = msg
            ? `<div class="alert alert-${type} alert-dismissible fade show">${msg}<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`
            : '';
    }

    function showStep(n) {
        [1, 2, 3].forEach(i => {
            const el = document.getElementById(`promoStep${i}`);
            if (el) el.classList.toggle('hidden', i !== n);
        });
        showAlert('');
    }

    function updateSelectedCount() {
        const checked = document.querySelectorAll('.promo-row-check:checked').length;
        document.getElementById('promoSelectedCount').textContent = checked;
    }

    // ── Load dropdowns (years + classes) ──────────────────────────────

    async function loadDropdowns() {
        if (dropdownsLoaded) return;
        try {
            const [years, classes] = await Promise.all([
                apiClient.fetch('/academic/years'),
                apiClient.fetch('/academic/classes'),
            ]);

            const yearSelectors  = ['promoSrcYear', 'promoTgtYear'];
            const classSelectors = ['promoSrcClass', 'promoTgtClass'];

            yearSelectors.forEach(id => {
                const sel = document.getElementById(id);
                if (!sel) return;
                years.forEach(y => {
                    const opt = document.createElement('option');
                    opt.value = y.id;
                    opt.textContent = y.year_label + (y.is_current ? ' (Current)' : '');
                    sel.appendChild(opt);
                });
            });

            classSelectors.forEach(id => {
                const sel = document.getElementById(id);
                if (!sel) return;
                classes.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    opt.textContent = c.class_name;
                    opt.dataset.sections = c.sections || '';
                    sel.appendChild(opt);
                });
                
                // Add event listener to populate corresponding section dropdown
                sel.addEventListener('change', (e) => {
                    const selectedOpt = e.target.selectedOptions[0];
                    const sectionId = id === 'promoSrcClass' ? 'promoSrcSection' : 'promoTgtSection';
                    const sectionSelect = document.getElementById(sectionId);
                    if (sectionSelect) {
                        sectionSelect.innerHTML = '<option value="">Select section...</option>';
                        if (selectedOpt && selectedOpt.dataset.sections) {
                            const secs = selectedOpt.dataset.sections.split(',');
                            secs.forEach(s => {
                                const val = s.trim();
                                if(val) sectionSelect.innerHTML += `<option value="${val}">${val}</option>`;
                            });
                        }
                    }
                });
                sel.dispatchEvent(new Event('change'));
            });

            dropdownsLoaded = true;
        } catch (e) {
            showAlert('Failed to load dropdown data: ' + e.message);
        }
    }

    // ── Step 1 → Preview ──────────────────────────────────────────────

    document.getElementById('btnPromoPreview')?.addEventListener('click', async () => {
        const srcYearId  = document.getElementById('promoSrcYear').value;
        const srcClassId = document.getElementById('promoSrcClass').value;
        const srcSection = document.getElementById('promoSrcSection').value.trim().toUpperCase();
        const tgtYearId  = document.getElementById('promoTgtYear').value;
        const tgtClassId = document.getElementById('promoTgtClass').value;
        const tgtSection = document.getElementById('promoTgtSection').value.trim().toUpperCase();

        if (!srcYearId || !srcClassId || !srcSection) {
            showAlert('Please complete all Source fields.', 'warning'); return;
        }
        if (!tgtYearId || !tgtClassId || !tgtSection) {
            showAlert('Please complete all Target fields.', 'warning'); return;
        }

        showAlert('');
        try {
            // Fetch enrollments for the source class/section/year using the search endpoint
            const res = await apiClient.fetch(
                `/students/search?academic_year_id=${srcYearId}&class_level_id=${srcClassId}&section=${srcSection}&limit=200`
            );
            const students = res.items || [];
            if (!students || students.length === 0) {
                showAlert('No students found in the selected source class/section/year.', 'warning');
                return;
            }
            previewStudents = students;
            renderPreview(students, srcClassId, srcSection);
            showStep(2);
        } catch (err) {
            showAlert('Failed to load students: ' + err.message);
        }
    });

    function renderPreview(students, classId, section) {
        // Build label from dropdown text
        const classEl = document.getElementById('promoSrcClass');
        const className = classEl?.options[classEl.selectedIndex]?.text || '';
        document.getElementById('promoPreviewLabel').textContent = `${className} ${section} — ${students.length} student(s)`;

        const body = document.getElementById('promoStudentBody');
        body.innerHTML = students.map(s => `
            <tr>
                <td class="text-center">
                    <input type="checkbox" class="promo-row-check form-check-input" value="${s.admission_number}" checked>
                </td>
                <td>${s.roll_number || '—'}</td>
                <td><code>${s.admission_number}</code></td>
                <td>${s.student_name}</td>
            </tr>`).join('');

        body.querySelectorAll('.promo-row-check').forEach(cb => {
            cb.addEventListener('change', updateSelectedCount);
        });

        // Select All toggle
        const selectAll = document.getElementById('promoSelectAll');
        if (selectAll) {
            selectAll.checked = true;
            selectAll.addEventListener('change', e => {
                document.querySelectorAll('.promo-row-check').forEach(cb => {
                    cb.checked = e.target.checked;
                });
                updateSelectedCount();
            });
        }

        updateSelectedCount();
    }

    document.getElementById('btnPromoBack')?.addEventListener('click', () => showStep(1));

    // ── Step 2 → Confirm ──────────────────────────────────────────────

    document.getElementById('btnPromoConfirm')?.addEventListener('click', async () => {
        const srcYearId  = document.getElementById('promoSrcYear').value;
        const srcClassId = document.getElementById('promoSrcClass').value;
        const srcSection = document.getElementById('promoSrcSection').value.trim().toUpperCase();
        const tgtYearId  = document.getElementById('promoTgtYear').value;
        const tgtClassId = document.getElementById('promoTgtClass').value;
        const tgtSection = document.getElementById('promoTgtSection').value.trim().toUpperCase();
        const rollMode   = document.querySelector('input[name="promoRollMode"]:checked')?.value || 'keep';

        // Build exclusion list from unchecked rows
        const unchecked = [...document.querySelectorAll('.promo-row-check:not(:checked)')]
            .map(cb => cb.value);

        const payload = {
            source_year_id:        parseInt(srcYearId),
            source_class_level_id: parseInt(srcClassId),
            source_section:        srcSection,
            target_year_id:        parseInt(tgtYearId),
            target_class_level_id: parseInt(tgtClassId),
            target_section:        tgtSection,
            roll_number_mode:      rollMode,
            exclude_admission_numbers: unchecked,
        };

        try {
            const result = await apiClient.fetch('/students/promote', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            renderResult(result);
            showStep(3);
        } catch (err) {
            showAlert('Promotion failed: ' + err.message);
        }
    });

    function renderResult(result) {
        const s = result.summary;
        const modeLabel = { keep: 'Kept existing', clear: 'Cleared', auto: 'Auto-generated' }[result.roll_number_mode] || result.roll_number_mode;

        document.getElementById('promoResultSummary').innerHTML = `
            <div class="alert alert-success">
                <h5 class="fw-bold mb-2"><i class="bi bi-check-circle me-2"></i>Promotion Complete</h5>
                <ul class="mb-0">
                    <li><strong>${s.promoted}</strong> students promoted successfully</li>
                    <li>Roll numbers: <strong>${modeLabel}</strong></li>
                    ${s.skipped_already_enrolled ? `<li class="text-info">${s.skipped_already_enrolled} already enrolled in target year — skipped</li>` : ''}
                    ${s.skipped_excluded ? `<li class="text-muted">${s.skipped_excluded} excluded by admin</li>` : ''}
                </ul>
            </div>`;
    }

    document.getElementById('btnPromoReset')?.addEventListener('click', () => {
        previewStudents = [];
        showStep(1);
    });

    // ── Observe view show → load dropdowns ────────────────────────────
    const obs = new MutationObserver(mutations => {
        mutations.forEach(m => {
            if (m.attributeName === 'class' && !viewEl.classList.contains('hidden')) {
                loadDropdowns();
            }
        });
    });
    obs.observe(viewEl, { attributes: true });
    if (!viewEl.classList.contains('hidden')) loadDropdowns();
});
