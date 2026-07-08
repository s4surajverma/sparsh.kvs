/**
 * SPARSH - Smart Excel Import Workflow
 *
 * 6-Step guided import:
 * 1. Upload Workbook (academic year auto-selected)
 * 2. Worksheet Selection (if multiple sheets)
 * 3. Smart Preview (detections, badges, data table)
 * 4. Pre-Commit Summary
 * 5. Import Complete
 */

document.addEventListener('DOMContentLoaded', async () => {
    const viewImport = document.getElementById('view-import');
    if (!viewImport) return;

    // --- State ---
    let uploadedFile = null;       // The raw File object
    let uploadedFileBytes = null;  // ArrayBuffer kept for re-sends
    let selectedSheet = null;
    let analysisResult = null;     // SmartAnalysisResponse from backend
    let systemSubjects = [];
    let currentYearId = null;

    // --- Step Elements ---
    const step1 = document.getElementById('importStep1');
    const step2 = document.getElementById('importStep2');
    const step3 = document.getElementById('importStep3');
    const step4 = document.getElementById('importStep4');
    const step5 = document.getElementById('importStep5');
    const step6 = document.getElementById('importStep6');

    const importClass = document.getElementById('importClass');
    const importExam = document.getElementById('importExam');

    // --- Helpers ---
    function showAlert(msg, type = 'danger') {
        const el = document.getElementById('importAlertArea');
        if (!msg) { el.innerHTML = ''; return; }
        el.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show">
            ${msg}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>`;
    }

    function showStep(stepEl) {
        [step1, step2, step3, step4, step5, step6].forEach(s => s.classList.add('hidden'));
        stepEl.classList.remove('hidden');
        showAlert('');
    }

    // --- Initialize Data ---
    async function initImportData() {
        try {
            // Academic Year: read-only, current year only
            const years = await apiClient.fetch('/academic/years');
            const current = years.find(y => y.is_current);
            if (current) {
                document.getElementById('importYearDisplay').value = `${current.year_label} (Current)`;
                document.getElementById('importYearId').value = current.id;
                currentYearId = current.id;
            } else {
                document.getElementById('importYearDisplay').value = 'No active year configured';
            }

            // Classes
            const classes = await apiClient.fetch('/academic/classes');
            importClass.innerHTML = '';
            classes.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.class_name;
                opt.dataset.sections = c.sections || '';
                importClass.appendChild(opt);
            });

            importClass.addEventListener('change', (e) => {
                const selectedOpt = e.target.selectedOptions[0];
                const sectionSelect = document.getElementById('importSection');
                sectionSelect.innerHTML = '<option value="">Select section...</option>';
                if (selectedOpt) {
                    const sectionsStr = selectedOpt.dataset.sections && selectedOpt.dataset.sections.trim() ? selectedOpt.dataset.sections : 'A,B,C,D,E,F,G,H';
                    sectionsStr.split(',').forEach(s => {
                        const val = s.trim();
                        if(val) sectionSelect.innerHTML += `<option value="${val}">${val}</option>`;
                    });
                }
            });
            importClass.dispatchEvent(new Event('change'));

            // Exams
            const exams = await apiClient.fetch('/academic/exams');
            importExam.innerHTML = '';
            exams.forEach(e => {
                const opt = document.createElement('option');
                opt.value = e.id;
                opt.textContent = e.exam_name;
                importExam.appendChild(opt);
            });

            // Subjects (for advanced mapping dropdowns)
            systemSubjects = await apiClient.fetch('/academic/subjects');

        } catch (err) {
            showAlert('Failed to load system data: ' + err.message);
        }
    }

    initImportData();

    // ============================================
    // STEP 1: Upload & Analyze
    // ============================================

    document.getElementById('importForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!currentYearId) {
            showAlert('No active academic year is configured. Please ask the administrator to set one.');
            return;
        }

        const fileInput = document.getElementById('importFile');
        if (!fileInput.files[0]) {
            showAlert('Please select a file.', 'warning');
            return;
        }

        uploadedFile = fileInput.files[0];
        const btn = document.getElementById('btnUploadAnalyze');
        btn.disabled = true;
        btn.textContent = 'Analyzing...';
        showAlert('');

        try {
            // Step 1a: Detect worksheets
            const formData = new FormData();
            formData.append('file', uploadedFile);

            const token = apiClient.getToken();
            const wsResponse = await fetch('/api/v1/results/worksheets', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
            });

            const wsData = await wsResponse.json();
            if (!wsResponse.ok) throw new Error(wsData.detail || 'Failed to read workbook.');

            const sheets = wsData.sheets;

            if (sheets.length === 0) {
                throw new Error('The workbook contains no worksheets.');
            } else if (sheets.length === 1) {
                // Skip step 2, go directly to analysis
                selectedSheet = sheets[0];
                await runAnalysis();
            } else {
                // Multiple sheets: show step 2
                renderWorksheetSelection(sheets);
                showStep(step2);
            }

        } catch (err) {
            showAlert(err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Upload & Analyze';
        }
    });


    // ============================================
    // STEP 2: Worksheet Selection
    // ============================================

    function renderWorksheetSelection(sheets) {
        const container = document.getElementById('worksheetRadios');
        container.innerHTML = '';
        sheets.forEach((name, idx) => {
            const id = `wsRadio${idx}`;
            container.innerHTML += `
                <div class="form-check mb-2">
                    <input class="form-check-input" type="radio" name="worksheetRadio" id="${id}" value="${name}" ${idx === 0 ? 'checked' : ''}>
                    <label class="form-check-label" for="${id}">${name}</label>
                </div>
            `;
        });
    }

    document.getElementById('btnBackToStep1').addEventListener('click', () => showStep(step1));

    document.getElementById('btnAnalyzeSheet').addEventListener('click', async () => {
        const selected = document.querySelector('input[name="worksheetRadio"]:checked');
        if (!selected) {
            showAlert('Please select a worksheet.', 'warning');
            return;
        }
        selectedSheet = selected.value;

        const btn = document.getElementById('btnAnalyzeSheet');
        btn.disabled = true;
        btn.textContent = 'Analyzing...';

        try {
            await runAnalysis();
        } catch (err) {
            showAlert(err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Analyze Selected Sheet';
        }
    });


    // ============================================
    // Smart Analysis Call
    // ============================================

    async function runAnalysis(headerRowOverride) {
        const formData = new FormData();
        formData.append('file', uploadedFile);
        formData.append('sheet_name', selectedSheet);
        formData.append('class_level_id', importClass.value);
        formData.append('section', document.getElementById('importSection').value.trim());
        formData.append('exam_id', importExam.value);

        if (headerRowOverride !== undefined && headerRowOverride !== null) {
            formData.append('header_row', headerRowOverride);
        }

        const token = apiClient.getToken();
        const response = await fetch('/api/v1/results/analyze', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData,
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'Analysis failed.');

        analysisResult = data;
        renderSmartPreview(data);
        showStep(step3);
    }


    // ============================================
    // STEP 3: Smart Preview Rendering
    // ============================================

    function renderSmartPreview(data) {
        // --- Auto-template match banner ---
        const matchBanner = document.getElementById('autoTemplateMatch');
        if (data.matched_template_name) {
            matchBanner.classList.remove('hidden');
        } else {
            matchBanner.classList.add('hidden');
        }

        // --- Detection Checklist ---
        renderCheckItem('chkRoll', 'Roll Number', data.detected_roll_column);
        renderCheckItem('chkName', 'Student Name', data.detected_name_column);
        renderCheckItemAdmission('chkAdmission', data.detected_admission_column);

        // --- Header Row ---
        document.getElementById('detectedHeaderRow').textContent = data.detected_header_row + 1; // Display 1-indexed
        document.getElementById('headerRowInput').value = data.detected_header_row;

        // --- Students Found ---
        document.getElementById('studentsFoundCount').textContent = data.total_rows;

        // --- Subject Badges ---
        const badgesContainer = document.getElementById('detectedSubjectsBadges');
        const noSubjectsWarning = document.getElementById('noSubjectsWarning');

        if (data.detected_subjects.length === 0) {
            badgesContainer.innerHTML = '';
            noSubjectsWarning.classList.remove('hidden');
        } else {
            noSubjectsWarning.classList.add('hidden');
            badgesContainer.innerHTML = data.detected_subjects.map(s => {
                const color = s.confidence === 'high' ? 'success' : 'warning';
                const label = s.confidence === 'high' ? 'High Confidence' : 'Medium Confidence';
                return `<span class="badge bg-${color} me-2 mb-2 fs-6" title="${label}">
                    ${s.confidence === 'high' ? '✓' : '⚠'} ${s.subject_name}
                    <small class="ms-1 opacity-75">(${label})</small>
                </span>`;
            }).join('');
        }

        // --- Detected Max Marks ---
        const maxMarksContainer = document.getElementById('detectedMaxMarksList');
        if (data.detected_max_marks && Object.keys(data.detected_max_marks).length > 0) {
            maxMarksContainer.innerHTML = Object.entries(data.detected_max_marks).map(([subject, maxMark]) => {
                // If subject was mapped to a formal name, we could display that, but we only have excel_column here.
                // It's fine to show excel_column for extraction verification.
                return `<div class="mb-1"><span class="fw-bold">${subject}</span> &rarr; ${maxMark}</div>`;
            }).join('');
        } else {
            maxMarksContainer.innerHTML = '<span class="text-muted fst-italic">No maximum marks detected.</span>';
        }

        // --- Data Preview Table ---
        renderPreviewTable(data);

        // --- Advanced Mapping Overrides ---
        renderAdvancedMapping(data);
    }

    function renderCheckItem(elementId, label, detectedCol) {
        const el = document.getElementById(elementId);
        if (detectedCol) {
            el.innerHTML = `<span class="text-success fw-bold">✓</span> ${label} detected <small class="text-muted">(Column: "${detectedCol}")</small>`;
        } else {
            el.innerHTML = `<span class="text-danger fw-bold">✗</span> ${label} <span class="text-muted">not detected</span>`;
        }
    }

    function renderCheckItemAdmission(elementId, detectedCol) {
        const el = document.getElementById(elementId);
        if (detectedCol) {
            el.innerHTML = `<span class="text-success fw-bold">✓</span> Admission Number detected <small class="text-muted">(Column: "${detectedCol}")</small>`;
        } else {
            el.innerHTML = `<span class="text-warning fw-bold">⚠</span> Admission Number <span class="text-muted">not found</span>
                <br><small class="text-muted ms-3">SPARSH can still import results. Students will be linked manually where required.</small>`;
        }
    }

    function renderPreviewTable(data) {
        const thead = document.getElementById('previewTableHead');
        const tbody = document.getElementById('previewTableBody');

        if (!data.sample_rows || data.sample_rows.length === 0) {
            thead.innerHTML = '';
            tbody.innerHTML = '<tr><td class="text-center text-muted">No data rows found.</td></tr>';
            return;
        }

        // Build headers from the clean header list
        const cols = data.headers_clean;
        thead.innerHTML = '<tr>' + cols.map(c => `<th class="small">${c}</th>`).join('') + '</tr>';

        // Build rows
        tbody.innerHTML = data.sample_rows.map(row => {
            return '<tr>' + cols.map(c => {
                const val = row[c];
                return `<td class="small">${val !== null && val !== undefined ? val : ''}</td>`;
            }).join('') + '</tr>';
        }).join('');
    }

    function renderAdvancedMapping(data) {
        const body = document.getElementById('advancedMappingBody');
        body.innerHTML = '';

        data.headers_clean.forEach(col => {
            const tr = document.createElement('tr');

            const tdCol = document.createElement('td');
            tdCol.textContent = col;

            const tdMap = document.createElement('td');
            const select = document.createElement('select');
            select.className = 'form-select form-select-sm adv-mapping-select';
            select.dataset.excelCol = col;

            select.innerHTML = '<option value="">-- Ignore --</option>';
            systemSubjects.forEach(sub => {
                select.innerHTML += `<option value="${sub.id}">${sub.subject_name}</option>`;
            });

            // Pre-select if auto-detected
            const detected = data.detected_subjects.find(s => s.excel_column === col);
            if (detected) {
                select.value = String(detected.subject_id);
            }

            tdMap.appendChild(select);
            tr.appendChild(tdCol);
            tr.appendChild(tdMap);
            body.appendChild(tr);
        });
    }


    // --- Header Row Override ---
    document.getElementById('btnChangeHeaderRow').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('headerRowOverride').classList.toggle('hidden');
    });

    document.getElementById('btnApplyHeaderRow').addEventListener('click', async () => {
        const newRow = parseInt(document.getElementById('headerRowInput').value);
        if (isNaN(newRow) || newRow < 0) {
            showAlert('Please enter a valid row number (0 or greater).', 'warning');
            return;
        }

        const btn = document.getElementById('btnApplyHeaderRow');
        btn.disabled = true;
        btn.textContent = 'Re-analyzing...';

        try {
            await runAnalysis(newRow);
        } catch (err) {
            showAlert(err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Apply';
        }
    });


    // ============================================
    // STEP 3 → STEP 4: Continue to Import
    // ============================================

    document.getElementById('btnBackFromStep3').addEventListener('click', () => {
        showStep(step1);
    });

    document.getElementById('btnContinueToImport').addEventListener('click', () => {
        if (!analysisResult) return;

        // Build the final column mappings from auto-detected + manual overrides
        const mappings = buildFinalMappings();

        if (mappings.length === 0) {
            showAlert('No subject columns are mapped. Please detect or manually map at least one subject.', 'warning');
            return;
        }

        // Fill summary cards
        const totalStudents = analysisResult.total_rows;
        const issues = analysisResult.issues || [];
        const issueCount = issues.length;

        document.getElementById('summaryTotalStudents').textContent = totalStudents;
        document.getElementById('summaryReadyToImport').textContent = totalStudents;
        document.getElementById('summaryNeedsAttention').textContent = issueCount;

        // Show issue rows if any
        const issueArea = document.getElementById('issueRowsArea');
        const issueBody = document.getElementById('issueRowsBody');
        if (issueCount > 0) {
            issueArea.classList.remove('hidden');
            issueBody.innerHTML = issues.map((issue, idx) => `
                <tr><td>${idx + 1}</td><td>${issue}</td></tr>
            `).join('');
        } else {
            issueArea.classList.add('hidden');
        }

        showStep(step4);
    });


    // ============================================
    // STEP 4: Import Results
    // ============================================

    document.getElementById('btnBackFromStep4').addEventListener('click', () => {
        showStep(step3);
    });

    document.getElementById('btnRunDryRun').addEventListener('click', async () => {
        const btn = document.getElementById('btnRunDryRun');
        btn.disabled = true;
        btn.textContent = 'Generating Summary...';

        try {
            const mappings = buildFinalMappings();

            const importConfig = {
                academic_year_id: currentYearId,
                class_level_id: parseInt(importClass.value),
                section: document.getElementById('importSection').value.trim(),
                exam_id: parseInt(importExam.value),
                sheet_name: selectedSheet,
                header_row: analysisResult.detected_header_row,
                admission_number_column: analysisResult.detected_admission_column,
                name_column: analysisResult.detected_name_column,
                roll_number_column: analysisResult.detected_roll_column,
                column_mappings: mappings,
                student_mappings: [],
                workbook_signature: analysisResult.workbook_signature,
                dry_run: true
            };

            const formData = new FormData();
            formData.append('file', uploadedFile);
            formData.append('import_config', JSON.stringify(importConfig));

            const token = apiClient.getToken();
            const response = await fetch('/api/v1/results/import', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
            });

            const resultData = await response.json();
            if (!response.ok) throw new Error(resultData.detail || 'Dry run failed.');

            // Process Warnings (any row with status 'ok' and a message containing '[Note:')
            let warningsCount = 0;
            let warningsHtml = '';
            
            resultData.row_details.forEach(r => {
                if (r.message && r.message.includes('[Note:')) {
                    warningsCount++;
                    // Extract just the notes
                    const notes = r.message.split('[Note:').slice(1).map(n => n.replace(']', '').trim());
                    const warningText = notes.join('<br>');
                    
                    warningsHtml += `
                        <tr>
                            <td>${r.row_number}</td>
                            <td>${r.admission_number || '-'}</td>
                            <td class="text-danger">${warningText}</td>
                        </tr>
                    `;
                }
            });

            // Populate Dry Run Step (Step 5)
            document.getElementById('dryRunStudentsCreated').textContent = resultData.students_created;
            document.getElementById('dryRunStudentsMatched').textContent = resultData.existing_students_matched;
            document.getElementById('dryRunEnrollmentsCreated').textContent = resultData.enrollments_created;
            document.getElementById('dryRunSkipped').textContent = resultData.skipped_rows;
            document.getElementById('dryRunResultsImported').textContent = resultData.imported_rows;
            document.getElementById('dryRunWarnings').textContent = warningsCount;

            const toggleBtn = document.getElementById('btnToggleWarnings');
            const warningsArea = document.getElementById('dryRunWarningsArea');
            const warningsBody = document.getElementById('dryRunWarningsBody');

            if (warningsCount > 0) {
                toggleBtn.classList.remove('hidden');
                warningsBody.innerHTML = warningsHtml;
                
                // Reset visibility state
                warningsArea.classList.add('hidden');
                toggleBtn.textContent = 'View Warnings';

                // Add toggle logic
                toggleBtn.onclick = () => {
                    if (warningsArea.classList.contains('hidden')) {
                        warningsArea.classList.remove('hidden');
                        toggleBtn.textContent = 'Hide Warnings';
                    } else {
                        warningsArea.classList.add('hidden');
                        toggleBtn.textContent = 'View Warnings';
                    }
                };
            } else {
                toggleBtn.classList.add('hidden');
                warningsArea.classList.add('hidden');
            }

            showStep(step5);

        } catch (err) {
            showAlert('Summary generation failed: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Review Import Summary';
        }
    });

    // ============================================
    // STEP 5: Confirm Import
    // ============================================

    document.getElementById('btnBackFromStep5').addEventListener('click', () => {
        showStep(step4);
    });

    document.getElementById('btnConfirmImport').addEventListener('click', async () => {
        const btn = document.getElementById('btnConfirmImport');
        btn.disabled = true;
        btn.textContent = 'Importing Data...';

        try {
            const mappings = buildFinalMappings();

            const importConfig = {
                academic_year_id: currentYearId,
                class_level_id: parseInt(importClass.value),
                section: document.getElementById('importSection').value.trim(),
                exam_id: parseInt(importExam.value),
                sheet_name: selectedSheet,
                header_row: analysisResult.detected_header_row,
                admission_number_column: analysisResult.detected_admission_column,
                name_column: analysisResult.detected_name_column,
                roll_number_column: analysisResult.detected_roll_column,
                column_mappings: mappings,
                student_mappings: [],
                workbook_signature: analysisResult.workbook_signature,
                dry_run: false
            };

            const formData = new FormData();
            formData.append('file', uploadedFile);
            formData.append('import_config', JSON.stringify(importConfig));

            const token = apiClient.getToken();
            const response = await fetch('/api/v1/results/import', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
            });

            const resultData = await response.json();
            if (!response.ok) throw new Error(resultData.detail || 'Import failed.');

            renderImportSummary(resultData);
            showStep(step6);

        } catch (err) {
            showAlert('Import failed: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Confirm & Import Data';
        }
    });


    // ============================================
    // STEP 5: Import Complete
    // ============================================

    document.getElementById('btnNewImport').addEventListener('click', () => {
        document.getElementById('importForm').reset();
        uploadedFile = null;
        selectedSheet = null;
        analysisResult = null;

        showStep(step1);
        initImportData();
    });


    // ============================================
    // Shared Logic
    // ============================================

    function buildFinalMappings() {
        // Check for manual overrides in Advanced section
        const advSelects = document.querySelectorAll('.adv-mapping-select');
        const mappings = [];

        advSelects.forEach(sel => {
            if (sel.value) {
                mappings.push({
                    excel_column: sel.dataset.excelCol,
                    subject_id: parseInt(sel.value),
                });
            }
        });

        // If no manual overrides were used (Advanced section untouched), use auto-detected
        if (mappings.length === 0 && analysisResult && analysisResult.detected_subjects.length > 0) {
            analysisResult.detected_subjects.forEach(s => {
                mappings.push({
                    excel_column: s.excel_column,
                    subject_id: s.subject_id,
                });
            });
        }

        return mappings;
    }

    function renderImportSummary(data) {
        const area = document.getElementById('importSummaryArea');
        let html = `
            <div class="row text-center mb-4">
                <div class="col-sm-4 mb-3"><div class="card bg-light p-3 border-success"><h3 class="text-success">${data.students_created}</h3><small>Students Created</small></div></div>
                <div class="col-sm-4 mb-3"><div class="card bg-light p-3 border-primary"><h3 class="text-primary">${data.existing_students_matched}</h3><small>Existing Students Matched</small></div></div>
                <div class="col-sm-4 mb-3"><div class="card bg-light p-3 border-info"><h3 class="text-info">${data.enrollments_created}</h3><small>Enrollments Created</small></div></div>
                <div class="col-sm-6 mb-3"><div class="card bg-light p-3 border-dark"><h3 class="text-dark">${data.imported_rows}</h3><small>Results Imported</small></div></div>
                <div class="col-sm-6 mb-3"><div class="card bg-light p-3 border-warning"><h3 class="text-warning">${data.skipped_rows}</h3><small>Rows Skipped</small></div></div>
            </div>
            <h5>Row Details Log</h5>
            <div class="table-responsive" style="max-height: 400px; overflow-y: auto;">
                <table class="table table-sm table-bordered">
                    <thead><tr><th>Row</th><th>Adm No</th><th>Name</th><th>Status</th><th>Message</th></tr></thead>
                    <tbody>
        `;

        data.row_details.forEach(r => {
            const statusClass = r.status === 'ok' ? 'text-success' : (r.status === 'skipped' ? 'text-warning' : 'text-danger');
            html += `
                <tr>
                    <td>${r.row_number}</td>
                    <td>${r.admission_number || '-'}</td>
                    <td>${r.student_name || '-'}</td>
                    <td class="${statusClass} fw-bold">${r.status.toUpperCase()}</td>
                    <td>${r.message}</td>
                </tr>
            `;
        });

        html += '</tbody></table></div>';
        area.innerHTML = html;
    }

    // ============================================
    // Template Download
    // ============================================
    document.getElementById('btnDownloadResultsTemplate')?.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            await apiClient.downloadFile('/templates/download/results', 'results_template.xlsx');
        } catch (err) {
            showAlert('Failed to download template: ' + err.message);
        }
    });
});
