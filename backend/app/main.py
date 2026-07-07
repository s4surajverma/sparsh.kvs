"""
School Result Analysis System - Application Entrypoint

Creates and configures the FastAPI application instance.
Mounts routers, exception handlers, and static files.
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.core.config import settings
from app.core.exceptions import register_exception_handlers
from app.api.v1.api_router import api_router

# ============================================
# Logging Configuration
# ============================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# Path to the frontend directory
FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"


# ============================================
# Application Lifespan (Startup / Shutdown)
# ============================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handles application startup and shutdown events."""
    logger.info("=" * 50)
    logger.info(f"Starting {settings.PROJECT_NAME}")
    logger.info(f"API prefix: {settings.API_V1_STR}")
    logger.info(f"Storage provider: {settings.STORAGE_PROVIDER}")
    logger.info("=" * 50)
    yield
    logger.info(f"Shutting down {settings.PROJECT_NAME}")


# ============================================
# Application Factory
# ============================================
app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    redoc_url=f"{settings.API_V1_STR}/redoc",
    lifespan=lifespan,
)

# --- CORS Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Global Exception Handlers ---
register_exception_handlers(app)

# --- API Routes ---
app.include_router(api_router, prefix=settings.API_V1_STR)


# --- Health Check Endpoint ---
@app.get("/health", tags=["System"])
def health_check():
    """
    Health check endpoint.
    Returns application status for uptime monitoring and deployment validation.
    """
    return {
        "status": "healthy",
        "application": settings.PROJECT_NAME,
    }


# --- SPA Catch-All Routes ---
# Serve dashboard.html for all clean page URLs.
# This allows the frontend to handle routing via the History API.
SPA_PAGES = ["home", "search", "marks-entry", "import", "reports", "users", "academic-years", "storage-settings", "about"]


@app.get("/{page_name}", include_in_schema=False)
async def spa_catch_all(page_name: str):
    """Serve the dashboard SPA for known page routes."""
    if page_name in SPA_PAGES:
        return FileResponse(FRONTEND_DIR / "dashboard.html", media_type="text/html")
    # Fall through to static file mount for CSS/JS/other assets
    file_path = FRONTEND_DIR / page_name
    if file_path.is_file():
        return FileResponse(file_path)
    # Default: serve index.html for unknown paths
    return FileResponse(FRONTEND_DIR / "index.html", media_type="text/html")


# --- Static File Mounting (Frontend) ---
# Mount the frontend directory to serve HTML/CSS/JS files.
# This must be the LAST mount to avoid intercepting API routes.
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
