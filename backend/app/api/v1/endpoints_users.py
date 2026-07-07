"""
School Result Analysis System - User Management Endpoints

Provides:
- POST   /users
- GET    /users
- GET    /users/{id}
- PUT    /users/{id}
- PATCH  /users/{id}/enable
- PATCH  /users/{id}/disable
- PATCH  /users/{id}/reset-password
- DELETE /users/{id}

All endpoints are strictly protected and require the 'admin' role.
"""

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_admin
from app.core.security import get_password_hash
from app.models.user import User
from app.schemas.user_schema import (
    UserResponse,
    PaginatedUserResponse,
    UserCreateRequest,
    UserUpdateRequest,
    UserPasswordResetRequest,
)

# Apply the admin dependency to ALL routes in this router
router = APIRouter(dependencies=[Depends(get_current_admin)])


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    request: UserCreateRequest,
    db: Session = Depends(get_db),
):
    """Create a new user."""
    # Check if username already exists
    existing_user = db.query(User).filter(User.username == request.username).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )

    new_user = User(
        username=request.username,
        full_name=request.full_name,
        password_hash=get_password_hash(request.password),
        role=request.role,
        is_active=True,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.get("/", response_model=PaginatedUserResponse)
def get_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """List all users."""
    total = db.query(User).count()
    users = db.query(User).order_by(User.id).offset(skip).limit(limit).all()
    return {"total": total, "items": users}


@router.get("/{user_id}", response_model=UserResponse)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
):
    """Get details of a specific user."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    request: UserUpdateRequest,
    db: Session = Depends(get_db),
):
    """Update a user's details (full name and role)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.full_name = request.full_name
    user.role = request.role

    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}/enable", response_model=UserResponse)
def enable_user(
    user_id: int,
    db: Session = Depends(get_db),
):
    """Reactivate a disabled user account."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_active = True
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}/disable", response_model=UserResponse)
def disable_user(
    user_id: int,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Deactivate a user account, preventing future logins."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == current_admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot disable your own active admin account",
        )

    user.is_active = False
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}/reset-password", response_model=UserResponse)
def reset_user_password(
    user_id: int,
    request: UserPasswordResetRequest,
    db: Session = Depends(get_db),
):
    """Administratively assign a new password to a user."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.password_hash = get_password_hash(request.new_password)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """
    Permanently delete a user.
    Requires the user to be disabled first, and prevents self-deletion.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == current_admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own admin account",
        )

    if user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User must be disabled before deletion",
        )

    try:
        db.delete(user)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not delete user. They may have dependent records (e.g., uploaded reports).",
        )
