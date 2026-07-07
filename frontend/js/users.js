/**
 * School Result Analysis System
 * User Management Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    const viewUsers = document.getElementById('view-users');
    if (!viewUsers) return;

    let userModalInstance = null;
    let resetPwdModalInstance = null;

    // Elements
    const usersTableBody = document.getElementById('usersTableBody');
    const userForm = document.getElementById('userForm');
    const resetPwdForm = document.getElementById('resetPwdForm');
    
    // Alert helper
    function showAlert(message, type = 'danger') {
        const area = document.getElementById('usersAlertArea');
        if (!message) {
            area.innerHTML = '';
            return;
        }
        area.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>`;
    }

    // Load Users
    async function loadUsers() {
        try {
            usersTableBody.innerHTML = '<tr><td colspan="5" class="text-center">Loading users...</td></tr>';
            const payload = await apiClient.fetch('/users/');
            renderUsersTable(payload.items);
        } catch (err) {
            showAlert('Failed to load users: ' + err.message);
            usersTableBody.innerHTML = '';
        }
    }

    // Render Table
    function renderUsersTable(users) {
        usersTableBody.innerHTML = '';
        
        users.forEach(user => {
            const statusBadge = user.is_active 
                ? '<span class="badge bg-success">Active</span>' 
                : '<span class="badge bg-secondary">Disabled</span>';
            
            const roleBadgeClass = {
                'admin': 'bg-danger',
                'principal': 'bg-primary',
                'teacher': 'bg-info text-dark'
            }[user.role] || 'bg-secondary';

            const roleBadge = `<span class="badge ${roleBadgeClass}">${user.role.toUpperCase()}</span>`;

            // Action buttons
            let actionsHtml = `
                <button class="btn btn-sm btn-outline-primary btn-edit" data-id="${user.id}" title="Edit User">Edit</button>
                <button class="btn btn-sm btn-outline-warning btn-reset" data-id="${user.id}" data-username="${user.username}" title="Reset Password">Reset Pwd</button>
            `;

            if (user.is_active) {
                actionsHtml += `<button class="btn btn-sm btn-outline-secondary btn-toggle" data-id="${user.id}" data-action="disable" title="Disable User">Disable</button>`;
            } else {
                actionsHtml += `
                    <button class="btn btn-sm btn-success btn-toggle" data-id="${user.id}" data-action="enable" title="Enable User">Enable</button>
                    <button class="btn btn-sm btn-outline-danger btn-delete" data-id="${user.id}" title="Delete User">Delete</button>
                `;
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${user.username}</strong></td>
                <td>${user.full_name}</td>
                <td>${roleBadge}</td>
                <td>${statusBadge}</td>
                <td class="text-end">${actionsHtml}</td>
            `;
            usersTableBody.appendChild(tr);
        });

        attachActionListeners();
    }

    // Attach listeners to dynamic buttons
    function attachActionListeners() {
        // Edit Buttons
        document.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.dataset.id;
                try {
                    const user = await apiClient.fetch(`/users/${id}`);
                    openUserModal(user);
                } catch (err) {
                    showAlert('Failed to load user details: ' + err.message);
                }
            });
        });

        // Toggle Enable/Disable Buttons
        document.querySelectorAll('.btn-toggle').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.dataset.id;
                const action = e.target.dataset.action;
                try {
                    await apiClient.fetch(`/users/${id}/${action}`, { method: 'PATCH' });
                    loadUsers();
                } catch (err) {
                    showAlert(`Failed to ${action} user: ` + err.message);
                }
            });
        });

        // Delete Buttons
        document.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if (!confirm("Are you sure you want to permanently delete this user? This cannot be undone.")) return;
                const id = e.target.dataset.id;
                try {
                    await apiClient.fetch(`/users/${id}`, { method: 'DELETE' });
                    showAlert('User deleted successfully.', 'success');
                    loadUsers();
                } catch (err) {
                    showAlert('Failed to delete user: ' + err.message);
                }
            });
        });

        // Reset Password Buttons
        document.querySelectorAll('.btn-reset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.getElementById('resetUserId').value = e.target.dataset.id;
                document.getElementById('resetUserUsername').textContent = e.target.dataset.username;
                document.getElementById('resetNewPassword').value = '';
                
                if (!resetPwdModalInstance) resetPwdModalInstance = new bootstrap.Modal(document.getElementById('resetPwdModal'));
                resetPwdModalInstance.show();
            });
        });
    }

    // Open User Modal (Create or Edit)
    function openUserModal(user = null) {
        userForm.reset();
        
        const title = document.getElementById('userModalTitle');
        const idInput = document.getElementById('userId');
        const usernameInput = document.getElementById('userUsername');
        const passwordGroup = document.getElementById('passwordGroup');
        const userPassword = document.getElementById('userPassword');

        if (user) {
            // Edit Mode
            title.textContent = 'Edit User';
            idInput.value = user.id;
            usernameInput.value = user.username;
            usernameInput.disabled = true; // Cannot change username
            
            document.getElementById('userFullName').value = user.full_name;
            document.getElementById('userRole').value = user.role;
            
            passwordGroup.classList.add('hidden');
            userPassword.required = false;
        } else {
            // Create Mode
            title.textContent = 'Add New User';
            idInput.value = '';
            usernameInput.disabled = false;
            
            passwordGroup.classList.remove('hidden');
            userPassword.required = true;
        }

        if (!userModalInstance) userModalInstance = new bootstrap.Modal(document.getElementById('userModal'));
        userModalInstance.show();
    }

    // Handle "Add New User" button
    document.getElementById('btnNewUser').addEventListener('click', () => {
        openUserModal(null);
    });

    // Save User (Create or Update)
    userForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnSaveUser');
        btn.disabled = true;

        const id = document.getElementById('userId').value;
        const payload = {
            full_name: document.getElementById('userFullName').value,
            role: document.getElementById('userRole').value
        };

        try {
            if (id) {
                // Update
                await apiClient.fetch(`/users/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify(payload)
                });
                showAlert('User updated successfully.', 'success');
            } else {
                // Create
                payload.username = document.getElementById('userUsername').value;
                payload.password = document.getElementById('userPassword').value;
                
                await apiClient.fetch('/users/', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                showAlert('User created successfully.', 'success');
            }

            userModalInstance.hide();
            loadUsers();
        } catch (err) {
            alert('Error: ' + err.message);
        } finally {
            btn.disabled = false;
        }
    });

    // Handle Password Reset
    resetPwdForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnConfirmReset');
        btn.disabled = true;

        const id = document.getElementById('resetUserId').value;
        const payload = {
            new_password: document.getElementById('resetNewPassword').value
        };

        try {
            await apiClient.fetch(`/users/${id}/reset-password`, {
                method: 'PATCH',
                body: JSON.stringify(payload)
            });
            showAlert('Password reset successfully.', 'success');
            resetPwdModalInstance.hide();
        } catch (err) {
            alert('Failed to reset password: ' + err.message);
        } finally {
            btn.disabled = false;
        }
    });

    // Initial Load when navigating to this view
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class' && !viewUsers.classList.contains('hidden')) {
                loadUsers();
            }
        });
    });
    observer.observe(viewUsers, { attributes: true });

    // Load immediately if already visible
    if (!viewUsers.classList.contains('hidden')) {
        loadUsers();
    }
});
