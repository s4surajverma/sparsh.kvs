"""
School Result Analysis System - Authentication Endpoints

Provides:
- POST /login    — Authenticate and receive a JWT token.
- GET  /me       — View the current authenticated user's profile.
- GET  /test/*   — Protected test endpoints for verifying RBAC.
"""

import time
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from app.core.config import settings

from app.api.deps import (
    get_db,
    get_current_active_user,
    get_current_admin,
    get_current_teacher,
    get_current_principal,
)
from app.core.security import verify_password, create_access_token
from app.models.user import User
from app.schemas.user_schema import LoginRequest, TokenResponse, UserResponse, PasswordChangeRequest

router = APIRouter()


# Per-process rate limit dictionary
# Format: {"username:ip_address": {"count": int, "lockout_until": float}}
# Note: This is an in-memory tracking which is per-process. 
# If the app is deployed with multiple worker processes (uvicorn --workers N) or restarts frequently,
# the effective threshold and lockout persistence will vary accordingly.
FAILED_LOGIN_ATTEMPTS = {}
LOCKOUT_THRESHOLD = 5
LOCKOUT_DURATION_SECONDS = 300


@router.post("/login", response_model=TokenResponse)
def login(
    request: Request,
    form_data: LoginRequest,
    db: Session = Depends(get_db),
):
    """
    Authenticate a user with username and password.
    Returns a JWT access token on success.
    """
    client_ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown")
    lockout_key = f"{form_data.username}:{client_ip}"
    
    # Check lockout status
    now = time.time()
    attempt_info = FAILED_LOGIN_ATTEMPTS.get(lockout_key)
    if attempt_info and attempt_info["count"] >= LOCKOUT_THRESHOLD:
        if now < attempt_info["lockout_until"]:
            remaining = int((attempt_info["lockout_until"] - now) / 60) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many failed attempts — try again in {remaining} minutes"
            )
        else:
            # Lockout expired, reset
            FAILED_LOGIN_ATTEMPTS.pop(lockout_key, None)

    # Look up the user
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        # Record failed attempt
        if lockout_key not in FAILED_LOGIN_ATTEMPTS:
            FAILED_LOGIN_ATTEMPTS[lockout_key] = {"count": 0, "lockout_until": 0}
        
        FAILED_LOGIN_ATTEMPTS[lockout_key]["count"] += 1
        
        if FAILED_LOGIN_ATTEMPTS[lockout_key]["count"] >= LOCKOUT_THRESHOLD:
            FAILED_LOGIN_ATTEMPTS[lockout_key]["lockout_until"] = now + LOCKOUT_DURATION_SECONDS
            
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check if user is active
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled",
        )

    # Success, clear failed attempts
    FAILED_LOGIN_ATTEMPTS.pop(lockout_key, None)

    # Generate JWT token
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role}
    )

    return TokenResponse(access_token=access_token)


@router.get("/me", response_model=UserResponse)
def get_my_profile(
    current_user: User = Depends(get_current_active_user),
):
    """
    Returns the profile of the currently authenticated user.
    Requires a valid JWT token.
    """
    return current_user


@router.patch("/change-password", response_model=UserResponse)
def change_password(
    request: PasswordChangeRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    Change the current authenticated user's password.
    Requires providing the correct current password.
    """
    if not verify_password(request.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect current password.",
        )

    from app.core.security import get_password_hash
    current_user.password_hash = get_password_hash(request.new_password)
    db.commit()
    db.refresh(current_user)
    return current_user


# ============================================
# Protected Test Endpoints (RBAC Verification)
# ============================================

@router.get("/test/public")
def test_public():
    """Public endpoint — no authentication required."""
    if not settings.DEBUG:
        raise HTTPException(status_code=404, detail="Not Found")
    return {"message": "This is a public endpoint. No auth needed."}


@router.get("/test/authenticated")
def test_authenticated(
    current_user: User = Depends(get_current_active_user),
):
    """Requires any authenticated and active user."""
    if not settings.DEBUG:
        raise HTTPException(status_code=404, detail="Not Found")
    return {
        "message": "You are authenticated.",
        "user": current_user.username,
        "role": current_user.role,
    }


@router.get("/test/admin-only")
def test_admin_only(
    current_user: User = Depends(get_current_admin),
):
    """Requires the 'admin' role."""
    if not settings.DEBUG:
        raise HTTPException(status_code=404, detail="Not Found")
    return {
        "message": "Welcome, Admin.",
        "user": current_user.username,
    }


@router.get("/test/teacher-only")
def test_teacher_only(
    current_user: User = Depends(get_current_teacher),
):
    """Requires the 'teacher' role."""
    if not settings.DEBUG:
        raise HTTPException(status_code=404, detail="Not Found")
    return {
        "message": "Welcome, Teacher.",
        "user": current_user.username,
    }


@router.get("/test/principal-only")
def test_principal_only(
    current_user: User = Depends(get_current_principal),
):
    """Requires the 'principal' role."""
    if not settings.DEBUG:
        raise HTTPException(status_code=404, detail="Not Found")
    return {
        "message": "Welcome, Principal.",
        "user": current_user.username,
    }
