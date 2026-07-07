"""
SPARSH - Application Settings Model

Stores runtime-configurable application settings.
Single-row design — the helper function creates the first row if none exists.
No hardcoded row ID assumptions.
"""

from datetime import datetime, timezone

from sqlalchemy import Integer, String, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class AppSettings(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)

    # --- Storage Configuration ---
    storage_provider: Mapped[str] = mapped_column(
        String(30), nullable=False, default="local"
    )  # "local" or "google_drive"

    drive_folder_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )  # Extracted from Google Drive URL or Picker selection

    drive_folder_name: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )  # Human-readable folder name (from Picker or verify)

    last_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    last_successful_upload_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # --- Google OAuth Credentials ---
    google_oauth_refresh_token_encrypted: Mapped[str | None] = mapped_column(
        String, nullable=True
    )  # Fernet-encrypted OAuth refresh token

    google_user_email: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )  # The Google account email connected via OAuth

    google_oauth_scope: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )  # NULL or "drive" = legacy full-access; "drive.file" = new Picker-based

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    def __repr__(self) -> str:
        return (
            f"<AppSettings(provider='{self.storage_provider}', "
            f"folder='{self.drive_folder_id}', "
            f"google_user='{self.google_user_email}', "
            f"scope='{self.google_oauth_scope}')>"
        )

