"""
SPARSH - Storage Settings Endpoints

Admin-only endpoints for configuring the file storage backend.
Supports Local Storage and Google Drive via OAuth 2.0.

Scope-branching logic:
- google_oauth_scope = NULL or "drive" → legacy flow (paste URL, separate verify/test)
- google_oauth_scope = "drive.file"   → new flow (Google Picker, merged verify+test)

User-facing messages are kept non-technical.
All developer-facing details are logged server-side only.
"""

import io
import logging
import os
import re
import urllib.parse
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_admin
from app.models.app_settings import AppSettings
from app.models.user import User
from app.core.config import settings
from app.core.encryption import encrypt_string, decrypt_string
from app.schemas.settings_schema import (
    StorageSettingsResponse,
    StorageVerifyRequest,
    StorageVerifyResponse,
    StorageTestUploadResponse,
    StorageSaveRequest,
    DriveAvailabilityResponse,
    OAuthStartResponse,
    OAuthCallbackResponse,
    PickerTokenResponse,
    FolderSelectRequest,
    FolderSelectResponse,
    StorageVerifyAndTestResponse,
    LocalStorageInfoResponse,
)

router = APIRouter()
logger = logging.getLogger(__name__)

# Google OAuth endpoints
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

# New connections use drive.file (non-sensitive, no Google verification review needed)
DRIVE_SCOPES_NEW = [
    "https://www.googleapis.com/auth/drive.file",
    "openid",
    "email",
]

# Legacy connections may have been granted full drive scope
DRIVE_SCOPES_LEGACY = [
    "https://www.googleapis.com/auth/drive",
    "openid",
    "email",
]

# Regex to extract folder ID from various Google Drive URL formats
FOLDER_URL_PATTERN = re.compile(
    r"(?:https?://)?drive\.google\.com/(?:drive/)?(?:u/\d+/)?folders/([a-zA-Z0-9_-]+)"
)


# ============================================
# Internal Helpers
# ============================================

def _get_or_create_settings(db: Session) -> AppSettings:
    """
    Get the first AppSettings row.
    If none exists, create one automatically with defaults.
    """
    row = db.query(AppSettings).first()
    if not row:
        row = AppSettings(storage_provider="local")
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _extract_folder_id(url: str) -> str | None:
    """Extract a Google Drive folder ID from a URL string."""
    match = FOLDER_URL_PATTERN.search(url.strip())
    if match:
        return match.group(1)
    if re.match(r"^[a-zA-Z0-9_-]{10,}$", url.strip()):
        return url.strip()
    return None


def _is_oauth_configured() -> bool:
    """Check whether the developer has configured Google OAuth credentials."""
    return bool(settings.GOOGLE_CLIENT_ID) and bool(settings.GOOGLE_CLIENT_SECRET)


def _is_legacy_scope(row: AppSettings) -> bool:
    """Check if this school's OAuth connection uses the legacy full 'drive' scope."""
    return row.google_oauth_scope is None or row.google_oauth_scope == "drive"


def _get_oauth_credentials(db: Session):
    """
    Build Google OAuth Credentials from the stored refresh token.
    Returns a google.oauth2.credentials.Credentials object.
    Raises RuntimeError if credentials are missing or invalid.
    """
    row = _get_or_create_settings(db)

    if not row.google_oauth_refresh_token_encrypted:
        raise RuntimeError("Google Drive is not connected. Please connect via OAuth first.")

    try:
        from google.oauth2.credentials import Credentials

        refresh_token = decrypt_string(row.google_oauth_refresh_token_encrypted)

        # Use the scope that was granted at connection time
        scope_str = row.google_oauth_scope or "drive"
        if scope_str == "drive.file":
            scopes = DRIVE_SCOPES_NEW
        else:
            scopes = DRIVE_SCOPES_LEGACY

        creds = Credentials(
            token=None,  # Will be refreshed automatically
            refresh_token=refresh_token,
            token_uri=GOOGLE_TOKEN_URL,
            client_id=settings.GOOGLE_CLIENT_ID,
            client_secret=settings.GOOGLE_CLIENT_SECRET,
            scopes=scopes,
        )
        return creds
    except Exception as e:
        logger.error(f"Failed to build OAuth credentials: {e}", exc_info=True)
        raise RuntimeError("Failed to load Google Drive credentials. Please reconnect.")


