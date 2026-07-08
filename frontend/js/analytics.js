/**
 * SPARSH - Performance Analytics Module
 *
 * Handles three analytics views using Chart.js 4:
 *  a) Student Trend   — admission number → per-subject across years (line chart)
 *  b) Class Trend     — class + section → per-subject across years (bar chart, cohort-label)
 *  c) Subject Trend   — subject → per-class across years (grouped bar chart)
 *
 * Chart.js spanGaps: false ensures missing years render as visible gaps,
 * not interpolated lines.
 *
 * Mode toggle (Avg Percentage / Avg Marks) re-draws the existing chart in place.
 */

// ─────────────────────────────────────────────
//  Shared palette & chart helpers
// ─────────────────────────────────────────────

const ANALYTICS_PALETTE = [
    '#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ef4444',
    '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
    '#84cc16', '#0ea5e9', '#a855f7', '#e11d48', '#0891b2',
];

function getPaletteColor(i, alpha = 1) {
    const hex = ANALYTICS_PALETTE[i % ANALYTICS_PALETTE.length];
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Destroy an existing Chart.js instance on a canvas if one exists,
 * then return the canvas element ready for a new chart.
 */
function resetCanvas(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
    return canvas;
}

/**
 * Build a Chart.js line chart where each series (dataset) maps to
 * one "series key" (e.g. subject name) and x-axis labels are years.
 * Missing year→series combinations are rendered as null (gap).
 *
 * @param {string} canvasId
 * @param {string[]} allYears     - sorted unique year labels for x-axis
 * @param {string[]} seriesKeys   - unique series identifiers (subject/class names)
 * @param {Object}   dataMap      - { seriesKey: { yearLabel: value } }
 * @param {string}   mode         - 'percentage' | 'marks'
 * @param {string}   chartType    - 'line' | 'bar'
 */
function buildChart(canvasId, allYears, seriesKeys, dataMap, mode, chartType = 'line') {
    const canvas = resetCanvas(canvasId);
    if (!canvas) return;

    const label = mode === 'percentage' ? 'Average Percentage (%)' : 'Average Marks';
    const yLabel = mode === 'percentage' ? '%' : 'Marks';

    const datasets = seriesKeys.map((key, i) => {
        const vals = allYears.map(y => {
            const v = dataMap[key]?.[y];
            return (v !== undefined && v !== null) ? v : null;
        });
        const color = getPaletteColor(i);
        const bgColor = getPaletteColor(i, chartType === 'bar' ? 0.7 : 0.15);
        return {
            label: key,
            data: vals,
            borderColor: color,
            backgroundColor: bgColor,
            borderWidth: 2,
            pointRadius: 5,
            pointHoverRadius: 7,
            spanGaps: false,   // gaps for missing years — do NOT connect across nulls
            fill: chartType === 'line',
            tension: 0.3,
        };
    });

    new Chart(canvas, {
        type: chartType,
        data: { labels: allYears, datasets },
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const v = ctx.parsed.y;
                            if (v === null || v === undefined) return `${ctx.dataset.label}: —`;
                            return `${ctx.dataset.label}: ${v}${mode === 'percentage' ? '%' : ''}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: mode === 'percentage' ? 100 : undefined,
                    title: { display: true, text: label },
                    ticks: { callback: v => `${v}${mode === 'percentage' ? '%' : ''}` }
                },
                x: { title: { display: true, text: 'Academic Year' } }
            }
        }
    });
}

/**
 * Pivot flat API rows into the dataMap structure needed by buildChart.
 *
 * @param {Object[]} rows         - array of { yearLabel, seriesKey, avg_marks, avg_percentage }
 * @param {string}   yearField    - field name for year label
 * @param {string}   seriesField  - field name to use as series key
 * @param {string}   mode         - 'percentage' | 'marks'
 * @returns {{ allYears, seriesKeys, dataMap }}
 */
function pivotData(rows, yearField, seriesField, mode) {
    const yearSet = new Set();
    const seriesSet = new Set();

    rows.forEach(r => {
        yearSet.add(r[yearField]);
        seriesSet.add(r[seriesField]);
    });

    const allYears = [...yearSet].sort();
    const seriesKeys = [...seriesSet].sort();
    const valueField = mode === 'percentage' ? 'avg_percentage' : 'avg_marks';

    const dataMap = {};
    rows.forEach(r => {
        const sk = r[seriesField];
        if (!dataMap[sk]) dataMap[sk] = {};
        dataMap[sk][r[yearField]] = r[valueField];
    });

    return { allYears, seriesKeys, dataMap };
}

/**
 * Build a data table (thead + tbody) with years as columns and series as rows.
 */
function buildTable(headId, bodyId, allYears, seriesKeys, dataMap, mode) {
    const head = document.getElementById(headId);
    const body = document.getElementById(bodyId);
    if (!head || !body) return;

    const suffix = mode === 'percentage' ? '%' : '';
    head.innerHTML = `<tr><th>Subject / Class</th>${allYears.map(y => `<th>${y}</th>`).join('')}</tr>`;
    body.innerHTML = seriesKeys.map(sk => {
        const cells = allYears.map(y => {
            const v = dataMap[sk]?.[y];
            return `<td>${v !== undefined && v !== null ? v + suffix : '<span class="text-muted">—</span>'}</td>`;
        }).join('');
        return `<tr><td class="fw-semibold">${sk}</td>${cells}</tr>`;
    }).join('');
}

// ─────────────────────────────────────────────
//  Populate shared dropdowns
// ─────────────────────────────────────────────

async function populateSelectFromApi(selectId, endpoint, valueField, textField, emptyOption = null) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    try {
        const items = await apiClient.fetch(endpoint);
        // Keep only the first option (the placeholder) if emptyOption given, else clear
        sel.innerHTML = emptyOption ? `<option value="">${emptyOption}</option>` : '';
        items.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item[valueField];
            opt.textContent = item[textField];
            if (item.sections !== undefined) opt.dataset.sections = item.sections || '';
            sel.appendChild(opt);
        });
    } catch (e) {
        console.error(`Failed to populate ${selectId}:`, e);
    }
}

// ─────────────────────────────────────────────
//  VIEW A — Student Trend
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

    // ── Student Trend ──────────────────────────────────────────────────
    const viewSA = document.getElementById('view-student-analytics');
    if (!viewSA) return;

    let saData = null;

    function showSAAlert(msg, type = 'danger') {
        const area = document.getElementById('studentAnalyticsAlertArea');
        area.innerHTML = msg ? `<div class="alert alert-${type} alert-dismissible fade show">${msg}<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>` : '';
    }

    function renderStudentChart(mode) {
        if (!saData || !saData.data.length) return;
        const { allYears, seriesKeys, dataMap } = pivotData(saData.data, 'year_label', 'subject_name', mode);
        buildChart('studentAnalyticsChart', allYears, seriesKeys, dataMap, mode, 'line');
        buildTable('saDataTableHead', 'saDataTableBody', allYears, seriesKeys, dataMap, mode);
    }

    document.getElementById('btnLoadStudentAnalytics')?.addEventListener('click', async () => {
        const adm = document.getElementById('saAdmissionNumber').value.trim();
        if (!adm) { showSAAlert('Please enter an Admission Number.', 'warning'); return; }
        showSAAlert('');
        document.getElementById('studentAnalyticsResult').classList.add('hidden');
        saData = null;

        try {
            saData = await apiClient.fetch(`/analytics/student/${encodeURIComponent(adm)}`);

            document.getElementById('saStudentName').textContent = saData.student_name;
            document.getElementById('saAdmDisplay').textContent = `Admission No: ${saData.admission_number}`;
            document.getElementById('saInitials').textContent = saData.student_name.charAt(0).toUpperCase();

            if (!saData.data.length) {
                showSAAlert('No result data found for this student.', 'warning');
                return;
            }

            const mode = document.querySelector('input[name="saModeToggle"]:checked')?.value || 'percentage';
            renderStudentChart(mode);
            document.getElementById('studentAnalyticsResult').classList.remove('hidden');
        } catch (err) {
            showSAAlert('Error: ' + err.message);
        }
    });

    document.querySelectorAll('input[name="saModeToggle"]').forEach(r => {
        r.addEventListener('change', e => { if (saData) renderStudentChart(e.target.value); });
    });

    // ── Class / Section Trend ──────────────────────────────────────────
    const viewCA = document.getElementById('view-class-analytics');
    let caData = null;
    let caDropdownsLoaded = false;

    function showCAAlert(msg, type = 'danger') {
        const area = document.getElementById('classAnalyticsAlertArea');
        area.innerHTML = msg ? `<div class="alert alert-${type} alert-dismissible fade show">${msg}<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>` : '';
    }

    function renderClassChart(mode) {
        if (!caData || !caData.data.length) return;
        const { allYears, seriesKeys, dataMap } = pivotData(caData.data, 'year_label', 'subject_name', mode);
        buildChart('classAnalyticsChart', allYears, seriesKeys, dataMap, mode, 'bar');
        buildTable('caDataTableHead', 'caDataTableBody', allYears, seriesKeys, dataMap, mode);
    }

    async function loadCADropdowns() {
        if (caDropdownsLoaded) return;
        await populateSelectFromApi('caClassSelect', '/academic/classes', 'id', 'class_name', 'Select class...');
        await populateSelectFromApi('caSubjectFilter', '/academic/subjects', 'id', 'subject_name', 'All subjects');
        
        const caClassSelect = document.getElementById('caClassSelect');
        caClassSelect.addEventListener('change', (e) => {
            const selectedOpt = e.target.selectedOptions[0];
            const sectionSelect = document.getElementById('caSection');
            sectionSelect.innerHTML = '<option value="">All Sections</option>';
            if (selectedOpt && selectedOpt.dataset.sections) {
                const secs = selectedOpt.dataset.sections.split(',');
                secs.forEach(s => {
                    const val = s.trim();
                    if(val) sectionSelect.innerHTML += `<option value="${val}">${val}</option>`;
                });
            }
        });
        
        caDropdownsLoaded = true;
    }

    document.getElementById('btnLoadClassAnalytics')?.addEventListener('click', async () => {
        const classId = document.getElementById('caClassSelect').value;
        const section = document.getElementById('caSection').value.trim().toUpperCase();
        const subjectId = document.getElementById('caSubjectFilter').value;
        if (!classId || !section) { showCAAlert('Please select a class and enter a section.', 'warning'); return; }
        showCAAlert('');
        document.getElementById('classAnalyticsResult').classList.add('hidden');
        caData = null;

        try {
            let url = `/analytics/class?class_level_id=${classId}&section=${section}`;
            if (subjectId) url += `&subject_id=${subjectId}`;
            caData = await apiClient.fetch(url);

            if (!caData.data.length) {
                showCAAlert('No result data found for this class and section.', 'warning');
                return;
            }

            const mode = document.querySelector('input[name="caModeToggle"]:checked')?.value || 'percentage';
            renderClassChart(mode);
            document.getElementById('classAnalyticsResult').classList.remove('hidden');
        } catch (err) {
            showCAAlert('Error: ' + err.message);
        }
    });

    document.querySelectorAll('input[name="caModeToggle"]').forEach(r => {
        r.addEventListener('change', e => { if (caData) renderClassChart(e.target.value); });
    });

    // ── Subject Trend ──────────────────────────────────────────────────
    const viewSUA = document.getElementById('view-subject-analytics');
    let suaData = null;
    let suaDropdownsLoaded = false;

    function showSUAAlert(msg, type = 'danger') {
        const area = document.getElementById('subjectAnalyticsAlertArea');
        area.innerHTML = msg ? `<div class="alert alert-${type} alert-dismissible fade show">${msg}<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>` : '';
    }

    function renderSubjectChart(mode) {
        if (!suaData || !suaData.data.length) return;
        const { allYears, seriesKeys, dataMap } = pivotData(suaData.data, 'year_label', 'class_name', mode);
        buildChart('subjectAnalyticsChart', allYears, seriesKeys, dataMap, mode, 'bar');
        buildTable('suaDataTableHead', 'suaDataTableBody', allYears, seriesKeys, dataMap, mode);
    }

    async function loadSUADropdowns() {
        if (suaDropdownsLoaded) return;
        await populateSelectFromApi('suaSubjectSelect', '/academic/subjects', 'id', 'subject_name', 'Select subject...');
        await populateSelectFromApi('suaClassFilter', '/academic/classes', 'id', 'class_name', 'All classes');
        suaDropdownsLoaded = true;
    }

    document.getElementById('btnLoadSubjectAnalytics')?.addEventListener('click', async () => {
        const subjectId = document.getElementById('suaSubjectSelect').value;
        const classId = document.getElementById('suaClassFilter').value;
        if (!subjectId) { showSUAAlert('Please select a subject.', 'warning'); return; }
        showSUAAlert('');
        document.getElementById('subjectAnalyticsResult').classList.add('hidden');
        suaData = null;

        try {
            let url = `/analytics/subject/${subjectId}`;
            if (classId) url += `?class_level_id=${classId}`;
            suaData = await apiClient.fetch(url);

            if (!suaData.data.length) {
                showSUAAlert('No result data found for this subject.', 'warning');
                return;
            }

            const mode = document.querySelector('input[name="suaModeToggle"]:checked')?.value || 'percentage';
            renderSubjectChart(mode);
            document.getElementById('subjectAnalyticsResult').classList.remove('hidden');
        } catch (err) {
            showSUAAlert('Error: ' + err.message);
        }
    });

    document.querySelectorAll('input[name="suaModeToggle"]').forEach(r => {
        r.addEventListener('change', e => { if (suaData) renderSubjectChart(e.target.value); });
    });

    // ── MutationObserver — load dropdowns lazily on first view show ────
    const observeView = (viewEl, loaderFn) => {
        if (!viewEl) return;
        const obs = new MutationObserver(mutations => {
            mutations.forEach(m => {
                if (m.attributeName === 'class' && !viewEl.classList.contains('hidden')) loaderFn();
            });
        });
        obs.observe(viewEl, { attributes: true });
        if (!viewEl.classList.contains('hidden')) loaderFn();
    };

    observeView(viewCA, loadCADropdowns);
    observeView(viewSUA, loadSUADropdowns);
});
