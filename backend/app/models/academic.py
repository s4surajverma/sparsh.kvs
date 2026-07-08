"""
School Result Analysis System - Academic Structure Models

Contains the core school structure entities:
- AcademicYear: School year periods (e.g., "2024-2025")
- ClassLevel: Grade standards (e.g., "Class 6" through "Class 12")
- Subject: Master catalog of academic subjects
- Exam: Examination events (e.g., PT1, Half Yearly, Annual)
"""

from sqlalchemy import Integer, String, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class AcademicYear(Base):
    __tablename__ = "academic_years"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year_label: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)  # e.g. "2024-2025"
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # --- Relationships ---
    enrollments: Mapped[list["StudentEnrollment"]] = relationship(
        "StudentEnrollment", back_populates="academic_year"
    )
    historical_reports: Mapped[list["HistoricalReport"]] = relationship(
        "HistoricalReport", back_populates="academic_year"
    )

    def __repr__(self) -> str:
        return f"<AcademicYear(id={self.id}, label='{self.year_label}', current={self.is_current})>"


class ClassLevel(Base):
    __tablename__ = "class_levels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    class_name: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)  # e.g. "Class 6"
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)  # For sorting: 6, 7, 8...12
    sections: Mapped[str | None] = mapped_column(String(50), nullable=True, default="A,B,C,D,E,F,G,H")  # comma-separated e.g. "A,B,C"

    # --- Relationships ---
    enrollments: Mapped[list["StudentEnrollment"]] = relationship(
        "StudentEnrollment", back_populates="class_level"
    )

    def __repr__(self) -> str:
        return f"<ClassLevel(id={self.id}, name='{self.class_name}')>"


class Subject(Base):
    __tablename__ = "subjects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject_name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)  # e.g. "Mathematics"
    subject_code: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True)  # e.g. "MATH"

    # --- Relationships ---
    results: Mapped[list["StudentResult"]] = relationship(
        "StudentResult", back_populates="subject"
    )

    def __repr__(self) -> str:
        return f"<Subject(id={self.id}, name='{self.subject_name}')>"


class Exam(Base):
    __tablename__ = "exams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    exam_name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)  # e.g. "PT1", "Annual"
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)  # For sorting: 1, 2, 3...

    # --- Relationships ---
    results: Mapped[list["StudentResult"]] = relationship(
        "StudentResult", back_populates="exam"
    )

    def __repr__(self) -> str:
        return f"<Exam(id={self.id}, name='{self.exam_name}')>"