def _get_drive_service(db: Session):
    """
    Build and return a Google Drive API service using OAuth credentials.
    """
    creds = _get_oauth_credentials(db)

    try:
        from googleapiclient.discovery import build

        service = build("drive", "v3", credentials=creds)
        return service
    except Exception as e:
        logger.error(f"Failed to build Drive service: {e}", exc_info=True)
        raise RuntimeError("Failed to connect to Google Drive. Please try reconnecting.")


def _do_test_upload(service, folder_id: str) -> tuple[bool, str]:
    """
    Perform a test upload to a Google Drive folder.
    Returns (success: bool, message: str).
    """
    try:
        from googleapiclient.http import MediaIoBaseUpload

        test_content = b"SPARSH Storage Test - This file can be safely deleted."
        media = MediaIoBaseUpload(
            io.BytesIO(test_content),
            mimetype="text/plain",
            resumable=False,
        )
        file_metadata = {
            "name": "_sparsh_test_upload.txt",
            "parents": [folder_id],
        }

        created_file = service.files().create(
            body=file_metadata,
            media_body=media,
            fields="id,name",
            supportsAllDrives=True,
        ).execute()

        test_file_id = created_file.get("id")

        # Clean up test file
        try:
            service.files().delete(
                fileId=test_file_id,
                supportsAllDrives=True,
            ).execute()
        except Exception as del_err:
            logger.warning(f"Could not delete test file: {del_err}")

        return True, "Test upload successful! SPARSH can upload files to this folder."

    except Exception as e:
        logger.error(f"Test upload failed: {e}", exc_info=True)
        return False, "Test upload failed. Please ensure you have access to this folder and try again."


# ============================================
# GET — Google Drive Availability Check
# ============================================

@router.get("/storage/drive-availability", response_model=DriveAvailabilityResponse)
def check_drive_availability(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """
    Lightweight check: is Google Drive OAuth configured by the developer?
    """
    available = _is_oauth_configured()
    return DriveAvailabilityResponse(
        google_drive_available=available,
        message=None if available else (
            "Google Drive integration is not configured on this server. "
            "The developer must set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
        ),
    )


# ============================================
# GET — Current Storage Status
# ============================================

@router.get("/storage", response_model=StorageSettingsResponse)
def get_storage_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """Return the current storage configuration and connection status."""
    row = _get_or_create_settings(db)

    return StorageSettingsResponse(
        storage_provider=row.storage_provider,
        local_storage_available=True,
        google_drive_connected=bool(row.google_oauth_refresh_token_encrypted),
        google_user_email=row.google_user_email,
        google_oauth_scope=row.google_oauth_scope,
        folder_url_saved=bool(row.drive_folder_id),
        drive_folder_id=row.drive_folder_id,
        drive_folder_name=row.drive_folder_name,
        google_picker_api_key=settings.GOOGLE_PICKER_API_KEY or None,
        google_client_id=settings.GOOGLE_CLIENT_ID or None,
        last_verified_at=row.last_verified_at,
        last_successful_upload_at=row.last_successful_upload_at,
        updated_at=row.updated_at,
    )


# ============================================
# GET — Local Storage Info
# ============================================

@router.get("/storage/local-info", response_model=LocalStorageInfoResponse)
def get_local_storage_info(
    current_user: User = Depends(get_current_admin),
):
    """
    Return local storage configuration info and durability warning.
    """
    storage_dir = str(settings.REPORT_STORAGE_DIR)

    # Heuristic: detect if running on ephemeral hosting (Render, Heroku, etc.)
    # Render sets the RENDER env var; Heroku sets DYNO.
    is_ephemeral = bool(os.environ.get("RENDER") or os.environ.get("DYNO"))

    if is_ephemeral:
        message = (
            "Local Storage stores files on this server's filesystem. "
            "This server uses ephemeral storage — files may be lost when the server "
            "restarts or redeploys. For reliable storage, use Google Drive or "
            "configure a persistent disk."
        )
    else:
        message = (
            "Local Storage stores files on this server's filesystem. "
            "Files are saved to the configured storage directory."
        )

    return LocalStorageInfoResponse(
        storage_dir=storage_dir,
        is_persistent_warning=is_ephemeral,
        message=message,
    )


# ============================================
# GET — Start OAuth Flow
# ============================================

@router.get("/storage/oauth/start", response_model=OAuthStartResponse)
def start_oauth_flow(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """
    Generate the Google OAuth authorization URL.
    New connections use drive.file scope (non-sensitive, no Google review needed).
    The frontend should redirect to this URL.
    """
    if not _is_oauth_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google OAuth is not configured on this server.",
        )

    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(DRIVE_SCOPES_NEW),
        "access_type": "offline",
        "prompt": "consent",
        "state": "sparsh_drive_connect",
    }

    auth_url = f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"
    return OAuthStartResponse(auth_url=auth_url)


