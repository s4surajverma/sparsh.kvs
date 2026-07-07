"""
School Result Analysis System - Core Configuration

Loads and validates all environment variables using pydantic-settings.
The application will refuse to start if required variables are missing.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables or .env file.
    All fields are validated at startup.
    """

    # --- Application ---
    PROJECT_NAME: str = "School Result Analysis System"
    API_V1_STR: str = "/api/v1"

    # --- Security ---
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours
    ALLOWED_ORIGINS: str = ""
    DEBUG: bool = False

    # --- Database ---
    DATABASE_URL: str

    # --- Storage ---
    STORAGE_PROVIDER: str = "local"
    FERNET_SECRET_KEY: str
    REPORT_STORAGE_DIR: str = "./report_storage"

    # --- Google OAuth (Developer Setup) ---
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://127.0.0.1:8000/api/v1/settings/storage/oauth/callback"

    # --- Google Picker API Key (separate from OAuth credentials) ---
    # Created in Cloud Console → Credentials → API Key.
    # Should be restricted to the Picker API and to your domain via HTTP referrer restrictions.
    GOOGLE_PICKER_API_KEY: str = ""

    # --- Default Admin Seed ---
    DEFAULT_ADMIN_USERNAME: str = "admin"
    DEFAULT_ADMIN_PASSWORD: str
    DEFAULT_ADMIN_FULLNAME: str = "System Administrator"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
    )


# Singleton instance used throughout the application
import sys
from pydantic import ValidationError

try:
    settings = Settings()
except ValidationError as e:
    errors = e.errors()
    for err in errors:
        if "FERNET_SECRET_KEY" in err.get("loc", []):
            print(
                "\nCRITICAL CONFIGURATION ERROR:\n"
                "FERNET_SECRET_KEY is required for encrypted credential storage.\n"
                "Please generate a secure Fernet key and add it to your .env file.\n",
                file=sys.stderr
            )
            sys.exit(1)
    print(f"\nConfiguration Error:\n{e}\n", file=sys.stderr)
    sys.exit(1)
