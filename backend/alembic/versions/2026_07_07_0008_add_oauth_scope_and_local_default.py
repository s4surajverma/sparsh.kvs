"""add_oauth_scope_local_default_normalize_reports

Revision ID: 0008_scope_local
Revises: 0007_remove_local
Create Date: 2026-07-07

Adds google_oauth_scope and drive_folder_name columns to app_settings.
Normalizes HistoricalReport.storage_provider from class names to snake_case.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0008_scope_local'
down_revision: Union[str, None] = '0007_remove_local'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add google_oauth_scope column (nullable — NULL means legacy 'drive' scope)
    op.add_column(
        'app_settings',
        sa.Column('google_oauth_scope', sa.String(50), nullable=True),
    )

    # Add drive_folder_name column (stores human-readable folder name from Picker/verify)
    op.add_column(
        'app_settings',
        sa.Column('drive_folder_name', sa.String(255), nullable=True),
    )

    # Normalize HistoricalReport.storage_provider values:
    # "GoogleDriveProvider" → "google_drive"
    # This ensures all rows use consistent snake_case values going forward.
    op.execute(
        "UPDATE historical_reports "
        "SET storage_provider = 'google_drive' "
        "WHERE storage_provider = 'GoogleDriveProvider'"
    )


def downgrade() -> None:
    op.drop_column('app_settings', 'drive_folder_name')
    op.drop_column('app_settings', 'google_oauth_scope')

    # Reverse normalization (restore old class-name format)
    op.execute(
        "UPDATE historical_reports "
        "SET storage_provider = 'GoogleDriveProvider' "
        "WHERE storage_provider = 'google_drive'"
    )