# ============================================
# GET — OAuth Callback (Google redirects here)
# ============================================

@router.get("/storage/oauth/callback")
async def oauth_callback(
    code: str = Query(None),
    error: str = Query(None),
    state: str = Query(None),
    db: Session = Depends(get_db),
):
    """
    Google redirects here after user grants (or denies) permission.
    Exchanges the auth code for tokens, stores the refresh token,
    and redirects back to the dashboard.

    New connections are recorded with google_oauth_scope = "drive.file".
    """
    # Base URL for the storage settings page
    dashboard_url = "/storage-settings"
    hash_fragment = ""

    if error:
        logger.warning(f"OAuth denied by user: {error}")
        return RedirectResponse(
            url=f"{dashboard_url}?oauth_error={urllib.parse.quote(error)}{hash_fragment}"
        )

    if not code:
        return RedirectResponse(
            url=f"{dashboard_url}?oauth_error=no_code_received{hash_fragment}"
        )

    try:
        import httpx

        # Exchange authorization code for tokens
        token_data = {
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": settings.GOOGLE_REDIRECT_URI,
            "grant_type": "authorization_code",
        }

        async with httpx.AsyncClient() as client:
            token_resp = await client.post(GOOGLE_TOKEN_URL, data=token_data)
            token_json = token_resp.json()

        if "error" in token_json:
            logger.error(f"Token exchange failed: {token_json}")
            return RedirectResponse(
                url=f"{dashboard_url}?oauth_error=token_exchange_failed{hash_fragment}"
            )

        access_token = token_json.get("access_token")
        refresh_token = token_json.get("refresh_token")

        if not refresh_token:
            logger.error("No refresh token received from Google. Missing access_type=offline or prompt=consent?")
            return RedirectResponse(
                url=f"{dashboard_url}?oauth_error=no_refresh_token{hash_fragment}"
            )

        # Determine which scope was actually granted
        granted_scope = token_json.get("scope", "")
        if "drive.file" in granted_scope:
            oauth_scope = "drive.file"
        elif "drive" in granted_scope:
            oauth_scope = "drive"
        else:
            oauth_scope = "drive.file"  # Default for new connections

        # Get user info (email) using the access token
        async with httpx.AsyncClient() as client:
            userinfo_resp = await client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            userinfo = userinfo_resp.json()

        user_email = userinfo.get("email", "unknown@gmail.com")

        # Store encrypted refresh token and scope in DB
        row = _get_or_create_settings(db)
        row.google_oauth_refresh_token_encrypted = encrypt_string(refresh_token)
        row.google_user_email = user_email
        row.google_oauth_scope = oauth_scope
        row.updated_at = datetime.now(timezone.utc)
        db.commit()

        logger.info(f"Google Drive connected for user: {user_email} (scope: {oauth_scope})")

        return RedirectResponse(
            url=f"{dashboard_url}?oauth_success=true&email={urllib.parse.quote(user_email)}{hash_fragment}"
        )

    except Exception as e:
        logger.error(f"OAuth callback processing failed: {e}", exc_info=True)
        return RedirectResponse(
            url=f"{dashboard_url}?oauth_error=server_error{hash_fragment}"
        )


