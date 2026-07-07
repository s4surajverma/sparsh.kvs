"""
SPARSH - Storage Settings Schemas

Pydantic DTOs for the Storage Settings admin workflow.
Supports Local Storage and OAuth-based Google Drive integration
with per-school scope tracking (drive vs drive.file).
"""

from datetime import datetime
from pydantic import BaseModel


class StorageSettingsResponse(BaseModel):
    """Current storage configuration returned to the Admin."""
    storage_provider: str  # "local" or "google_drive"
    local_storage_available: bool = True
    google_drive_connected: bool = False
    google_user_email: str | None = None
    google_oauth_scope: str | None = None  # NULL/"drive" = legacy, "drive.file" = new
    folder_url_saved: bool = False
    drive_folder_id: str | None = None
    drive_folder_name: str | None = None
    google_picker_api_key: str | None = None  # Exposed for frontend Picker init
    google_client_id: str | None = None  # Exposed for frontend Picker appId
    last_verified_at: datetime | None = None
    last_successful_upload_at: datetime | None = None
    updated_at: datetime | None = None


class OAuthStartResponse(BaseModel):
    """Response containing the Google OAuth authorization URL."""
    auth_url: str


class OAuthCallbackResponse(BaseModel):
    """Result of processing the OAuth callback."""
    success: bool
    google_user_email: str | None = None
    message: str


class StorageVerifyRequest(BaseModel):
    """Request to verify a Google Drive folder URL."""
    folder_url: str


class StorageVerifyResponse(BaseModel):
    """Result of a folder verification attempt."""
    verified: bool
    folder_id: str | None = None
    folder_name: str | None = None
    message: str


class StorageTestUploadResponse(BaseModel):
    """Result of a test upload attempt."""
    success: bool
    message: str


class StorageSaveRequest(BaseModel):
    """Request to save storage settings."""
    storage_provider: str  # "local" or "google_drive"
    drive_folder_id: str | None = None


class DriveAvailabilityResponse(BaseModel):
    """Whether Google Drive integration is available on this server."""
    google_drive_available: bool
    message: str | None = None


# --- Picker-Related Schemas ---

class PickerTokenResponse(BaseModel):
    """
    Short-lived access token for the Google Picker widget.

    SECURITY NOTE: This is the one intentional exception to the
    'never expose credentials to frontend' rule. This token is:
    - Derived from the admin's refresh token (scoped to drive.file)
    - Short-lived (~3600s, Google's default expiry)
    - Returned once over HTTPS, never persisted client-side
    - Only accessible to authenticated admin users
    """
    access_token: str


class FolderSelectRequest(BaseModel):
    """Folder ID and name selected via Google Picker."""
    folder_id: str
    folder_name: str


class FolderSelectResponse(BaseModel):
    """Result of selecting a folder via Picker and running a test upload."""
    success: bool
    folder_id: str | None = None
    folder_name: str | None = None
    message: str


# --- Verify-and-Test Merged Schema ---

class StorageVerifyAndTestResponse(BaseModel):
    """Combined result of folder verification and test upload."""
    verified: bool
    test_passed: bool
    folder_id: str | None = None
    folder_name: str | None = None
    message: str


# --- Local Storage Info ---

class LocalStorageInfoResponse(BaseModel):
    """Information about the local storage configuration."""
    storage_dir: str
    is_persistent_warning: bool  # True = warn about ephemeral storage
    message: str
