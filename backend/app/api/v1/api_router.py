"""
School Result Analysis System - API V1 Router

Aggregates all versioned endpoint routers into a single router
that is mounted by the main application under /api/v1.
"""

from fastapi import APIRouter

from app.api.v1.endpoints_auth import router as auth_router
from app.api.v1.endpoints_academic import router as academic_router
from app.api.v1.endpoints_students import router as students_router
from app.api.v1.endpoints_results import router as results_router
from app.api.v1.endpoints_reports import router as reports_router
from app.api.v1.endpoints_dashboard import router as dashboard_router
from app.api.v1.endpoints_marks import router as marks_router
from app.api.v1.endpoints_templates import router as templates_router
from app.api.v1.endpoints_users import router as users_router
from app.api.v1.endpoints_settings import router as settings_router

api_router = APIRouter()

# --- Authentication & Authorization ---
api_router.include_router(auth_router, prefix="/auth", tags=["Authentication"])

# --- Dashboard & Retrieval ---
api_router.include_router(dashboard_router, prefix="/dashboard", tags=["Dashboard"])

# --- Marks Entry ---
api_router.include_router(marks_router, prefix="/marks", tags=["Marks Entry"])

# --- Academic Structure Management ---
api_router.include_router(academic_router, prefix="/academic", tags=["Academic Structure"])

# --- Student Registry & Enrollment ---
api_router.include_router(students_router, prefix="/students", tags=["Students"])

# --- Result Import ---
api_router.include_router(results_router, prefix="/results", tags=["Results & Import"])
api_router.include_router(templates_router, prefix="/templates", tags=["Import Templates"])

# --- Historical Report Storage ---
api_router.include_router(reports_router, prefix="/reports", tags=["Historical Reports"])

# --- User Management (Admin Only) ---
api_router.include_router(users_router, prefix="/users", tags=["User Management"])

# --- System Settings (Admin Only) ---
api_router.include_router(settings_router, prefix="/settings", tags=["System Settings"])
