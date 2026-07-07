"""
School Result Analysis System - Seed Data

Populates the database with essential initial data:
- Default Admin user (bcrypt hashed password)
- ClassLevel records (Class 6 through Class 12)
- Standard Exam catalog
- Common Subject catalog

This module is idempotent — safe to run multiple times.
Existing records are skipped, not duplicated.
"""

import logging

from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.core.config import settings
from app.core.security import get_password_hash
from app.models.user import User
from app.models.academic import AcademicYear, ClassLevel, Subject, Exam

logger = logging.getLogger(__name__)


# ============================================
# Seed Data Definitions
# ============================================

SEED_CLASS_LEVELS = [
    {"class_name": "Class 6", "display_order": 6},
    {"class_name": "Class 7", "display_order": 7},
    {"class_name": "Class 8", "display_order": 8},
    {"class_name": "Class 9", "display_order": 9},
    {"class_name": "Class 10", "display_order": 10},
    {"class_name": "Class 11", "display_order": 11},
    {"class_name": "Class 12", "display_order": 12},
]

SEED_EXAMS = [
    {"exam_name": "PT1", "display_order": 1},
    {"exam_name": "PT2", "display_order": 2},
    {"exam_name": "Half Yearly", "display_order": 4},
    {"exam_name": "Annual", "display_order": 5},
    {"exam_name": "Pre Board", "display_order": 6},
]

SEED_SUBJECTS = [
    {"subject_name": "English", "subject_code": "ENG"},
    {"subject_name": "Hindi", "subject_code": "HIN"},
    {"subject_name": "Mathematics", "subject_code": "MATH"},
    {"subject_name": "Science", "subject_code": "SCI"},
    {"subject_name": "Social Science", "subject_code": "SST"},
    {"subject_name": "Artificial Intelligence", "subject_code": "AI"},
    {"subject_name": "Painting", "subject_code": "PAINT"},
    {"subject_name": "Computer Science", "subject_code": "CS"},
    {"subject_name": "Physical Education", "subject_code": "PE"},
    {"subject_name": "Sanskrit", "subject_code": "SKT"},
]

SEED_ACADEMIC_YEARS = [
    {"year_label": "2023-2024", "is_current": False},
    {"year_label": "2024-2025", "is_current": False},
    {"year_label": "2025-2026", "is_current": True},
]


# ============================================
# Seed Functions
# ============================================

def _seed_class_levels(db: Session) -> None:
    """Insert ClassLevel records if they don't already exist."""
    for data in SEED_CLASS_LEVELS:
        existing = db.query(ClassLevel).filter_by(class_name=data["class_name"]).first()
        if not existing:
            db.add(ClassLevel(**data))
            logger.info(f"  Seeded: {data['class_name']}")


def _seed_exams(db: Session) -> None:
    """Insert Exam records if they don't already exist."""
    for data in SEED_EXAMS:
        existing = db.query(Exam).filter_by(exam_name=data["exam_name"]).first()
        if not existing:
            db.add(Exam(**data))
            logger.info(f"  Seeded: {data['exam_name']}")


def _seed_subjects(db: Session) -> None:
    """Insert Subject records if they don't already exist."""
    for data in SEED_SUBJECTS:
        existing = db.query(Subject).filter_by(subject_name=data["subject_name"]).first()
        if not existing:
            db.add(Subject(**data))
            logger.info(f"  Seeded: {data['subject_name']}")


def _seed_academic_years(db: Session) -> None:
    """Insert AcademicYear records if they don't already exist."""
    for data in SEED_ACADEMIC_YEARS:
        existing = db.query(AcademicYear).filter_by(year_label=data["year_label"]).first()
        if not existing:
            db.add(AcademicYear(**data))
            logger.info(f"  Seeded: {data['year_label']}")


def _seed_default_admin(db: Session) -> None:
    """
    Insert the default admin user if no admin exists.
    Username and password are read from environment variables.
    Password is stored as a bcrypt hash — never in plain text.
    """
    username = settings.DEFAULT_ADMIN_USERNAME
    existing_admin = db.query(User).filter_by(username=username).first()
    if not existing_admin:
        admin = User(
            username=username,
            password_hash=get_password_hash(settings.DEFAULT_ADMIN_PASSWORD),
            full_name=settings.DEFAULT_ADMIN_FULLNAME,
            role="admin",
            is_active=True,
        )
        db.add(admin)
        logger.info(f"  Seeded: Default admin user '{username}' (bcrypt hashed)")


def seed_database() -> None:
    """
    Main entry point for database seeding.
    Idempotent — safe to run multiple times.
    """
    logger.info("=" * 40)
    logger.info("Starting database seed...")

    db = SessionLocal()
    try:
        logger.info("Seeding Class Levels...")
        _seed_class_levels(db)

        logger.info("Seeding Exams...")
        _seed_exams(db)

        logger.info("Seeding Subjects...")
        _seed_subjects(db)

        logger.info("Seeding Academic Years...")
        _seed_academic_years(db)

        logger.info("Seeding Default Admin...")
        _seed_default_admin(db)

        db.commit()
        logger.info("Database seed completed successfully.")
    except Exception as e:
        db.rollback()
        logger.error(f"Database seed failed: {e}", exc_info=True)
        raise
    finally:
        db.close()
        logger.info("=" * 40)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    seed_database()
