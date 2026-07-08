/**
 * School Result Analysis System
 * API Client & Authentication Wrapper
 */

const API_BASE_URL = '/api/v1';

const apiClient = {
    /**
     * Get the stored JWT token
     */
    getToken: () => localStorage.getItem('token'),

    /**
     * Set the stored JWT token
     */
    setToken: (token) => localStorage.setItem('token', token),

    /**
     * Clear all stored auth data
     */
    clearAuth: () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user_role');
        localStorage.removeItem('user_name');
    },

    /**
     * Generic fetch wrapper that adds Authorization header and handles 401s
     */
    async fetch(endpoint, options = {}) {
        const token = this.getToken();
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const config = {
            ...options,
            headers
        };

        try {
            const response = await fetch(`${API_BASE_URL}${endpoint}`, config);

            // Handle Unauthorized (token expired or invalid)
            if (response.status === 401) {
                this.clearAuth();
                window.location.href = '/index.html';
                throw new Error('Unauthorized');
            }

            const data = await response.json().catch(() => null);

            if (!response.ok) {
                const errorMsg = data?.detail || response.statusText;
                throw new Error(errorMsg);
            }

            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    },

    /**
     * Specialized wrapper for form url-encoded data (used for login)
     */
    async fetchForm(endpoint, formData) {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'POST',
            body: new URLSearchParams(formData),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const data = await response.json().catch(() => null);

        if (!response.ok) {
            const errorMsg = data?.detail || response.statusText;
            throw new Error(errorMsg);
        }

        return data;
    },

    /**
     * Specialized wrapper for raw body payloads (e.g. FormData for file uploads).
     * Does NOT set Content-Type header so the browser can automatically set it
     * with the correct multipart boundary.
     */
    async fetchRaw(endpoint, options = {}) {
        const token = this.getToken();
        const headers = { ...options.headers };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        
        const config = { ...options, headers };
        
        try {
            const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
            if (response.status === 401) {
                this.clearAuth();
                window.location.href = '/index.html';
                throw new Error('Unauthorized');
            }
            const data = await response.json().catch(() => null);
            if (!response.ok) throw new Error(data?.detail || response.statusText);
            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    },

    /**
     * Specialized wrapper for authenticated file downloads.
     */
    async downloadFile(endpoint, defaultFilename = 'download') {
        const token = this.getToken();
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        try {
            const response = await fetch(`${API_BASE_URL}${endpoint}`, { headers });
            if (response.status === 401) {
                this.clearAuth();
                window.location.href = '/index.html';
                throw new Error('Unauthorized');
            }
            if (!response.ok) {
                const data = await response.json().catch(() => null);
                throw new Error(data?.detail || response.statusText);
            }

            const blob = await response.blob();
            let actualFilename = defaultFilename;
            const disposition = response.headers.get('Content-Disposition');
            if (disposition && disposition.includes('filename=')) {
                const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
                if (matches != null && matches[1]) {
                    actualFilename = matches[1].replace(/['"]/g, '');
                }
            }

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = actualFilename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error('Download Error:', error);
            throw error;
        }
    }
};
