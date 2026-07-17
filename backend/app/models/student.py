"""
School Result Analysis System - Student Models

Contains the core student identity and yearly enrollment:
- Student: Permanent identity anchored by admission_number (PK).
- StudentEnrollment: Yearly junction storing class, section, and roll number.
"""

from sqlalchemy import Integer, String, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class Student(Base):
    __tablename__ = "students"

    admission_number: Mapped[str] = mapped_column(
        String(20), primary_key=True
    )  # Permanent unique identity — never changes
    student_name: Mapped[str] = mapped_column(String(100), nullable=False)

    # --- Relationships ---
    enrollments: Mapped[list["StudentEnrollment"]] = relationship(
        "StudentEnrollment", back_populates="student", order_by="StudentEnrollment.id"
    )
    historical_reports: Mapped[list["HistoricalReport"]] = relationship(
        "HistoricalReport", back_populates="student"
    )

    def __repr__(self) -> str:
        return f"<Student(adm='{self.admission_number}', name='{self.student_name}')>"


class StudentEnrollment(Base):
    __tablename__ = "student_enrollments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # --- Foreign Keys ---
    admission_number: Mapped[str] = mapped_column(
        String(20), ForeignKey("students.admission_number"), nullable=False, index=True
    )
    academic_year_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("academic_years.id"), nullable=False
    )
    class_level_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("class_levels.id"), nullable=False
    )

    # --- Enrollment-specific data (changes yearly) ---
    section: Mapped[str] = mapped_column(String(5), nullable=False)  # e.g. "A", "B", "C"
    roll_number: Mapped[int] = mapped_column(Integer, nullable=False)

    # --- Constraints ---
    # A student can only be enrolled once per academic year, and roll number must be unique per section/class/year
    __table_args__ = (
        UniqueConstraint(
            "admission_number", "academic_year_id",
            name="uq_student_year_enrollment"
        ),
        UniqueConstraint(
            "academic_year_id", "class_level_id", "section", "roll_number",
            name="uq_year_class_section_roll"
        ),
    )

    # --- Relationships ---
    student: Mapped["Student"] = relationship("Student", back_populates="enrollments")
    academic_year: Mapped["AcademicYear"] = relationship("AcademicYear", back_populates="enrollments")
    class_level: Mapped["ClassLevel"] = relationship("ClassLevel", back_populates="enrollments")
    results: Mapped[list["StudentResult"]] = relationship(
        "StudentResult", back_populates="enrollment"
    )

    def __repr__(self) -> str:
        return (
            f"<StudentEnrollment(id={self.id}, adm='{self.admission_number}', "
            f"year_id={self.academic_year_id}, class_id={self.class_level_id}, "
            f"sec='{self.section}', roll={self.roll_number})>"
        )
