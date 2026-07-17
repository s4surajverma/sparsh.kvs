"""
SPARSH - Database Management Endpoints

Provides admin-only endpoints for inspecting and resetting database tables.
All operations require admin role authentication.
Supports targeting either the local SQLite database or the online PostgreSQL database.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import text, inspect, create_engine
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.core.config import settings
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter()

# Tables that should NEVER be truncated during individual reset
PROTECTED_TABLES = {"users"}

# Correct deletion order to satisfy foreign key constraints.
DELETION_ORDER = [
    "student_results",
    "student_enrollments",
    "historical_reports",
    "import_batches",
    "students",
    "exams",
    "subjects",
    "class_levels",
    "academic_years",
    "import_templates",
    "app_settings",
    "users",
]


def _get_target_engine(target: str):
    """Dynamically create a SQLAlchemy engine based on the target."""
    if target == "online":
        url = settings.ONLINE_DATABASE_URL
    else:
        url = settings.LOCAL_DATABASE_URL

    if not url:
        raise HTTPException(
            status_code=400,
            detail=f"Configuration for '{target}' database is missing in .env",
        )

    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)

    return create_engine(url, pool_pre_ping=True)


def _get_db_type(engine_instance) -> str:
    """Detect database type from engine URL."""
    url = str(engine_instance.url)
    if "sqlite" in url:
        return "SQLite (Local)"
    elif "postgresql" in url or "postgres" in url:
        return "PostgreSQL (Online)"
    else:
        return "Unknown"


def _get_table_info(db: Session, engine_instance) -> list[dict]:
    """Get all tables with their row counts."""
    inspector = inspect(engine_instance)
    table_names = inspector.get_table_names()
    tables = []

    for table_name in sorted(table_names):
        try:
            result = db.execute(text(f'SELECT COUNT(*) FROM "{table_name}"'))
            row_count = result.scalar()
        except Exception:
            row_count = -1  # Indicates error reading table

        columns = inspector.get_columns(table_name)

        tables.append({
            "table_name": table_name,
            "row_count": row_count,
            "column_count": len(columns),
            "is_empty": row_count == 0,
            "is_protected": table_name in PROTECTED_TABLES,
        })

    return tables


@router.get("/info")
def get_database_info(
    target: str = Query("local", description="Target database: local or online"),
    current_user: User = Depends(get_current_admin),
):
    """
    Get database type, connection status, and table listing with row counts.
    Admin only.
    """
    target_engine = _get_target_engine(target)
    db_type = _get_db_type(target_engine)

    with Session(target_engine) as db:
        try:
            db.execute(text("SELECT 1"))
            connected = True
        except Exception:
            connected = False

        tables = _get_table_info(db, target_engine) if connected else []
        total_records = sum(t["row_count"] for t in tables if t["row_count"] >= 0)

    return {
        "database_type": db_type,
        "connected": connected,
        "table_count": len(tables),
        "total_records": total_records,
        "tables": tables,
    }


@router.delete("/tables/{table_name}", status_code=status.HTTP_200_OK)
def reset_table(
    table_name: str,
    target: str = Query("local", description="Target database: local or online"),
    current_user: User = Depends(get_current_admin),
):
    """
    Delete all rows from a specific table on the target database. Admin only.
    """
    target_engine = _get_target_engine(target)
    inspector = inspect(target_engine)
    existing_tables = inspector.get_table_names()
    
    if table_name not in existing_tables:
        raise HTTPException(
            status_code=404,
            detail=f"Table '{table_name}' does not exist on {target} database.",
        )

    if table_name in PROTECTED_TABLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Table '{table_name}' is protected and cannot be individually reset.",
        )

    dependencies = _get_dependent_tables(table_name)

    with Session(target_engine) as db:
        try:
            for dep_table in dependencies:
                if dep_table != table_name and dep_table not in PROTECTED_TABLES:
                    db.execute(text(f'DELETE FROM "{dep_table}"'))
                    logger.info(f"[{target.upper()}] Cleared dependent table: {dep_table}")

            result = db.execute(text(f'DELETE FROM "{table_name}"'))
            db.commit()

            deleted_count = result.rowcount
            logger.info(
                f"[{target.upper()}] Admin '{current_user.username}' reset table '{table_name}' "
                f"({deleted_count} rows deleted)"
            )

            return {
                "message": f"Table '{table_name}' on {target} DB has been reset.",
                "table_name": table_name,
                "rows_deleted": deleted_count,
                "dependent_tables_cleared": [t for t in dependencies if t != table_name],
            }
        except Exception as e:
            db.rollback()
            logger.error(f"[{target.upper()}] Failed to reset table '{table_name}': {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to reset table '{table_name}': {str(e)}",
            )


@router.delete("/reset", status_code=status.HTTP_200_OK)
def reset_entire_database(
    target: str = Query("local", description="Target database: local or online"),
    current_user: User = Depends(get_current_admin),
):
    """
    Reset the entire target database: truncate all data tables and re-seed defaults.
    """
    target_engine = _get_target_engine(target)
    inspector = inspect(target_engine)
    existing_tables = set(inspector.get_table_names())
    cleared_tables = []

    with Session(target_engine) as db:
        try:
            for table_name in DELETION_ORDER:
                if table_name in existing_tables:
                    db.execute(text(f'DELETE FROM "{table_name}"'))
                    cleared_tables.append(table_name)

            for table_name in existing_tables:
                if table_name not in cleared_tables:
                    try:
                        db.execute(text(f'DELETE FROM "{table_name}"'))
                        cleared_tables.append(table_name)
                    except Exception:
                        pass

            db.commit()

            logger.info(f"[{target.upper()}] Admin '{current_user.username}' performed FULL DATABASE RESET.")

            # Temporarily redirect the global SessionLocal to the target engine just for seeding.
            # This is a bit hacky but it reuses the existing seed_database logic efficiently.
            from app.db import seed
            import app.db.database as db_module
            original_session_maker = db_module.SessionLocal
            
            from sqlalchemy.orm import sessionmaker
            db_module.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=target_engine)
            
            try:
                seed.seed_database()
            finally:
                db_module.SessionLocal = original_session_maker

            return {
                "message": f"{target.capitalize()} Database has been completely reset and re-seeded.",
                "tables_cleared": cleared_tables,
            }
        except Exception as e:
            db.rollback()
            logger.error(f"[{target.upper()}] Full database reset failed: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Database reset failed: {str(e)}",
            )


def _get_dependent_tables(table_name: str) -> list[str]:
    dependency_map = {
        "students": ["student_results", "student_enrollments", "historical_reports"],
        "student_enrollments": ["student_results"],
        "academic_years": ["student_results", "student_enrollments", "import_batches", "historical_reports"],
        "class_levels": ["student_results", "student_enrollments"],
        "subjects": ["student_results"],
        "exams": ["student_results"],
    }
    return dependency_map.get(table_name, []) + [table_name]
