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
from app.api.v1.endpoints_analytics import router as analytics_router
from app.api.v1.endpoints_student_import import router_import as student_import_router
from app.api.v1.endpoints_template_downloads import router_templates_dl as template_dl_router
from app.api.v1.endpoints_promotion import router as promotion_router
from app.api.v1.endpoints_marks_export import router as marks_export_router
from app.api.v1.endpoints_database import router as database_router

api_router = APIRouter()

# --- Authentication & Authorization ---
api_router.include_router(auth_router, prefix="/auth", tags=["Authentication"])

# --- Dashboard & Retrieval ---
api_router.include_router(dashboard_router, prefix="/dashboard", tags=["Dashboard"])

# --- Performance Analytics ---
api_router.include_router(analytics_router, prefix="/analytics", tags=["Performance Analytics"])

# --- Marks Entry & Export ---
api_router.include_router(marks_router, prefix="/marks", tags=["Marks Entry"])
api_router.include_router(marks_export_router, prefix="/marks", tags=["Marks Export"])

# --- Academic Structure Management ---
api_router.include_router(academic_router, prefix="/academic", tags=["Academic Structure"])

# --- Student Registry & Enrollment ---
api_router.include_router(students_router, prefix="/students", tags=["Students"])

# --- Student Master Import ---
api_router.include_router(student_import_router, prefix="/students", tags=["Student Master Import"])

# --- Bulk Promotion ---
api_router.include_router(promotion_router, prefix="/students", tags=["Bulk Promotion"])

# --- Result Import ---
api_router.include_router(results_router, prefix="/results", tags=["Results & Import"])
api_router.include_router(templates_router, prefix="/templates", tags=["Import Templates"])

# --- Template Downloads ---
api_router.include_router(template_dl_router, prefix="/templates", tags=["Template Downloads"])

# --- Historical Report Storage ---
api_router.include_router(reports_router, prefix="/reports", tags=["Historical Reports"])

# --- User Management (Admin Only) ---
api_router.include_router(users_router, prefix="/users", tags=["User Management"])

# --- System Settings (Admin Only) ---
api_router.include_router(settings_router, prefix="/settings", tags=["System Settings"])

# --- Database Management (Admin Only) ---
api_router.include_router(database_router, prefix="/database", tags=["Database Management"])


