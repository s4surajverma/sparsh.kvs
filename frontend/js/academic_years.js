/**
 * SPARSH - Academic Years Management Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    const viewYears = document.getElementById('view-academic-years');
    if (!viewYears) return;

    let yearModalInstance = null;
    const yearsTableBody = document.getElementById('yearsTableBody');
    const yearForm = document.getElementById('yearForm');

    // Alert helper
    function showAlert(message, type = 'danger') {
        const area = document.getElementById('yearsAlertArea');
        if (!message) {
            area.innerHTML = '';
            return;
        }
        area.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>`;
    }

    // Load Years
    async function loadYears() {
        try {
            yearsTableBody.innerHTML = '<tr><td colspan="3" class="text-center">Loading academic years...</td></tr>';
            const years = await apiClient.fetch('/academic/years');
            renderYearsTable(years);
            
            // Also update global year displays
            updateGlobalYearDisplay(years);
        } catch (err) {
            showAlert('Failed to load academic years: ' + err.message);
            yearsTableBody.innerHTML = '';
        }
    }

    // Render Table
    function renderYearsTable(years) {
        yearsTableBody.innerHTML = '';
        
        years.forEach(year => {
            const statusBadge = year.is_current 
                ? '<span class="badge bg-success">Current Active Year</span>' 
                : '<span class="badge bg-secondary">Archived</span>';

            let actionsHtml = `<button class="btn btn-sm btn-outline-primary btn-edit-year" data-id="${year.id}" data-label="${year.year_label}" data-current="${year.is_current}" title="Edit Year"><i class="bi bi-pencil me-1"></i>Edit</button>`;
            
            if (!year.is_current) {
                actionsHtml += ` <button class="btn btn-sm btn-success btn-set-current" data-id="${year.id}" title="Set as Current">Set Active</button>`;
                actionsHtml += ` <button class="btn btn-sm btn-outline-danger btn-delete-year" data-id="${year.id}" data-label="${year.year_label}" title="Delete Year"><i class="bi bi-trash me-1"></i>Delete</button>`;
            }

            const tr = document.createElement('tr');
            if (year.is_current) {
                tr.classList.add('table-success');
            }
            
            tr.innerHTML = `
                <td><strong>${year.year_label}</strong></td>
                <td>${statusBadge}</td>
                <td class="text-end">${actionsHtml}</td>
            `;
            yearsTableBody.appendChild(tr);
        });

        attachActionListeners();
    }

    // Attach Action Listeners
    function attachActionListeners() {
        // Edit
        document.querySelectorAll('.btn-edit-year').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.dataset.id;
                const label = e.target.dataset.label;
                const isCurrent = e.target.dataset.current === 'true';
                openYearModal(id, label, isCurrent);
            });
        });

        // Set Current
        document.querySelectorAll('.btn-set-current').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.dataset.id;
                try {
                    await apiClient.fetch(`/academic/years/${id}/set-current`, { method: 'PUT' });
                    showAlert('Academic year updated successfully.', 'success');
                    loadYears();
                } catch (err) {
                    showAlert('Failed to set active year: ' + err.message);
                }
            });
        });

        // Delete
        document.querySelectorAll('.btn-delete-year').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const btnEl = e.currentTarget;
                const id = btnEl.dataset.id;
                const label = btnEl.dataset.label;
                if (!confirm(`Are you sure you want to delete academic year "${label}"? This action cannot be undone.`)) return;
                try {
                    await apiClient.fetch(`/academic/years/${id}`, { method: 'DELETE' });
                    showAlert('Academic year deleted successfully.', 'success');
                    loadYears();
                } catch (err) {
                    showAlert('Failed to delete academic year: ' + err.message);
                }
            });
        });
    }

    // Open Modal
    function openYearModal(id = '', label = '', isCurrent = false) {
        yearForm.reset();
        document.getElementById('yearModalTitle').textContent = id ? 'Edit Academic Year' : 'Add Academic Year';
        document.getElementById('yearId').value = id;
        document.getElementById('yearLabel').value = label;
        document.getElementById('yearIsCurrent').checked = isCurrent;
        
        if (!yearModalInstance) yearModalInstance = new bootstrap.Modal(document.getElementById('yearModal'));
        yearModalInstance.show();
    }

    // Handle "Add New Year" button
    document.getElementById('btnNewYear').addEventListener('click', () => {
        openYearModal();
    });

    // Save Year (Create/Update)
    yearForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnSaveYear');
        btn.disabled = true;

        const id = document.getElementById('yearId').value;
        const payload = {
            year_label: document.getElementById('yearLabel').value.trim(),
            is_current: document.getElementById('yearIsCurrent').checked
        };

        try {
            if (id) {
                await apiClient.fetch(`/academic/years/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify(payload)
                });
                showAlert('Academic year updated successfully.', 'success');
            } else {
                await apiClient.fetch('/academic/years', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                showAlert('Academic year created successfully.', 'success');
            }
            yearModalInstance.hide();
            loadYears();
        } catch (err) {
            alert('Error: ' + err.message);
        } finally {
            btn.disabled = false;
        }
    });

    // Initial Load when navigating to this view
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class' && !viewYears.classList.contains('hidden')) {
                loadYears();
            }
        });
    });
    observer.observe(viewYears, { attributes: true });

    // Load immediately if already visible
    if (!viewYears.classList.contains('hidden')) {
        loadYears();
    }
});

// Expose a global helper to update year displays across the UI
window.updateGlobalYearDisplay = function(yearsArray) {
    if (!yearsArray) return;
    const currentYear = yearsArray.find(y => y.is_current);
    const label = currentYear ? currentYear.year_label : 'Not Set';
    
    // Update Navbar Global Display
    const globalEl = document.getElementById('globalActiveYear');
    if (globalEl) globalEl.textContent = label;
    
    // Update Home Dashboard Display
    const dashEl = document.getElementById('displayYear');
    if (dashEl) dashEl.textContent = label;
};
