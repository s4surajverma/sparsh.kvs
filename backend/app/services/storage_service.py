"""
SPARSH - Storage Provider Interface & Implementations

Strategy pattern for file storage. Business logic only talks to StorageProvider,
never directly to Google Drive or the filesystem.

Providers:
- LocalStorageProvider: Stores files on the server filesystem (development/fallback)
- GoogleDriveProvider: Stores files on Google Drive via OAuth 2.0 (production)
"""

import io
import logging
from abc import ABC, abstractmethod
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger(__name__)


class StorageProvider(ABC):
    """Abstract interface for file storage operations."""

    @abstractmethod
    def upload_file(self, file_bytes: bytes, storage_key: str, content_type: str = "application/pdf") -> str:
        """
        Upload a file to storage.

        Args:
            file_bytes: Raw file content.
            storage_key: A human-readable key used as the file name in storage.
            content_type: MIME type of the file.

        Returns:
            The provider-specific storage identifier (e.g. Google Drive File ID
            or local file path).
        """
        ...

    @abstractmethod
    def get_file(self, storage_key: str) -> bytes | None:
        """
        Retrieve a file from storage.

        Args:
            storage_key: The provider-specific identifier returned from upload_file().

        Returns:
            Raw file bytes, or None if the file doesn't exist.
        """
        ...

    @abstractmethod
    def delete_file(self, storage_key: str) -> bool:
        """
        Delete a file from storage.

        Args:
            storage_key: The provider-specific identifier of the file to delete.

        Returns:
            True if the file was deleted, False if it didn't exist.
        """
        ...


# ============================================
# Local Storage Provider
# ============================================

class LocalStorageProvider(StorageProvider):
    """
    Stores files on the server's local filesystem.

    Files are written under REPORT_STORAGE_DIR using the storage_key
    as a relative path (e.g. "reports/2024001/2024001_2023-2024.pdf").

    WARNING: On ephemeral hosting (e.g. Render free tier), files may be
    lost on redeploy/restart. Use Google Drive or a persistent disk for
    durable storage.
    """

    def __init__(self):
        self.base_dir = Path(settings.REPORT_STORAGE_DIR).resolve()
        self.base_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"LocalStorageProvider initialized (base_dir={self.base_dir})")

    def upload_file(self, file_bytes: bytes, storage_key: str, content_type: str = "application/pdf") -> str:
        """Write file bytes to disk. Returns the storage_key (relative path)."""
        file_path = self.base_dir / storage_key
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(file_bytes)
        logger.info(f"Saved to local storage: {storage_key} ({len(file_bytes)} bytes)")
        return storage_key

    def get_file(self, storage_key: str) -> bytes | None:
        """Read file bytes from disk. Returns None if the file doesn't exist."""
        file_path = self.base_dir / storage_key
        if not file_path.is_file():
            logger.warning(f"Local file not found: {storage_key}")
            return None
        return file_path.read_bytes()

    def delete_file(self, storage_key: str) -> bool:
        """Remove a file from disk. Returns True if deleted, False if not found."""
        file_path = self.base_dir / storage_key
        if not file_path.is_file():
            logger.warning(f"Cannot delete — file not found: {storage_key}")
            return False
        file_path.unlink()
        logger.info(f"Deleted from local storage: {storage_key}")
        return True


# ============================================
# Google Drive Provider (OAuth-based)
# ============================================

