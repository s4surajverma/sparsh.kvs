/**
 * School Result Analysis System
 * Dashboard Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
    // --- 1. Authentication Guard ---
    if (!apiClient.getToken()) {
        window.location.href = '/index.html';
        return;
    }

    // --- 2. Setup UI Identity ---
    const userRole = localStorage.getItem('user_role');
    const userName = localStorage.getItem('user_name');

    document.getElementById('userGreeting').textContent = `Welcome, ${userName || 'User'}`;
    const displayRole = document.getElementById('displayRole');
    if (displayRole) displayRole.textContent = userRole.toUpperCase();

    // Show/hide role-specific menu items
    document.querySelectorAll('.nav-item').forEach(el => {
        if (el.classList.contains(`role-${userRole}`)) {
            el.classList.remove('hidden');
        }
    });

    // Hide section containers if all their child nav-items are hidden
    document.querySelectorAll('.nav-section-container').forEach(container => {
        const items = container.querySelectorAll('.nav-item:not(.nav-section-header)');
        const anyVisible = Array.from(items).some(item => !item.classList.contains('hidden'));
        if (!anyVisible) {
            container.classList.add('hidden');
        }
    });

    // --- 3. View Navigation ---
    // Map of URL path segments to view IDs
    const validViews = ['home', 'search', 'marks-entry', 'import', 'reports', 'users', 'academic-years', 'storage-settings', 'about'];

    const navLinks = document.querySelectorAll('#sidebarMenu .nav-link');
    const views = document.querySelectorAll('.view-section');

    function getViewFromPath() {
        // Extract view name from pathname (e.g., "/search" → "search", "/storage-settings" → "storage-settings")
        const path = window.location.pathname.replace(/^\/+|\/+$/g, ''); // trim slashes
        
        // Support legacy hash-based URLs for backwards compatibility
        if (!path || path === 'dashboard.html') {
            const hash = window.location.hash.substring(1);
            return (hash && validViews.includes(hash)) ? hash : 'home';
        }
        
        return validViews.includes(path) ? path : 'home';
    }

    function switchView(viewId, pushState = true) {
        // Update active nav link
        navLinks.forEach(link => {
            if (link.dataset.view === viewId) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });

        // Show target view, hide others
        views.forEach(view => {
            if (view.id === `view-${viewId}`) {
                view.classList.remove('hidden');
            } else {
                view.classList.add('hidden');
            }
        });
        
        // Update the URL path
        const targetPath = `/${viewId}`;
        if (pushState && window.location.pathname !== targetPath) {
            history.pushState({ view: viewId }, '', targetPath);
        }
    }

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetView = e.currentTarget.dataset.view;
            if (targetView) switchView(targetView);
        });
    });

    // Handle browser back/forward buttons
    window.addEventListener('popstate', () => {
        const viewId = getViewFromPath();
        switchView(viewId, false);
    });

    // Handle initial load based on URL path
    const initialView = getViewFromPath();
    switchView(initialView, false);

    // --- 4. Logout ---
    document.getElementById('logoutBtn').addEventListener('click', (e) => {
        e.preventDefault();
        apiClient.clearAuth();
        window.location.href = '/index.html';
    });


    // --- 5. Fetch Initial Dashboard Data (Academic Year & Classes) ---
    try {
        const years = await apiClient.fetch('/academic/years');
        const currentYear = years.find(y => y.is_current);
        const displayYear = document.getElementById('displayYear');
        const globalYear = document.getElementById('globalActiveYear');
        const yearLabel = currentYear ? currentYear.year_label : 'Not Set';
        if (displayYear) displayYear.textContent = yearLabel;
        if (globalYear) globalYear.textContent = yearLabel;

        const classes = await apiClient.fetch('/academic/classes');
        const classSelect = document.getElementById('searchClass');
        if (classSelect) {
            classes.forEach(cls => {
                const option = document.createElement('option');
                option.value = cls.id;
                option.textContent = cls.class_name;
                classSelect.appendChild(option);
            });
        }

        // Admin-only Storage Status Check
        if (userRole === 'admin') {
            const storageStatusEl = document.getElementById('homeStorageStatus');
            if (storageStatusEl) {
                try {
                    const storageInfo = await apiClient.fetch('/settings/storage');
                    if (storageInfo.provider === 'local') {
                        storageStatusEl.textContent = 'Local Storage';
                        storageStatusEl.classList.add('text-secondary');
                    } else if (storageInfo.provider === 'google_drive') {
                        storageStatusEl.textContent = 'Google Drive';
                        storageStatusEl.classList.add('text-success');
                    } else {
                        storageStatusEl.textContent = 'Unknown';
                    }
                } catch (e) {
                    storageStatusEl.textContent = 'Error';
                    storageStatusEl.classList.add('text-danger');
                }
            }
        }
    } catch (e) {
        console.error("Failed to load initial data", e);
    }

    // --- 6. Student Search Logic ---
    const searchForm = document.getElementById('searchForm');
    const searchBtn = document.getElementById('searchBtn');
    const searchError = document.getElementById('searchError');
    const searchResultArea = document.getElementById('searchResultArea');
    const resultsContainer = document.getElementById('resultsContainer');
    const reportsContainer = document.getElementById('reportsContainer');

    if (searchForm) {
        searchForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const classId = document.getElementById('searchClass').value;
            const section = document.getElementById('searchSection').value;
            const roll = document.getElementById('searchRoll').value;

            // UI Reset
            searchBtn.disabled = true;
            searchBtn.textContent = 'Searching...';
            searchError.classList.add('hidden');
            searchResultArea.classList.add('hidden');
            resultsContainer.innerHTML = '';
            reportsContainer.innerHTML = '';

            try {
                if (!roll) {
                    // Fetch list of students in class/section
                    const payload = await apiClient.fetch(
                        `/students/search?class_level_id=${classId}&section=${section}`
                    );

                    document.getElementById('studentIdentityProfile').classList.add('hidden');
                    document.getElementById('studentHistoricalReports').classList.add('hidden');

                    if (!payload.items || payload.items.length === 0) {
                        resultsContainer.innerHTML = '<div class="alert alert-warning">No students found for this class and section.</div>';
                    } else {
                        let tableHtml = `
                            <div class="section-card">
                                <h5>Student List (Showing ${payload.items.length} of ${payload.total} results)</h5>
                                <div class="table-responsive">
                                    <table class="table table-bordered table-hover result-table">
                                        <thead>
                                            <tr>
                                                <th>Roll No</th>
                                                <th>Admission No</th>
                                                <th>Student Name</th>
                                                <th>Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${payload.items.map(student => `
                                                <tr>
                                                    <td>${student.roll_number || '-'}</td>
                                                    <td>${student.admission_number}</td>
                                                    <td>${student.student_name}</td>
                                                    <td>
                                                        <button class="btn btn-sm btn-primary view-student-btn" data-roll="${student.roll_number}">
                                                            View Profile
                                                        </button>
                                                    </td>
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        `;
                        resultsContainer.innerHTML = tableHtml;

                        // Add click listeners to "View Profile" buttons
                        resultsContainer.querySelectorAll('.view-student-btn').forEach(btn => {
                            btn.addEventListener('click', (e) => {
                                const targetRoll = e.currentTarget.dataset.roll;
                                if (targetRoll && targetRoll !== 'null') {
                                    document.getElementById('searchRoll').value = targetRoll;
                                    searchForm.dispatchEvent(new Event('submit'));
                                }
                            });
                        });
                    }
                } else {
                    // Fetch dashboard payload for specific student
                    const payload = await apiClient.fetch(
                        `/dashboard/student?class_level_id=${classId}&section=${section}&roll_number=${roll}`
                    );

                    document.getElementById('studentIdentityProfile').classList.remove('hidden');
                    document.getElementById('studentHistoricalReports').classList.remove('hidden');

                    // Render Identity & Context
                    const studentName = payload.student.student_name || '?';
                    document.getElementById('resName').textContent = studentName;
                    const initialsEl = document.getElementById('resInitials');
                    if (initialsEl) initialsEl.textContent = studentName.charAt(0).toUpperCase();
                    document.getElementById('resAdm').textContent = payload.student.admission_number;
                    document.getElementById('resClass').textContent = payload.enrollment.class_name;
                    document.getElementById('resSection').textContent = payload.enrollment.section;
                    document.getElementById('resRoll').textContent = payload.enrollment.roll_number;
                    document.getElementById('resYear').textContent = payload.enrollment.academic_year;

                    // Render Results
                    if (payload.results.length === 0) {
                        resultsContainer.innerHTML = '<div class="alert alert-warning">No results found for current academic year.</div>';
                    } else {
                        payload.results.forEach(examResult => {
                            const tableHtml = `
                                <div class="section-card">
                                    <h5>Exam: ${examResult.exam_name}</h5>
                                    <div class="table-responsive">
                                        <table class="table table-bordered table-sm result-table">
                                            <thead>
                                                <tr>
                                                    <th>Subject</th>
                                                    <th>Max Marks</th>
                                                    <th>Marks Obtained</th>
                                                    <th>Percentage</th>
                                                    <th>Grade</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${examResult.subjects.map(sub => `
                                                    <tr>
                                                        <td>${sub.subject_name}</td>
                                                        <td>${sub.max_marks !== null ? sub.max_marks : '-'}</td>
                                                        <td>${sub.marks_obtained !== null ? sub.marks_obtained : '-'}</td>
                                                        <td>${sub.percentage !== null ? sub.percentage + '%' : '-'}</td>
                                                        <td>${sub.grade || '-'}</td>
                                                    </tr>
                                                `).join('')}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            `;
                            resultsContainer.insertAdjacentHTML('beforeend', tableHtml);
                        });
                    }

                // Render Historical Reports
                if (payload.historical_reports.length === 0) {
                    reportsContainer.innerHTML = '<div class="list-group-item text-muted border-0 ps-0">No historical reports available.</div>';
                } else {
                    reportsContainer.innerHTML = '';
                    payload.historical_reports.forEach((report, index) => {
                        const iframeId = `pdf-frame-${index}`;
                        const cardId = `report-card-${index}`;
                        
                        const cardHtml = `
                            <div class="card mb-4 shadow-sm border-0" id="${cardId}">
                                <div class="card-header bg-light d-flex justify-content-between align-items-center">
                                    <h6 class="mb-0 fw-bold">Academic Year: ${report.academic_year} <small class="text-muted ms-2 fw-normal">${report.filename}</small></h6>
                                    <button class="btn btn-sm btn-outline-danger btn-delete-report hidden" data-url="${report.download_url}" title="Remove Record">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg> Remove
                                    </button>
                                </div>
                                <div class="card-body p-0 position-relative" style="min-height: 200px; background: #f8f9fa;">
                                    <div class="position-absolute top-50 start-50 translate-middle loading-indicator text-center">
                                        <div class="spinner-border text-primary mb-2" role="status"></div>
                                        <p class="text-muted small">Loading PDF...</p>
                                    </div>
                                    <iframe id="${iframeId}" class="w-100 hidden" style="height: 600px; border: none;"></iframe>
                                    <div class="error-state hidden p-4 text-center">
                                        <div class="text-danger mb-2">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" class="bi bi-exclamation-triangle-fill" viewBox="0 0 16 16"><path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/></svg>
                                        </div>
                                        <h6 class="text-danger">File Missing</h6>
                                        <p class="text-muted small mb-3">This report card file has been deleted from Google Drive.<br>Please remove this invalid record to allow re-uploading.</p>
                                        <button class="btn btn-outline-danger btn-sm btn-delete-inline" data-url="${report.download_url}">Remove Record</button>
                                    </div>
                                </div>
                            </div>
                        `;
                        reportsContainer.insertAdjacentHTML('beforeend', cardHtml);

                        // Async fetch logic
                        setTimeout(async () => {
                            const cardEl = document.getElementById(cardId);
                            const iframe = document.getElementById(iframeId);
                            const loading = cardEl.querySelector('.loading-indicator');
                            const errorState = cardEl.querySelector('.error-state');
                            const btnDeleteHeader = cardEl.querySelector('.btn-delete-report');

                            try {
                                const response = await fetch('/api/v1' + report.download_url.replace('/api/v1', ''), {
                                    headers: { 'Authorization': `Bearer ${apiClient.getToken()}` }
                                });
                                
                                if (response.status === 404) {
                                    throw new Error('404');
                                } else if (!response.ok) {
                                    throw new Error('Network error');
                                }
                                
                                const blob = await response.blob();
                                const fileUrl = window.URL.createObjectURL(blob);
                                iframe.src = fileUrl;
                                
                                loading.classList.add('hidden');
                                iframe.classList.remove('hidden');
                                
                                // Show header delete button for admins
                                const userPayload = JSON.parse(atob(apiClient.getToken().split('.')[1]));
                                if (userPayload.role === 'admin' || userPayload.role === 'teacher') {
                                    btnDeleteHeader.classList.remove('hidden');
                                }

                            } catch (err) {
                                loading.classList.add('hidden');
                                if (err.message === '404') {
                                    errorState.classList.remove('hidden');
                                } else {
                                    errorState.innerHTML = `<p class="text-danger mt-3">Failed to load PDF: ${err.message}</p>`;
                                    errorState.classList.remove('hidden');
                                }
                            }
                        }, 50); // slight delay to allow DOM update
                    });

                    // Add delete listeners (delegation)
                    reportsContainer.addEventListener('click', async (e) => {
                        const target = e.target.closest('.btn-delete-report, .btn-delete-inline');
                        if (!target) return;
                        
                        if (!confirm("Are you sure you want to remove this record?")) return;

                        const downloadUrl = target.dataset.url;
                        const deleteUrl = '/api/v1' + downloadUrl.replace('/download', '').replace('/api/v1', '');
                        const card = target.closest('.card');
                        
                        try {
                            const response = await fetch(deleteUrl, {
                                method: 'DELETE',
                                headers: { 'Authorization': `Bearer ${apiClient.getToken()}` }
                            });
                            
                            if (response.ok) {
                                card.remove();
                                if (reportsContainer.children.length === 0) {
                                    reportsContainer.innerHTML = '<div class="list-group-item text-muted border-0 ps-0">No historical reports available.</div>';
                                }
                            } else {
                                const res = await response.json();
                                alert("Failed to delete: " + (res.detail || 'Unknown error'));
                            }
                        } catch (err) {
                            alert("Failed to delete record: " + err.message);
                        }
                    });
                }
                }
                searchResultArea.classList.remove('hidden');

            } catch (error) {
                searchError.textContent = error.message;
                searchError.classList.remove('hidden');
            } finally {
                searchBtn.disabled = false;
                searchBtn.textContent = 'Search';
            }
        });
    }

    // --- 7. Change Password Logic ---
    const changePwdForm = document.getElementById('changePwdForm');
    if (changePwdForm) {
        changePwdForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btnSaveNewPassword');
            const alertArea = document.getElementById('changePwdAlert');
            const currentPwd = document.getElementById('changeCurrentPassword').value;
            const newPwd = document.getElementById('changeNewPassword').value;
            const confirmPwd = document.getElementById('changeConfirmPassword').value;

            if (newPwd !== confirmPwd) {
                alertArea.innerHTML = '<div class="alert alert-danger">New passwords do not match.</div>';
                return;
            }

            btn.disabled = true;
            try {
                await apiClient.fetch('/auth/change-password', {
                    method: 'PATCH',
                    body: JSON.stringify({
                        current_password: currentPwd,
                        new_password: newPwd
                    })
                });
                
                alertArea.innerHTML = '<div class="alert alert-success">Password changed successfully. Logging out...</div>';
                setTimeout(() => {
                    apiClient.clearAuth();
                    window.location.href = '/index.html';
                }, 2000);
            } catch (err) {
                alertArea.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
                btn.disabled = false;
            }
        });
    }
});
