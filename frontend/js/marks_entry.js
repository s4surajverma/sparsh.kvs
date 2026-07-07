/**
 * SPARSH - Marks Entry Module
 *
 * Provides a spreadsheet-like grid for manually entering raw marks.
 * Flow:
 * 1. Select Class, Section, Exam → Load Students
 * 2. Grid renders with students as rows, subjects as columns
 * 3. Max Marks row at top, marks input cells pre-filled with existing data
 * 4. Save All Marks → batch POST to /marks/save
 */

document.addEventListener('DOMContentLoaded', async () => {
    const viewMarks = document.getElementById('view-marks-entry');
    if (!viewMarks) return;

    // --- State ---
    let currentYearId = null;
    let loadedData = null; // MarksLoadResponse from backend

    // --- DOM Elements ---
    const marksClass = document.getElementById('marksClass');
    const marksExam = document.getElementById('marksExam');
    const gridContainer = document.getElementById('marksGridContainer');
    const thead = document.getElementById('marksTableHead');
    const tbody = document.getElementById('marksTableBody');

    // --- Helpers ---
    function showMarksAlert(msg, type = 'danger') {
        const el = document.getElementById('marksAlertArea');
        if (!msg) { el.innerHTML = ''; return; }
        el.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show">
            ${msg}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>`;
    }

    // --- Initialize Dropdowns ---
    async function initMarksData() {
        try {
            // Academic Year (read-only, current year)
            const years = await apiClient.fetch('/academic/years');
            const current = years.find(y => y.is_current);
            if (current) {
                document.getElementById('marksYearDisplay').value = `${current.year_label} (Current)`;
                currentYearId = current.id;
            } else {
                document.getElementById('marksYearDisplay').value = 'No active year configured';
            }

            // Classes
            const classes = await apiClient.fetch('/academic/classes');
            marksClass.innerHTML = '';
            classes.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.class_name;
                marksClass.appendChild(opt);
            });

            // Exams
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


    // ============================================
    // Load Students
    // ============================================

    document.getElementById('marksLoadForm').addEventListener('submit', async (e) => {
        e.preventDefault();

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
            renderGrid(data);
            gridContainer.classList.remove('hidden');

            // Update info badges
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
    // Render Spreadsheet Grid
    // ============================================

    function renderGrid(data) {
        const subjects = data.subjects;
        const students = data.students;

        // --- Build Header Row ---
        let headerHtml = '<tr>';
        headerHtml += '<th style="position: sticky; left: 0; z-index: 3; background: #f8f9fa; min-width: 60px;">Roll</th>';
        headerHtml += '<th style="position: sticky; left: 60px; z-index: 3; background: #f8f9fa; min-width: 180px;">Student Name</th>';

        subjects.forEach(sub => {
            headerHtml += `<th class="text-center" style="min-width: 100px;">${sub.subject_name}</th>`;
        });
        headerHtml += '</tr>';

        // --- Build Max Marks Row ---
        let maxMarksHtml = '<tr class="table-warning">';
        maxMarksHtml += '<td style="position: sticky; left: 0; z-index: 1; background: #fff3cd;" colspan="2" class="fw-bold text-end">Max Marks →</td>';

        subjects.forEach(sub => {
            // Try to get existing max marks from any student's result for this subject
            let existingMax = '';
            for (const student of students) {
                const result = student.results.find(r => r.subject_id === sub.id);
                if (result && result.max_marks !== null && result.max_marks !== undefined) {
                    existingMax = result.max_marks;
                    break;
                }
            }

            maxMarksHtml += `<td class="text-center">
                <input type="number" class="form-control form-control-sm text-center max-marks-input"
                    data-subject-id="${sub.id}"
                    value="${existingMax}"
                    min="0" max="999" step="any"
                    placeholder="—"
                    style="width: 80px; margin: 0 auto;">
            </td>`;
        });
        maxMarksHtml += '</tr>';

        thead.innerHTML = headerHtml + maxMarksHtml;

        // --- Build Student Rows ---
        let bodyHtml = '';
        students.forEach((student, idx) => {
            // Build results lookup for this student
            const resultsMap = {};
            student.results.forEach(r => {
                resultsMap[r.subject_id] = r;
            });

            bodyHtml += `<tr data-admission="${student.admission_number}" data-enrollment-id="${student.enrollment_id}">`;
            bodyHtml += `<td style="position: sticky; left: 0; z-index: 1; background: #fff;" class="fw-bold text-center">${student.roll_number}</td>`;
            bodyHtml += `<td style="position: sticky; left: 60px; z-index: 1; background: #fff;">
                <span class="fw-bold">${student.student_name}</span>
                <br><small class="text-muted">${student.admission_number}</small>
            </td>`;

            subjects.forEach(sub => {
                const existing = resultsMap[sub.id];
                const marksValue = existing && existing.marks_obtained !== null && existing.marks_obtained !== undefined
                    ? existing.marks_obtained : '';

                bodyHtml += `<td class="text-center p-1">
                    <input type="number" class="form-control form-control-sm text-center marks-input"
                        data-admission="${student.admission_number}"
                        data-subject-id="${sub.id}"
                        value="${marksValue}"
                        min="0" max="999" step="any"
                        placeholder="—"
                        style="width: 80px; margin: 0 auto;">
                </td>`;
            });

            bodyHtml += '</tr>';
        });

        tbody.innerHTML = bodyHtml;

        // --- Tab navigation between cells ---
        setupGridNavigation();
    }


    // ============================================
    // Grid Navigation (Arrow keys / Tab / Enter)
    // ============================================

    function setupGridNavigation() {
        const table = document.getElementById('marksTable');

        table.addEventListener('keydown', (e) => {
            const target = e.target;
            if (!target.classList.contains('marks-input') && !target.classList.contains('max-marks-input')) return;

            const cell = target.closest('td');
            const row = cell.closest('tr');
            const cellIndex = Array.from(row.cells).indexOf(cell);

            let targetInput = null;

            if (e.key === 'Enter' || e.key === 'ArrowDown') {
                e.preventDefault();
                // Move down
                const nextRow = row.nextElementSibling;
                if (nextRow) {
                    targetInput = nextRow.cells[cellIndex]?.querySelector('input');
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const prevRow = row.previousElementSibling;
                if (prevRow) {
                    targetInput = prevRow.cells[cellIndex]?.querySelector('input');
                }
            } else if (e.key === 'ArrowRight' && target.selectionStart === target.value.length) {
                e.preventDefault();
                // Move right
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
                targetInput.select();
            }
        });

        // Auto-select content on focus
        table.addEventListener('focusin', (e) => {
            if (e.target.matches('input[type="number"]')) {
                e.target.select();
            }
        });
    }


    // ============================================
    // Clear All Marks
    // ============================================

    document.getElementById('btnClearGrid').addEventListener('click', () => {
        if (!confirm('Clear all entered marks? This will not delete saved data — only clears the form.')) return;

        document.querySelectorAll('.marks-input').forEach(input => {
            input.value = '';
        });
        document.querySelectorAll('.max-marks-input').forEach(input => {
            input.value = '';
        });
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
            // Collect max marks
            const maxMarks = [];
            document.querySelectorAll('.max-marks-input').forEach(input => {
                const val = input.value.trim();
                if (val !== '') {
                    maxMarks.push({
                        subject_id: parseInt(input.dataset.subjectId),
                        max_marks: parseFloat(val),
                    });
                }
            });

            // Collect student marks grouped by admission number
            const entriesMap = {};
            document.querySelectorAll('.marks-input').forEach(input => {
                const admNo = input.dataset.admission;
                const subjectId = parseInt(input.dataset.subjectId);
                const val = input.value.trim();

                if (!entriesMap[admNo]) {
                    entriesMap[admNo] = {
                        admission_number: admNo,
                        results: [],
                    };
                }

                if (val !== '') {
                    entriesMap[admNo].results.push({
                        subject_id: subjectId,
                        marks_obtained: parseFloat(val),
                        grade: null,
                    });
                }
            });

            // Filter out students with no marks entered
            const entries = Object.values(entriesMap).filter(e => e.results.length > 0);

            if (entries.length === 0) {
                showMarksAlert('No marks entered. Please fill in at least one cell.', 'warning');
                return;
            }

            // Validate marks against max marks
            const maxMarksMap = {};
            maxMarks.forEach(mm => maxMarksMap[mm.subject_id] = mm.max_marks);

            for (const entry of entries) {
                for (const result of entry.results) {
                    const max = maxMarksMap[result.subject_id];
                    if (max !== undefined && result.marks_obtained > max) {
                        // Find the subject name
                        const subjectName = loadedData.subjects.find(s => s.id === result.subject_id)?.subject_name || result.subject_id;
                        showMarksAlert(
                            `Marks for <strong>${entry.admission_number}</strong> in <strong>${subjectName}</strong> (${result.marks_obtained}) exceed max marks (${max}).`,
                            'danger'
                        );
                        return;
                    }
                }
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
                        ${response.errors.length > 0 ? `<br><small class="text-danger">${response.errors.length} error(s): ${response.errors.join('; ')}</small>` : ''}
                    </div>
                </div>
            `;

            // Briefly flash saved cells
            document.querySelectorAll('.marks-input').forEach(input => {
                if (input.value.trim() !== '') {
                    input.style.transition = 'background-color 0.3s ease';
                    input.style.backgroundColor = '#d4edda';
                    setTimeout(() => {
                        input.style.backgroundColor = '';
                    }, 1500);
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