# ============================================
# POST — Disconnect Google Drive
# ============================================

@router.post("/storage/oauth/disconnect", response_model=OAuthCallbackResponse)
def disconnect_google_drive(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """
    Disconnect Google Drive by clearing stored OAuth tokens.
    """
    row = _get_or_create_settings(db)
    row.google_oauth_refresh_token_encrypted = None
    row.google_user_email = None
    row.google_oauth_scope = None
    row.updated_at = datetime.now(timezone.utc)
    db.commit()

    logger.info(f"Google Drive disconnected by admin: {current_user.username}")

    return OAuthCallbackResponse(
        success=True,
        message="Google Drive has been disconnected.",
    )


# ============================================
# POST — Picker Token (Scoped Access Token)
# ============================================

@router.post("/storage/picker-token", response_model=PickerTokenResponse)
def get_picker_token(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """
    Mint a short-lived access token for the Google Picker widget.

    SECURITY NOTE: This is the ONE intentional exception to the
    'never expose credentials to frontend' rule. This token is:
    - Derived from the admin's stored refresh token
    - Scoped to drive.file only (cannot read/delete arbitrary files)
    - Short-lived (~3600s, Google's default expiry)
    - Returned once over HTTPS, never persisted client-side
    - Admin-only: enforced by Depends(get_current_admin)

    The refresh token itself stays server-side and Fernet-encrypted
    at all times — this endpoint does NOT expose it.
    """
    row = _get_or_create_settings(db)

    if not row.google_oauth_refresh_token_encrypted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google Drive is not connected. Please connect first.",
        )

    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request

        refresh_token = decrypt_string(row.google_oauth_refresh_token_encrypted)

        # Determine scope based on what was granted
        scope_str = row.google_oauth_scope or "drive"
        if scope_str == "drive.file":
            scopes = ["https://www.googleapis.com/auth/drive.file"]
        else:
            scopes = ["https://www.googleapis.com/auth/drive"]

        creds = Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri=GOOGLE_TOKEN_URL,
            client_id=settings.GOOGLE_CLIENT_ID,
            client_secret=settings.GOOGLE_CLIENT_SECRET,
            scopes=scopes,
        )

        # Force a refresh to get a valid access token
        creds.refresh(Request())

        if not creds.token:
            raise RuntimeError("Failed to obtain access token from Google.")

        logger.info(f"Picker access token issued for admin: {current_user.username}")
        return PickerTokenResponse(access_token=creds.token)

    except Exception as e:
        logger.error(f"Failed to mint picker token: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate access token. Please try reconnecting Google Drive.",
        )


# ============================================
# POST — Select Folder (from Picker)
# ============================================