class GoogleDriveProvider(StorageProvider):
    """
    Stores files on Google Drive using OAuth 2.0 user credentials.

    Files are uploaded under the admin's own Google account,
    using their personal Drive quota. This works with both
    free Gmail and Google Workspace accounts.

    Supports both My Drive and Shared Drives via supportsAllDrives.
    """

    def __init__(self, parent_folder_id: str | None = None):
        self.parent_folder_id = parent_folder_id
        self._service = None
        logger.info(f"GoogleDriveProvider initialized (folder={parent_folder_id or 'root'})")

    def _get_service(self):
        """
        Lazily initialize the Google Drive API service using OAuth credentials from DB.
        Handles token refresh automatically via the google-auth library.
        """
        if self._service is not None:
            return self._service

        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        from app.core.encryption import decrypt_string

        # Read the refresh token from the database
        from app.db.database import SessionLocal
        from app.models.app_settings import AppSettings

        db = SessionLocal()
        try:
            row = db.query(AppSettings).first()
            if not row or not row.google_oauth_refresh_token_encrypted:
                raise RuntimeError(
                    "Google Drive is not connected. "
                    "Please connect your Google account via Storage Settings."
                )

            refresh_token = decrypt_string(row.google_oauth_refresh_token_encrypted)

            # Use the scope that was granted at connection time
            scope = row.google_oauth_scope or "https://www.googleapis.com/auth/drive"
            if not scope.startswith("https://"):
                scope = f"https://www.googleapis.com/auth/{scope}"
        finally:
            db.close()

        creds = Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.GOOGLE_CLIENT_ID,
            client_secret=settings.GOOGLE_CLIENT_SECRET,
            scopes=[scope],
        )

        self._service = build("drive", "v3", credentials=creds)
        logger.info("Google Drive API service initialized via OAuth")
        return self._service

    def _invalidate_service(self):
        """Clear the cached service so it will be re-initialized on next use."""
        self._service = None

    def upload_file(self, file_bytes: bytes, storage_key: str, content_type: str = "application/pdf") -> str:
        """
        Upload a file to Google Drive.

        Args:
            file_bytes: Raw file content.
            storage_key: Used as the filename in Google Drive.
            content_type: MIME type.

        Returns:
            The Google Drive File ID (this is the value that must be saved as storage_key in the DB).
        """
        try:
            service = self._get_service()
            from googleapiclient.http import MediaIoBaseUpload

            file_metadata = {"name": storage_key}
            if self.parent_folder_id:
                file_metadata["parents"] = [self.parent_folder_id]

            media = MediaIoBaseUpload(
                io.BytesIO(file_bytes), mimetype=content_type, resumable=True
            )
            file = service.files().create(
                body=file_metadata,
                media_body=media,
                fields="id",
                supportsAllDrives=True,
            ).execute()

            drive_file_id = file.get("id")
            logger.info(f"Uploaded to Google Drive: {storage_key} → ID: {drive_file_id}")
            return drive_file_id

        except Exception as e:
            self._handle_drive_error(e, "upload")
            raise  # Re-raise after logging

    def get_file(self, storage_key: str) -> bytes | None:
        """
        Download a file from Google Drive by its Drive File ID.

        Args:
            storage_key: The Google Drive File ID.

        Returns:
            Raw file bytes, or None if the file doesn't exist.
        """
        try:
            service = self._get_service()
            from googleapiclient.http import MediaIoBaseDownload

            request = service.files().get_media(
                fileId=storage_key,
                supportsAllDrives=True,
            )
            buffer = io.BytesIO()
            downloader = MediaIoBaseDownload(buffer, request)

            done = False
            while not done:
                _, done = downloader.next_chunk()

            return buffer.getvalue()

        except Exception as e:
            self._handle_drive_error(e, "download")
            return None

    def delete_file(self, storage_key: str) -> bool:
        """
        Delete a file from Google Drive by its Drive File ID.

        Args:
            storage_key: The Google Drive File ID.

        Returns:
            True if deleted, False if not found or failed.
        """
        try:
            service = self._get_service()
            service.files().delete(
                fileId=storage_key,
                supportsAllDrives=True,
            ).execute()
            logger.info(f"Deleted from Google Drive: {storage_key}")
            return True
        except Exception as e:
            self._handle_drive_error(e, "delete")
            return False

    def _handle_drive_error(self, error: Exception, operation: str):
        """
        Centralized error handler for all Google Drive API operations.
        Handles token expiry, permission errors, and network issues.
        """
        error_str = str(error).lower()

        # Handle token expiry / revocation
        if "invalid_grant" in error_str or "token" in error_str and "expired" in error_str:
            self._invalidate_service()
            logger.error(
                f"Google Drive {operation} failed: OAuth token expired or revoked. "
                f"The admin needs to reconnect Google Drive in Storage Settings. "
                f"Details: {error}"
            )
            raise RuntimeError(
                "Your Google Drive connection has expired. "
                "Please go to Storage Settings and reconnect your Google account."
            ) from error

        if "invalid_scope" in error_str or "refresherror" in error_str:
            self._invalidate_service()
            logger.error(
                f"Google Drive {operation} failed: Scope mismatch or refresh error. "
                f"The admin needs to disconnect and reconnect Google Drive. "
                f"Details: {error}"
            )
            raise RuntimeError(
                "Google Drive permission error. "
                "Please disconnect and reconnect your Google account in Storage Settings."
            ) from error

        # Handle 404 (file not found)
        if "404" in error_str or "not found" in error_str:
            logger.warning(f"Google Drive {operation}: file not found. Details: {error}")
            return  # Let the caller handle None / False

        # Handle 403 (permission denied)
        if "403" in error_str or "forbidden" in error_str:
            logger.error(
                f"Google Drive {operation} failed: Permission denied. "
                f"The connected Google account may not have access to this file or folder. "
                f"Details: {error}"
            )
            raise RuntimeError(
                "Permission denied by Google Drive. "
                "Please verify that your connected Google account has access to the folder."
            ) from error

        # Handle quota exceeded
        if "quota" in error_str or "rate" in error_str:
            logger.error(f"Google Drive {operation} failed: Quota/rate limit. Details: {error}")
            raise RuntimeError(
                "Google Drive storage quota exceeded or rate limited. Please try again later."
            ) from error

        # Generic fallback
        logger.error(
            f"Google Drive {operation} failed with unexpected error: {error}",
            exc_info=True,
        )


# ============================================
# Provider Factory
# ============================================

def get_storage_provider() -> StorageProvider:
    """
    Factory function that returns the configured storage provider.
    Reads the storage_provider and folder ID from the AppSettings DB table.
    Falls back to LocalStorageProvider if no settings exist.
    """
    provider_name = "local"
    folder_id = None

    try:
        from app.db.database import SessionLocal
        from app.models.app_settings import AppSettings

        db = SessionLocal()
        try:
            row = db.query(AppSettings).first()
            if row:
                provider_name = row.storage_provider or "local"
                folder_id = row.drive_folder_id
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Failed to read storage settings from DB: {e}")

    if provider_name == "google_drive":
        return GoogleDriveProvider(parent_folder_id=folder_id)
    else:
        return LocalStorageProvider()


def get_storage_provider_name() -> str:
    """
    Returns the current storage provider name as stored in the DB.
    Used for writing normalized storage_provider values to HistoricalReport rows.
    Returns "local" or "google_drive".
    """
    try:
        from app.db.database import SessionLocal
        from app.models.app_settings import AppSettings

        db = SessionLocal()
        try:
            row = db.query(AppSettings).first()
            if row and row.storage_provider:
                return row.storage_provider
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Failed to read storage provider name: {e}")

    return "local"
