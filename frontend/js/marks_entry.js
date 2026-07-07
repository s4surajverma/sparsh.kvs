/**
 * SPARSH - Marks Entry Module
 *
 * Provides a grid for manually entering raw marks.
 * Supports 'By Subject' (single column) and 'Spreadsheet' (multi-column) views.
 */

document.addEventListener('DOMContentLoaded', async () => {
    const viewMarks = document.getElementById('view-marks-entry');
    if (!viewMarks) return;

    // --- State ---
    let currentYearId = null;
    let loadedData = null; 
    let currentMode = 'subject'; // 'subject' or 'spreadsheet'
    let activeSubjectId = null;
    let unsavedChanges = false;
    
    // Model to persist data across tab switches and UI re-renders
    // marksModel[admission_number][subject_id] = marks_value
    let marksModel = {}; 
    let maxMarksModel = {}; // subjectId -> max_marks value

    // --- DOM Elements ---
    const marksClass = document.getElementById('marksClass');
    const marksExam = document.getElementById('marksExam');
    const gridContainer = document.getElementById('marksGridContainer');
    const thead = document.getElementById('marksTableHead');
    const tbody = document.getElementById('marksTableBody');
    const modeRadios = document.querySelectorAll('input[name="entryMode"]');
    const tabsContainer = document.getElementById('subjectTabsContainer');
    const progressInfo = document.getElementById('marksProgressInfo');

    // --- Helpers ---
    function showMarksAlert(msg, type = 'danger') {
        const el = document.getElementById('marksAlertArea');
        if (!msg) { el.innerHTML = ''; return; }
        el.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show">
            ${msg}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>`;
    }

    // --- Unsaved Changes Handling ---
    window.addEventListener('beforeunload', (e) => {
        if (unsavedChanges) {
            e.preventDefault();
            e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
            return e.returnValue;
        }
    });

    // --- Initialize Dropdowns ---
    async function initMarksData() {
        try {
            const years = await apiClient.fetch('/academic/years');
            const current = years.find(y => y.is_current);
            if (current) {
                document.getElementById('marksYearDisplay').value = `${current.year_label} (Current)`;
                currentYearId = current.id;
            } else {
                document.getElementById('marksYearDisplay').value = 'No active year configured';
            }

            const classes = await apiClient.fetch('/academic/classes');
            marksClass.innerHTML = '';
            classes.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.class_name;
                marksClass.appendChild(opt);
            });

            const exams = await apiClient.fetch('/academic/exams');
            marksExam.innerHTML = '';
            exams.forEach(e => {
                const opt = document.createElement('option');
                opt.value = e.id;
                opt.textContent = e.exam_name;
                marksExam.appendChild(opt);
            });

        } catch (err) {
            showMarksAlert('Failed to load system data: ' + err.message);
        }
    }

    initMarksData();

    // --- Mode Toggle Logic ---
    modeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            currentMode = e.target.value;
            if (loadedData) {
                renderGrid(loadedData);
            }
        });
    });

    // ============================================
    // Load Students
    // ============================================
    document.getElementById('marksLoadForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        if (unsavedChanges) {
            if (!confirm('You have unsaved marks. If you load a new class, those changes will be lost. Continue?')) {
                return;
            }
        }

        if (!currentYearId) {
            showMarksAlert('No active academic year is configured.');
            return;
        }

        const section = document.getElementById('marksSection').value.trim();
        if (!section) {
            showMarksAlert('Please enter a section.', 'warning');
            return;
        }

        const btn = document.getElementById('btnLoadStudents');
        btn.disabled = true;
        btn.textContent = 'Loading...';
        showMarksAlert('');
        gridContainer.classList.add('hidden');
        document.getElementById('marksSaveResult').classList.add('hidden');

        try {
            const classId = marksClass.value;
            const examId = marksExam.value;

            const data = await apiClient.fetch(
                `/marks/load?class_level_id=${classId}&section=${encodeURIComponent(section)}&exam_id=${examId}`
            );

            loadedData = data;
            unsavedChanges = false;
            
            // Initialize Models
            marksModel = {};
            maxMarksModel = {};
            data.subjects.forEach(sub => {
                maxMarksModel[sub.id] = '';
                // Attempt to find existing max marks
                for (const student of data.students) {
                    const res = student.results.find(r => r.subject_id === sub.id);
                    if (res && res.max_marks !== null && res.max_marks !== undefined) {
                        maxMarksModel[sub.id] = res.max_marks;
                        break;
                    }
                }
            });

            data.students.forEach(student => {
                marksModel[student.admission_number] = {};
                student.results.forEach(r => {
                    marksModel[student.admission_number][r.subject_id] = (r.marks_obtained !== null && r.marks_obtained !== undefined) ? r.marks_obtained : '';
                });
            });

            if (data.subjects.length > 0) {
                activeSubjectId = data.subjects[0].id;
            }

            renderGrid(data);
            gridContainer.classList.remove('hidden');

            document.getElementById('marksGridInfo').textContent =
                `${data.class_name} - ${data.section} | ${data.students.length} Students`;
            document.getElementById('marksGridExamInfo').textContent =
                `Exam: ${data.exam_name} | Year: ${data.academic_year_label}`;

        } catch (err) {
            showMarksAlert(err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Load Students';
        }
    });

    // ============================================
    // Render Grid
    // ============================================
    function renderGrid(data) {
        if (!data || data.subjects.length === 0) return;

        const subjects = data.subjects;
        const students = data.students;

        // Render Tabs
        if (currentMode === 'subject') {
            tabsContainer.classList.remove('hidden');
            progressInfo.classList.remove('hidden');
            let tabsHtml = '';
            subjects.forEach(sub => {
                const isActive = sub.id === activeSubjectId ? 'active' : '';
                tabsHtml += `<div class="subject-tab ${isActive}" data-subject-id="${sub.id}">${sub.subject_name}</div>`;
            });
            tabsContainer.innerHTML = tabsHtml;
            
            // Tab click events
            tabsContainer.querySelectorAll('.subject-tab').forEach(tab => {
                tab.addEventListener('click', (e) => {
                    activeSubjectId = parseInt(e.target.dataset.subjectId);
                    renderGrid(data); // Re-render table for the new subject
                });
            });
        } else {
            tabsContainer.classList.add('hidden');
            progressInfo.classList.add('hidden');
        }

        const visibleSubjects = currentMode === 'subject' 
            ? subjects.filter(s => s.id === activeSubjectId) 
            : subjects;

        // --- Build Header Row ---
        let headerHtml = '<tr>';
        headerHtml += '<th class="col-roll" style="position: sticky; left: 0; z-index: 3; background: #f8f9fa; min-width: 60px;">Roll</th>';
        headerHtml += '<th class="col-name" style="position: sticky; z-index: 3; background: #f8f9fa; min-width: 180px;">Student Name</th>';

        visibleSubjects.forEach(sub => {
            headerHtml += `<th class="text-center" style="min-width: 100px;">${sub.subject_name}</th>`;
        });
        headerHtml += '</tr>';

        // --- Build Max Marks Row ---
        let maxMarksHtml = '<tr class="table-warning">';
        maxMarksHtml += '<td class="col-roll" style="position: sticky; left: 0; z-index: 1; background: #fff3cd;" colspan="1"></td>';
        maxMarksHtml += '<td class="col-name fw-bold text-end" style="position: sticky; z-index: 1; background: #fff3cd;">Max Marks &rarr;</td>';

        visibleSubjects.forEach(sub => {
            const val = maxMarksModel[sub.id] !== undefined ? maxMarksModel[sub.id] : '';
            maxMarksHtml += `<td class="text-center">
                <input type="number" class="form-control form-control-sm text-center max-marks-input"
                    data-subject-id="${sub.id}"
                    value="${val}"
                    min="0" max="999" step="any"
                    placeholder="—"
                    style="width: 80px; margin: 0 auto;">
            </td>`;
        });
        maxMarksHtml += '</tr>';

        thead.innerHTML = headerHtml + maxMarksHtml;

        // --- Build Student Rows ---
        let bodyHtml = '';
        students.forEach((student) => {
            bodyHtml += `<tr data-admission="${student.admission_number}">`;
            bodyHtml += `<td class="col-roll fw-bold text-center" style="position: sticky; left: 0; z-index: 1; background: #fff;">${student.roll_number}</td>`;
            bodyHtml += `<td class="col-name" style="position: sticky; z-index: 1; background: #fff;">
                <span class="fw-bold">${student.student_name}</span>
                <br><small class="text-muted">${student.admission_number}</small>
            </td>`;

            visibleSubjects.forEach(sub => {
                const val = (marksModel[student.admission_number] && marksModel[student.admission_number][sub.id] !== undefined) 
                            ? marksModel[student.admission_number][sub.id] : '';
                bodyHtml += `<td class="text-center p-1">
                    <input type="number" class="form-control form-control-sm text-center marks-input"
                        data-admission="${student.admission_number}"
                        data-subject-id="${sub.id}"
                        value="${val}"
                        min="0" max="999" step="any"
                        placeholder="—"
                        style="width: 80px; margin: 0 auto;">
                </td>`;
            });
            bodyHtml += '</tr>';
        });

        tbody.innerHTML = bodyHtml;

        // Determine Name column sticky offset dynamically
        setTimeout(() => {
            const rollHeaders = document.querySelectorAll('.col-roll');
            const nameHeaders = document.querySelectorAll('.col-name');
            if (rollHeaders.length > 0 && nameHeaders.length > 0) {
                const rollWidth = rollHeaders[0].getBoundingClientRect().width;
                nameHeaders.forEach(el => {
                    el.style.left = `${rollWidth}px`;
                });
            }
        }, 0);

        setupEventListeners();
        updateProgress();
    }

    // ============================================
    // Logic: Progress & Validation
    // ============================================
    function updateProgress() {
        if (currentMode !== 'subject' || !activeSubjectId || !loadedData) return;
        let enteredCount = 0;
        let totalCount = loadedData.students.length;

        loadedData.students.forEach(student => {
            const val = marksModel[student.admission_number]?.[activeSubjectId];
            // Valid if non-empty, and >= 0
            if (val !== '' && val !== undefined && val !== null && parseFloat(val) >= 0) {
                enteredCount++;
            }
        });
        progressInfo.textContent = `Marks entered: ${enteredCount}/${totalCount}`;
    }

    function validateInput(input) {
        if (input.classList.contains('max-marks-input')) return; // handled separately

        const val = input.value.trim();
        const subjectId = parseInt(input.dataset.subjectId);
        
        // Block negative numbers
        if (val !== '' && parseFloat(val) < 0) {
            input.value = '0';
        }

        const maxMarks = parseFloat(maxMarksModel[subjectId]);
        const currentVal = parseFloat(input.value);

        if (!isNaN(currentVal) && !isNaN(maxMarks) && currentVal > maxMarks) {
            input.classList.add('mark-warning');
        } else {
            input.classList.remove('mark-warning');
        }
    }

    function setupEventListeners() {
        const table = document.getElementById('marksTable');
        
        // Input Syncing & Validation
        table.querySelectorAll('input').forEach(input => {
            // Live validation and state sync on input
            input.addEventListener('input', (e) => {
                unsavedChanges = true;
                const target = e.target;
                const subjectId = parseInt(target.dataset.subjectId);
                const val = target.value;

                if (target.classList.contains('max-marks-input')) {
                    maxMarksModel[subjectId] = val;
                    // Revalidate all inputs in this subject
                    table.querySelectorAll(`.marks-input[data-subject-id="${subjectId}"]`).forEach(validateInput);
                } else {
                    const admNo = target.dataset.admission;
                    if (!marksModel[admNo]) marksModel[admNo] = {};
                    
                    // Prevent non-numeric chars (though type="number" helps, manual typing can sneak things in)
                    if (val !== '' && parseFloat(val) < 0) {
                        target.value = 0;
                        marksModel[admNo][subjectId] = '0';
                    } else {
                        marksModel[admNo][subjectId] = val;
                    }
                    
                    validateInput(target);
                    updateProgress();
                }
            });

            // Trigger initial validation
            validateInput(input);
        });

        // Hover & Focus Highlighting
        table.addEventListener('mouseover', handleHighlight);
        table.addEventListener('mouseout', removeHighlight);
        table.addEventListener('focusin', handleHighlight);
        table.addEventListener('focusout', removeHighlight);

        function handleHighlight(e) {
            let target = e.target;
            // For focusin, the target is the input. We want to highlight based on the TD.
            if (target.tagName === 'INPUT') {
                target = target.closest('td');
            }
            if (!target || target.tagName !== 'TD') return;
            
            removeHighlight(); // clear previous
            
            const tr = target.closest('tr');
            if (tr) {
                tr.querySelectorAll('td').forEach(td => td.classList.add('marks-cell-active'));
            }
            
            const cellIndex = Array.from(tr.cells).indexOf(target);
            if (cellIndex >= 0) {
                const headerCell = thead.querySelectorAll('tr:first-child th')[cellIndex];
                if (headerCell) headerCell.classList.add('marks-header-active');
            }
            
            // Auto-select text on focusin
            if (e.type === 'focusin' && e.target.tagName === 'INPUT') {
                e.target.select();
            }
        }

        function removeHighlight() {
            table.querySelectorAll('.marks-cell-active').forEach(el => el.classList.remove('marks-cell-active'));
            table.querySelectorAll('.marks-header-active').forEach(el => el.classList.remove('marks-header-active'));
        }

        // Keyboard Navigation (Arrow keys / Enter / Tab)
        table.addEventListener('keydown', (e) => {
            const target = e.target;
            if (!target.classList.contains('marks-input') && !target.classList.contains('max-marks-input')) return;

            const cell = target.closest('td');
            const row = cell.closest('tr');
            const cellIndex = Array.from(row.cells).indexOf(cell);

            let targetInput = null;

            if (e.key === 'Enter' || e.key === 'ArrowDown') {
                e.preventDefault();
                const nextRow = row.nextElementSibling;
                if (nextRow) {
                    targetInput = nextRow.cells[cellIndex]?.querySelector('input');
                } else if (currentMode === 'subject') {
                    // Reached the bottom in By Subject mode. Advance to next subject.
                    autoAdvanceSubject();
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const prevRow = row.previousElementSibling;
                if (prevRow) {
                    targetInput = prevRow.cells[cellIndex]?.querySelector('input');
                }
            } else if (e.key === 'ArrowRight' && target.selectionStart === target.value.length) {
                e.preventDefault();
                const nextCell = cell.nextElementSibling;
                if (nextCell) {
                    targetInput = nextCell.querySelector('input');
                }
            } else if (e.key === 'ArrowLeft' && target.selectionStart === 0) {
                e.preventDefault();
                const prevCell = cell.previousElementSibling;
                if (prevCell) {
                    targetInput = prevCell.querySelector('input');
                }
            }

            if (targetInput) {
                targetInput.focus();
            }
        });
    }

    function autoAdvanceSubject() {
        if (!loadedData || !activeSubjectId) return;
        const subjects = loadedData.subjects;
        const currentIndex = subjects.findIndex(s => s.id === activeSubjectId);
        
        if (currentIndex >= 0 && currentIndex < subjects.length - 1) {
            activeSubjectId = subjects[currentIndex + 1].id;
            renderGrid(loadedData);
            
            // Focus first input of the new subject
            setTimeout(() => {
                const firstInput = document.querySelector('.marks-input');
                if (firstInput) firstInput.focus();
            }, 50);
        }
    }

    // ============================================
    // Clear All Marks
    // ============================================
    document.getElementById('btnClearGrid').addEventListener('click', () => {
        if (!confirm('Clear all entered marks? This will not delete saved data — only clears the form.')) return;
        
        unsavedChanges = true;
        // Clear models
        for (let adm in marksModel) {
            for (let sub in marksModel[adm]) {
                marksModel[adm][sub] = '';
            }
        }
        for (let sub in maxMarksModel) {
            maxMarksModel[sub] = '';
        }

        renderGrid(loadedData);
    });

    // ============================================
    // Save All Marks
    // ============================================
    document.getElementById('btnSaveMarks').addEventListener('click', async () => {
        if (!loadedData) return;

        const btn = document.getElementById('btnSaveMarks');
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Saving...`;
        showMarksAlert('');
        document.getElementById('marksSaveResult').classList.add('hidden');

        try {
            // Rebuild maxMarks array
            const maxMarks = [];
            for (const subId in maxMarksModel) {
                const val = maxMarksModel[subId];
                if (val !== '' && val !== null) {
                    maxMarks.push({
                        subject_id: parseInt(subId),
                        max_marks: parseFloat(val)
                    });
                }
            }

            // Rebuild entries payload
            const entries = [];
            for (const admNo in marksModel) {
                const results = [];
                for (const subId in marksModel[admNo]) {
                    const val = marksModel[admNo][subId];
                    if (val !== '' && val !== null) {
                        results.push({
                            subject_id: parseInt(subId),
                            marks_obtained: parseFloat(val),
                            grade: null
                        });
                    }
                }
                if (results.length > 0) {
                    entries.push({
                        admission_number: admNo,
                        results: results
                    });
                }
            }

            if (entries.length === 0 && maxMarks.length === 0) {
                showMarksAlert('No marks entered to save.', 'warning');
                return;
            }

            const payload = {
                class_level_id: parseInt(marksClass.value),
                section: document.getElementById('marksSection').value.trim(),
                exam_id: parseInt(marksExam.value),
                max_marks: maxMarks,
                entries: entries,
            };

            const response = await apiClient.fetch('/marks/save', {
                method: 'POST',
                body: JSON.stringify(payload),
            });

            unsavedChanges = false;
            
            // Show success
            const resultArea = document.getElementById('marksSaveResult');
            resultArea.classList.remove('hidden');
            resultArea.innerHTML = `
                <div class="alert alert-success d-flex align-items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" class="bi bi-check-circle-fill me-2 flex-shrink-0" viewBox="0 0 16 16">
                        <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/>
                    </svg>
                    <div>
                        <strong>Marks saved successfully!</strong>
                        <span class="ms-2">${response.saved_count} result(s) saved</span>
                        <span class="ms-1 text-muted">(${response.created_count} new, ${response.updated_count} updated)</span>
                        ${response.errors && response.errors.length > 0 ? `<br><small class="text-danger">${response.errors.length} error(s): ${response.errors.join('; ')}</small>` : ''}
                    </div>
                </div>
            `;

            // Flash success
            document.querySelectorAll('.marks-input').forEach(input => {
                if (input.value.trim() !== '') {
                    input.style.transition = 'background-color 0.3s ease';
                    input.style.backgroundColor = '#d4edda';
                    setTimeout(() => input.style.backgroundColor = '', 1500);
                }
            });

        } catch (err) {
            showMarksAlert('Failed to save marks: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" class="bi bi-check2-circle me-1" viewBox="0 0 16 16"><path d="M2.5 8a5.5 5.5 0 0 1 8.25-4.764.5.5 0 0 0 .5-.866A6.5 6.5 0 1 0 14.5 8a.5.5 0 0 0-1 0 5.5 5.5 0 1 1-11 0z"/><path d="M15.354 3.354a.5.5 0 0 0-.708-.708L8 9.293 5.354 6.646a.5.5 0 1 0-.708.708l3 3a.5.5 0 0 0 .708 0l7-7z"/></svg> Save All Marks`;
        }
    });
});