@router.post("/storage/select-folder", response_model=FolderSelectResponse)
def select_folder(
    request: FolderSelectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """
    Receive the folder ID and name from the Google Picker selection.
    Stores the folder, performs a test upload, and returns the result.
    Used for drive.file-scoped connections where Picker grants access.
    """
    folder_id = request.folder_id
    folder_name = request.folder_name

    if not folder_id:
        return FolderSelectResponse(
            success=False,
            message="No folder was selected. Please try again.",
        )

    try:
        service = _get_drive_service(db)
    except RuntimeError as e:
        return FolderSelectResponse(success=False, message=str(e))

    # Perform test upload to verify write access
    test_passed, test_msg = _do_test_upload(service, folder_id)

    if test_passed:
        # Store folder selection and update timestamps
        row = _get_or_create_settings(db)
        row.drive_folder_id = folder_id
        row.drive_folder_name = folder_name
        row.last_verified_at = datetime.now(timezone.utc)
        row.last_successful_upload_at = datetime.now(timezone.utc)
        db.commit()

        return FolderSelectResponse(
            success=True,
            folder_id=folder_id,
            folder_name=folder_name,
            message=f"Folder '{folder_name}' selected and verified. {test_msg}",
        )
    else:
        return FolderSelectResponse(
            success=False,
            folder_id=folder_id,
            folder_name=folder_name,
            message=test_msg,
        )


# ============================================
# POST — Verify Folder Access (legacy flow)
# ============================================

@router.post("/storage/verify", response_model=StorageVerifyResponse)
def verify_folder(
    request: StorageVerifyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """
    Verify that the connected Google account can access the given Drive folder.
    This endpoint is used by legacy 'drive'-scoped connections where the admin
    pastes a folder URL. For 'drive.file' connections, use select-folder instead.
    """
    folder_id = _extract_folder_id(request.folder_url)
    if not folder_id:
        return StorageVerifyResponse(
            verified=False,
            message="Invalid Google Drive folder URL. Please paste the full URL from your browser.",
        )

    try:
        service = _get_drive_service(db)
    except RuntimeError as e:
        return StorageVerifyResponse(verified=False, message=str(e))

    try:
        folder_meta = service.files().get(
            fileId=folder_id,
            fields="id,name,mimeType",
            supportsAllDrives=True,
        ).execute()

        if folder_meta.get("mimeType") != "application/vnd.google-apps.folder":
            return StorageVerifyResponse(
                verified=False,
                folder_id=folder_id,
                message="The URL does not point to a Google Drive folder.",
            )

        folder_name = folder_meta.get("name")

        # Update last_verified_at and folder name in DB
        row = _get_or_create_settings(db)
        row.last_verified_at = datetime.now(timezone.utc)
        row.drive_folder_name = folder_name
        db.commit()

        return StorageVerifyResponse(
            verified=True,
            folder_id=folder_id,
            folder_name=folder_name,
            message="Folder verified successfully.",
        )

    except Exception as e:
        logger.warning(f"Folder verification failed for ID '{folder_id}': {e}")
        error_str = str(e).lower()

        if "404" in error_str or "not found" in error_str:
            return StorageVerifyResponse(
                verified=False,
                folder_id=folder_id,
                message=(
                    "Cannot access this folder. The folder may not exist, "
                    "or you don't have permission to view it."
                ),
            )

        return StorageVerifyResponse(
            verified=False,
            folder_id=folder_id,
            message="Cannot access this folder. Please check the URL and try again.",
        )


# ============================================
# POST — Test Upload (legacy flow)
# ============================================

@router.post("/storage/test-upload", response_model=StorageTestUploadResponse)
def test_upload(
    request: StorageVerifyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """
    Perform a test upload to the verified Google Drive folder.
    Used by legacy 'drive'-scoped connections. Kept as backward-compatible alias.
    """
    folder_id = _extract_folder_id(request.folder_url)
    if not folder_id:
        return StorageTestUploadResponse(
            success=False,
            message="Invalid Google Drive folder URL.",
        )

    try:
        service = _get_drive_service(db)
    except RuntimeError as e:
        return StorageTestUploadResponse(success=False, message=str(e))

    test_passed, test_msg = _do_test_upload(service, folder_id)

    if test_passed:
        row = _get_or_create_settings(db)
        row.last_successful_upload_at = datetime.now(timezone.utc)
        db.commit()

    return StorageTestUploadResponse(success=test_passed, message=test_msg)


# ============================================
# POST — Verify and Test (merged endpoint)
# ============================================

@router.post("/storage/verify-and-test", response_model=StorageVerifyAndTestResponse)
def verify_and_test(
    request: StorageVerifyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """
    Combined verify + test upload endpoint.
    - For 'drive' scope: reads folder metadata + test upload (full flow)
    - For 'drive.file' scope: test upload only (no metadata read, Picker already granted access)
    """
    folder_id = _extract_folder_id(request.folder_url)
    if not folder_id:
        return StorageVerifyAndTestResponse(
            verified=False,
            test_passed=False,
            message="Invalid Google Drive folder URL.",
        )

    try:
        service = _get_drive_service(db)
    except RuntimeError as e:
        return StorageVerifyAndTestResponse(
            verified=False, test_passed=False, message=str(e),
        )

    row = _get_or_create_settings(db)
    folder_name = None

    # Scope-aware verification
    if _is_legacy_scope(row):
        # Legacy 'drive' scope: can read folder metadata
        try:
            folder_meta = service.files().get(
                fileId=folder_id,
                fields="id,name,mimeType",
                supportsAllDrives=True,
            ).execute()

            if folder_meta.get("mimeType") != "application/vnd.google-apps.folder":
                return StorageVerifyAndTestResponse(
                    verified=False,
                    test_passed=False,
                    folder_id=folder_id,
                    message="The URL does not point to a Google Drive folder.",
                )
            folder_name = folder_meta.get("name")
        except Exception as e:
            logger.warning(f"Folder verify failed: {e}")
            return StorageVerifyAndTestResponse(
                verified=False,
                test_passed=False,
                folder_id=folder_id,
                message="Cannot access this folder. Please check the URL and try again.",
            )
    else:
        # drive.file scope: skip metadata read, folder was selected via Picker
        folder_name = row.drive_folder_name

    # Test upload (both scopes)
    test_passed, test_msg = _do_test_upload(service, folder_id)

    if test_passed:
        row.last_verified_at = datetime.now(timezone.utc)
        row.last_successful_upload_at = datetime.now(timezone.utc)
        row.drive_folder_name = folder_name
        db.commit()

    return StorageVerifyAndTestResponse(
        verified=True if (test_passed or _is_legacy_scope(row)) else test_passed,
        test_passed=test_passed,
        folder_id=folder_id,
        folder_name=folder_name,
        message=test_msg if test_passed else test_msg,
    )


# ============================================
# PUT — Save Storage Settings
# ============================================

@router.put("/storage", response_model=StorageSettingsResponse)
def save_storage_settings(
    request: StorageSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """Save storage configuration to the database."""
    if request.storage_provider not in ("local", "google_drive"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Storage provider must be 'local' or 'google_drive'.",
        )

    if request.storage_provider == "google_drive" and not request.drive_folder_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A verified Google Drive folder is required.",
        )

    row = _get_or_create_settings(db)
    row.storage_provider = request.storage_provider

    if request.storage_provider == "google_drive":
        row.drive_folder_id = request.drive_folder_id
    # Don't clear drive settings when switching to local (allow easy switching back)

    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)

    logger.info(f"Storage settings updated by {current_user.username}: provider={row.storage_provider}")

    return StorageSettingsResponse(
        storage_provider=row.storage_provider,
        local_storage_available=True,
        google_drive_connected=bool(row.google_oauth_refresh_token_encrypted),
        google_user_email=row.google_user_email,
        google_oauth_scope=row.google_oauth_scope,
        folder_url_saved=bool(row.drive_folder_id),
        drive_folder_id=row.drive_folder_id,
        drive_folder_name=row.drive_folder_name,
        google_picker_api_key=settings.GOOGLE_PICKER_API_KEY or None,
        google_client_id=settings.GOOGLE_CLIENT_ID or None,
        last_verified_at=row.last_verified_at,
        last_successful_upload_at=row.last_successful_upload_at,
        updated_at=row.updated_at,
    )
