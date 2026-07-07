"""
School Result Analysis System - User Schemas

Pydantic DTOs for authentication, user creation, and user responses.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator, Field

# Allowed roles — enforced at schema validation level
VALID_ROLES = ("admin", "teacher", "principal")
RoleType = Literal["admin", "teacher", "principal"]


# --- Authentication Schemas ---

class LoginRequest(BaseModel):
    """Request body for the login endpoint."""
    username: str
    password: str


class TokenResponse(BaseModel):
    """Response returned after successful authentication."""
    access_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    """Internal representation of decoded JWT payload."""
    sub: str | None = None  # Username stored as 'subject'
    role: str | None = None


# --- User Response Schemas ---

class UserResponse(BaseModel):
    """Public user data returned by API endpoints."""
    id: int
    username: str
    full_name: str
    role: str
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserCreateRequest(BaseModel):
    """Request body for creating a new user (Admin only)."""
    username: str
    password: str = Field(min_length=8)
    full_name: str
    role: RoleType  # Enforces only admin, teacher, principal

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        v = v.lower().strip()
        if v not in VALID_ROLES:
            raise ValueError(f"Role must be one of: {', '.join(VALID_ROLES)}")
        return v


class UserUpdateRequest(BaseModel):
    """Request body for updating user details (Admin only)."""
    full_name: str
    role: RoleType

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        v = v.lower().strip()
        if v not in VALID_ROLES:
            raise ValueError(f"Role must be one of: {', '.join(VALID_ROLES)}")
        return v


class UserPasswordResetRequest(BaseModel):
    """Request body for resetting a user's password (Admin only)."""
    new_password: str = Field(min_length=8)


class PasswordChangeRequest(BaseModel):
    """Request body for a user changing their own password."""
    current_password: str
    new_password: str = Field(min_length=8)


class PaginatedUserResponse(BaseModel):
    """Paginated list of users."""
    total: int
    items: list[UserResponse]
