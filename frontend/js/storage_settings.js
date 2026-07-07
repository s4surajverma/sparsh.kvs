/**
 * SPARSH - Storage Settings Management Logic
 *
 * Handles:
 * - Provider switching (Local Storage ↔ Google Drive)
 * - OAuth-based Google Drive connection/disconnection
 * - Scope-aware folder selection:
 *   · drive.file scope → Google Picker widget
 *   · drive scope (legacy) → paste URL + Verify + Test
 * - Merged "Verify & Test" for drive.file connections
 * - Local storage durability warning for ephemeral hosting
 */

document.addEventListener('DOMContentLoaded', () => {
    const viewStorage = document.getElementById('view-storage-settings');
    if (!viewStorage) return;

    // --- State ---
    let currentProvider = 'local';        // 'local' or 'google_drive'
    let driveConnected = false;
    let oauthScope = null;                // null/"drive" = legacy, "drive.file" = new
    let verifiedFolderId = null;
    let verifiedFolderName = null;
    let connectionVerified = false;
    let pickerApiKey = null;
    let googleClientId = null;
    let pickerApiLoaded = false;

    // --- Elements ---
    const btnSave = document.getElementById('btnSaveStorage');
    const alertArea = document.getElementById('storageAlertArea');

    // Provider Toggle
    const providerCardLocal = document.getElementById('providerCardLocal');
    const providerCardDrive = document.getElementById('providerCardDrive');
    const localBadge = document.getElementById('localBadge');
    const driveBadge = document.getElementById('driveBadge');
    const localDurabilityWarning = document.getElementById('localDurabilityWarning');

    // Status Panel
    const statusProvider = document.getElementById('statusProvider');
    const localStatusSection = document.getElementById('localStatusSection');
    const driveDetailedStatus = document.getElementById('driveDetailedStatus');

    // Checklist
    const chkGoogleConnected = document.getElementById('chkGoogleConnected');
    const chkFolderSelected = document.getElementById('chkFolderSelected');
    const chkConnectionVerified = document.getElementById('chkConnectionVerified');

    // History
    const histLastVerified = document.getElementById('histLastVerified');
    const histLastUpload = document.getElementById('histLastUpload');

    // Drive Config Card
    const driveConfigCard = document.getElementById('driveConfigCard');

    // Step 1: Google OAuth
    const googleNotConnected = document.getElementById('googleNotConnected');
    const googleConnected = document.getElementById('googleConnected');
    const btnConnectGoogle = document.getElementById('btnConnectGoogle');
    const btnDisconnectGoogle = document.getElementById('btnDisconnectGoogle');
    const connectedGoogleEmail = document.getElementById('connectedGoogleEmail');
    const oauthUnavailable = document.getElementById('oauthUnavailable');

    // Step 2: Folder Selection (scope-aware)
    const pickerFlowArea = document.getElementById('pickerFlowArea');
    const legacyUrlFlowArea = document.getElementById('legacyUrlFlowArea');
    const btnOpenPicker = document.getElementById('btnOpenPicker');
    const pickerSelectedFolder = document.getElementById('pickerSelectedFolder');
    const pickerFolderName = document.getElementById('pickerFolderName');
    const btnChangePicker = document.getElementById('btnChangePicker');
    const folderUrlInput = document.getElementById('driveFolderUrl');

    // Action Buttons
    const btnVerify = document.getElementById('btnVerifyFolder');
    const btnTestUpload = document.getElementById('btnTestUpload');
    const btnVerifyAndTest = document.getElementById('btnVerifyAndTest');
    const verifyArea = document.getElementById('verifyResultArea');


    // --- Helpers ---
    function showAlert(msg, type = 'danger') {
        if (!msg) { alertArea.innerHTML = ''; return; }
        alertArea.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show">
            ${msg}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>`;
    }

    function setCheckmark(el, status) {
        if (!el) return;
        if (status === 'yes') {
            el.innerHTML = '<span class="badge bg-success rounded-pill me-2" style="width: 65px;">Done</span>';
        } else if (status === 'no') {
            el.innerHTML = '<span class="badge bg-danger rounded-pill me-2" style="width: 65px;">Action</span>';
        } else {
            el.innerHTML = '<span class="badge bg-secondary rounded-pill me-2" style="width: 65px;">Pending</span>';
        }
    }

    function isLegacyScope() {
        return oauthScope === null || oauthScope === 'drive';
    }

    function resetVerification() {
        verifiedFolderId = null;
        verifiedFolderName = null;
        connectionVerified = false;
        btnTestUpload.classList.add('hidden');
        btnVerifyAndTest.classList.add('hidden');
        btnSave.disabled = true;
        verifyArea.classList.add('hidden');
        verifyArea.innerHTML = '';

        setCheckmark(chkFolderSelected, 'pending');
        setCheckmark(chkConnectionVerified, 'pending');
    }

    function updateSaveButtonState() {
        if (currentProvider === 'local') {
            btnSave.disabled = false;
        } else {
            btnSave.disabled = !(driveConnected && verifiedFolderId && connectionVerified);
        }
    }

    function updateProviderUI() {
        // Update toggle cards
        if (currentProvider === 'local') {
            providerCardLocal.style.border = '2px solid var(--bs-primary)';
            providerCardLocal.style.boxShadow = '0 0 0 3px rgba(13, 110, 253, 0.15)';
            providerCardDrive.style.border = '2px solid transparent';
            providerCardDrive.style.boxShadow = '';
            localBadge.className = 'badge bg-primary rounded-pill';
            localBadge.textContent = 'Active';
            driveBadge.className = 'badge bg-secondary rounded-pill';
            driveBadge.textContent = 'Select';

            statusProvider.textContent = 'Local Storage';
            localStatusSection.classList.remove('hidden');
            driveDetailedStatus.classList.add('hidden');
            driveConfigCard.classList.add('hidden');
        } else {
            providerCardDrive.style.border = '2px solid var(--bs-primary)';
            providerCardDrive.style.boxShadow = '0 0 0 3px rgba(13, 110, 253, 0.15)';
            providerCardLocal.style.border = '2px solid transparent';
            providerCardLocal.style.boxShadow = '';
            driveBadge.className = 'badge bg-primary rounded-pill';
            driveBadge.textContent = 'Active';
            localBadge.className = 'badge bg-secondary rounded-pill';
            localBadge.textContent = 'Select';

            statusProvider.textContent = 'Google Drive';
            localStatusSection.classList.add('hidden');
            driveDetailedStatus.classList.remove('hidden');
            driveConfigCard.classList.remove('hidden');
        }

        updateSaveButtonState();
    }

    function updateFolderSelectionUI() {
        // Show the right folder-selection flow based on scope
        if (isLegacyScope()) {
            // Legacy: paste URL flow
            pickerFlowArea.classList.add('hidden');
            legacyUrlFlowArea.classList.remove('hidden');
            btnVerify.classList.remove('hidden');
            btnVerifyAndTest.classList.add('hidden');

            if (driveConnected) {
                folderUrlInput.disabled = false;
            }
        } else {
            // New: Picker flow
            pickerFlowArea.classList.remove('hidden');
            legacyUrlFlowArea.classList.add('hidden');
            btnVerify.classList.add('hidden');
            btnTestUpload.classList.add('hidden');
            // btnVerifyAndTest shown after folder selected
        }
    }


    // --- Core Logic ---

    // 1. Load Settings
    async function loadSettings() {
        try {
            const data = await apiClient.fetch('/settings/storage');

            currentProvider = data.storage_provider || 'local';
            driveConnected = data.google_drive_connected;
            oauthScope = data.google_oauth_scope;
            pickerApiKey = data.google_picker_api_key;
            googleClientId = data.google_client_id;

            // Update connection state
            if (driveConnected) {
                setCheckmark(chkGoogleConnected, 'yes');
                googleNotConnected.classList.add('hidden');
                googleConnected.classList.remove('hidden');
                connectedGoogleEmail.textContent = data.google_user_email || 'Unknown';
            } else {
                setCheckmark(chkGoogleConnected, 'no');
                googleNotConnected.classList.remove('hidden');
                googleConnected.classList.add('hidden');
            }

            // Folder state
            if (data.folder_url_saved && data.drive_folder_id) {
                verifiedFolderId = data.drive_folder_id;
                verifiedFolderName = data.drive_folder_name;
                setCheckmark(chkFolderSelected, 'yes');

                if (isLegacyScope()) {
                    folderUrlInput.value = `https://drive.google.com/drive/folders/${data.drive_folder_id}`;
                } else {
                    pickerSelectedFolder.classList.remove('hidden');
                    pickerFolderName.textContent = data.drive_folder_name || data.drive_folder_id;
                }

                if (data.last_successful_upload_at) {
                    setCheckmark(chkConnectionVerified, 'yes');
                    connectionVerified = true;
                } else {
                    setCheckmark(chkConnectionVerified, 'no');
                }
            } else {
                setCheckmark(chkFolderSelected, 'pending');
                setCheckmark(chkConnectionVerified, 'pending');
                folderUrlInput.value = '';
                pickerSelectedFolder.classList.add('hidden');
                pickerFolderName.textContent = '';
            }

            // History
            histLastVerified.textContent = data.last_verified_at ? new Date(data.last_verified_at).toLocaleString() : 'Never';
            histLastUpload.textContent = data.last_successful_upload_at ? new Date(data.last_successful_upload_at).toLocaleString() : 'Never';

            // Check OAuth availability
            checkOAuthAvailability();

            // Check local storage durability
            checkLocalDurability();

            // Update UI
            updateProviderUI();
            updateFolderSelectionUI();
            updateSaveButtonState();

        } catch (err) {
            showAlert("Failed to load settings: " + err.message);
        }
    }

    // 2. Check OAuth Availability
    async function checkOAuthAvailability() {
        try {
            const data = await apiClient.fetch('/settings/storage/drive-availability');
            if (!data.google_drive_available) {
                oauthUnavailable.classList.remove('hidden');
                btnConnectGoogle.disabled = true;
            } else {
                oauthUnavailable.classList.add('hidden');
                btnConnectGoogle.disabled = false;
            }
        } catch (err) {
            // Silently fail
        }
    }

    // 3. Check local storage durability
    async function checkLocalDurability() {
        try {
            const data = await apiClient.fetch('/settings/storage/local-info');
            if (data.is_persistent_warning) {
                localDurabilityWarning.classList.remove('hidden');
            } else {
                localDurabilityWarning.classList.add('hidden');
            }
        } catch (err) {
            // Silently fail
        }
    }

    // --- Provider Toggle ---
    providerCardLocal.addEventListener('click', () => {
        currentProvider = 'local';
        updateProviderUI();
    });

    providerCardDrive.addEventListener('click', () => {
        currentProvider = 'google_drive';
        updateProviderUI();
        updateFolderSelectionUI();
    });

    // --- Google OAuth Connect ---
    btnConnectGoogle.addEventListener('click', async () => {
        btnConnectGoogle.disabled = true;
        btnConnectGoogle.textContent = 'Connecting...';

        try {
            const data = await apiClient.fetch('/settings/storage/oauth/start');
            window.location.href = data.auth_url;
        } catch (err) {
            showAlert('Failed to start Google connection: ' + err.message);
            btnConnectGoogle.disabled = false;
            btnConnectGoogle.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.748L12.545,10.239z"/></svg>
                Connect Google Drive`;
        }
    });

    // --- Google OAuth Disconnect ---
    btnDisconnectGoogle.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to disconnect Google Drive?')) return;

        btnDisconnectGoogle.disabled = true;
        btnDisconnectGoogle.textContent = 'Disconnecting...';

        try {
            await apiClient.fetch('/settings/storage/oauth/disconnect', { method: 'POST' });
            showAlert('Google Drive disconnected.', 'success');
            resetVerification();
            await loadSettings();
        } catch (err) {
            showAlert('Failed to disconnect: ' + err.message);
        } finally {
            btnDisconnectGoogle.disabled = false;
            btnDisconnectGoogle.textContent = 'Disconnect';
        }
    });

    // --- Google Picker ---
    function loadPickerApi() {
        return new Promise((resolve, reject) => {
            if (pickerApiLoaded) { resolve(); return; }
            if (typeof gapi === 'undefined') { reject(new Error('Google API script not loaded')); return; }

            gapi.load('client:picker', {
                callback: () => { pickerApiLoaded = true; resolve(); },
                onerror: () => reject(new Error('Failed to load Google Picker API')),
            });
        });
    }

    async function openPicker() {
        if (!pickerApiKey) {
            showAlert('Google Picker API key is not configured on this server. Contact the administrator.');
            return;
        }

        try {
            // Load the Picker API if not already loaded
            await loadPickerApi();

            // Get a short-lived access token from the backend
            const tokenData = await apiClient.fetch('/settings/storage/picker-token', { method: 'POST' });

            // Build and display the Picker
            const folderView = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
                .setSelectFolderEnabled(true)
                .setIncludeFolders(true)
                .setMimeTypes('application/vnd.google-apps.folder');

            // Shared Drives view
            const sharedDriveView = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
                .setSelectFolderEnabled(true)
                .setIncludeFolders(true)
                .setEnableDrives(true)
                .setMimeTypes('application/vnd.google-apps.folder');

            const picker = new google.picker.PickerBuilder()
                .setTitle('Select a folder for SPARSH report cards')
                .addView(folderView)
                .addView(sharedDriveView)
                .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
                .setOAuthToken(tokenData.access_token)
                .setDeveloperKey(pickerApiKey)
                .setCallback(handlePickerResult)
                .build();

            picker.setVisible(true);

        } catch (err) {
            showAlert('Failed to open folder picker: ' + err.message);
        }
    }

    async function handlePickerResult(data) {
        if (data.action === google.picker.Action.PICKED) {
            const doc = data.docs[0];
            const folderId = doc.id;
            const folderName = doc.name;

            // Show selected folder immediately
            pickerSelectedFolder.classList.remove('hidden');
            pickerFolderName.textContent = folderName;
            setCheckmark(chkFolderSelected, 'yes');

            // Send to backend for storage + test upload
            try {
                const result = await apiClient.fetch('/settings/storage/select-folder', {
                    method: 'POST',
                    body: JSON.stringify({ folder_id: folderId, folder_name: folderName }),
                });

                verifyArea.classList.remove('hidden');

                if (result.success) {
                    verifiedFolderId = result.folder_id;
                    verifiedFolderName = result.folder_name;
                    connectionVerified = true;
                    setCheckmark(chkConnectionVerified, 'yes');
                    histLastVerified.textContent = new Date().toLocaleString();
                    histLastUpload.textContent = new Date().toLocaleString();

                    verifyArea.innerHTML = `
                        <div class="alert alert-success">
                            <strong>✓ ${result.message}</strong>
                        </div>`;
                } else {
                    setCheckmark(chkConnectionVerified, 'no');
                    verifyArea.innerHTML = `
                        <div class="alert alert-danger">
                            <strong>✗ ${result.message}</strong>
                        </div>`;
                }

                updateSaveButtonState();
            } catch (err) {
                verifyArea.classList.remove('hidden');
                verifyArea.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
            }
        }
    }

    btnOpenPicker.addEventListener('click', openPicker);
    btnChangePicker.addEventListener('click', () => {
        pickerSelectedFolder.classList.add('hidden');
        resetVerification();
        openPicker();
    });

    // --- Legacy URL Flow ---
    folderUrlInput.addEventListener('input', () => {
        resetVerification();
    });

    // Legacy Verify Folder
    btnVerify.addEventListener('click', async () => {
        const url = folderUrlInput.value.trim();
        if (!url) {
            showAlert('Please enter a Google Drive folder URL.');
            return;
        }

        btnVerify.disabled = true;
        btnVerify.textContent = 'Verifying...';
        resetVerification();

        try {
            const data = await apiClient.fetch('/settings/storage/verify', {
                method: 'POST',
                body: JSON.stringify({ folder_url: url }),
            });

            verifyArea.classList.remove('hidden');

            if (data.verified) {
                verifiedFolderId = data.folder_id;
                verifiedFolderName = data.folder_name;
                setCheckmark(chkFolderSelected, 'yes');
                histLastVerified.textContent = new Date().toLocaleString();

                verifyArea.innerHTML = `
                    <div class="alert alert-success">
                        <strong>✓ Folder Verified</strong><br>
                        <span class="text-muted">Folder Name:</span> <strong>${data.folder_name}</strong>
                    </div>`;
                btnTestUpload.classList.remove('hidden');
            } else {
                setCheckmark(chkFolderSelected, 'no');
                verifyArea.innerHTML = `
                    <div class="alert alert-danger">
                        <strong>✗ Verification Failed</strong><br>
                        <p class="mb-0">${data.message}</p>
                    </div>`;
            }
        } catch (err) {
            verifyArea.classList.remove('hidden');
            verifyArea.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
        } finally {
            btnVerify.disabled = false;
            btnVerify.textContent = 'Verify Folder';
        }
    });

    // Legacy Test Upload
    btnTestUpload.addEventListener('click', async () => {
        const url = folderUrlInput.value.trim();
        btnTestUpload.disabled = true;
        btnTestUpload.textContent = 'Testing...';

        try {
            const data = await apiClient.fetch('/settings/storage/test-upload', {
                method: 'POST',
                body: JSON.stringify({ folder_url: url }),
            });

            if (data.success) {
                connectionVerified = true;
                setCheckmark(chkConnectionVerified, 'yes');
                histLastUpload.textContent = new Date().toLocaleString();
                updateSaveButtonState();

                verifyArea.innerHTML += `
                    <div class="alert alert-success mt-2">
                        <strong>✓ Test Upload Passed</strong><br>
                        ${data.message}
                    </div>`;
                btnTestUpload.classList.add('hidden');
            } else {
                setCheckmark(chkConnectionVerified, 'no');
                verifyArea.innerHTML += `
                    <div class="alert alert-warning mt-2">
                        <strong>✗ Test Upload Failed</strong><br>
                        <p class="mb-0">${data.message}</p>
                    </div>`;
            }
        } catch (err) {
            verifyArea.innerHTML += `<div class="alert alert-danger mt-2">${err.message}</div>`;
        } finally {
            btnTestUpload.disabled = false;
            btnTestUpload.textContent = 'Test Upload';
        }
    });

    // --- Save Settings ---
    btnSave.addEventListener('click', async () => {
        btnSave.disabled = true;
        btnSave.textContent = 'Saving...';

        const payload = {
            storage_provider: currentProvider,
            drive_folder_id: currentProvider === 'google_drive' ? verifiedFolderId : null,
        };

        try {
            await apiClient.fetch('/settings/storage', {
                method: 'PUT',
                body: JSON.stringify(payload),
            });

            showAlert('Storage settings saved successfully.', 'success');
            await loadSettings();
        } catch (err) {
            showAlert('Failed to save: ' + err.message);
            btnSave.disabled = false;
        } finally {
            btnSave.textContent = 'Save Settings';
        }
    });

    // --- Handle OAuth Redirect Results ---
    function handleOAuthRedirect() {
        const params = new URLSearchParams(window.location.search);

        if (params.has('oauth_success')) {
            const email = params.get('email') || '';
            showAlert(`Successfully connected Google Drive as <strong>${decodeURIComponent(email)}</strong>.`, 'success');
            // Auto-switch to Google Drive provider after successful connect
            currentProvider = 'google_drive';
            history.replaceState(null, '', '/storage-settings');
        } else if (params.has('oauth_error')) {
            const error = params.get('oauth_error');
            let msg = 'Google Drive connection failed.';
            if (error === 'access_denied') msg = 'Google Drive connection was cancelled.';
            else if (error === 'no_refresh_token') msg = 'Failed to obtain a refresh token. Please try again.';
            else if (error === 'token_exchange_failed') msg = 'Failed to exchange authorization code. Please try again.';
            showAlert(msg);
            history.replaceState(null, '', '/storage-settings');
        }
    }

    // --- Init ---
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class' && !viewStorage.classList.contains('hidden')) {
                loadSettings();
            }
        });
    });
    observer.observe(viewStorage, { attributes: true });

    if (!viewStorage.classList.contains('hidden')) {
        loadSettings();
    }

    handleOAuthRedirect();
});
