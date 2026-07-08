"""
School Result Analysis System - Academic Schemas

Pydantic DTOs for AcademicYear, ClassLevel, Subject, and Exam
validation and serialization.
"""

from pydantic import BaseModel, ConfigDict


# ============================================
# Academic Year Schemas
# ============================================

class AcademicYearCreate(BaseModel):
    """Request body for creating a new academic year."""
    year_label: str  # e.g. "2025-2026"
    is_current: bool = False


class AcademicYearUpdate(BaseModel):
    """Request body for updating an academic year."""
    year_label: str | None = None
    is_current: bool | None = None


class AcademicYearResponse(BaseModel):
    """Academic year returned by API."""
    id: int
    year_label: str
    is_current: bool

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Class Level Schemas
# ============================================

class ClassLevelCreate(BaseModel):
    """Request body for creating a new class level."""
    class_name: str  # e.g. "Class 6"
    display_order: int  # e.g. 6
    sections: str | None = None  # e.g. "A,B,C"


class ClassLevelUpdate(BaseModel):
    """Request body for updating a class level."""
    class_name: str | None = None
    display_order: int | None = None
    sections: str | None = None


class ClassLevelResponse(BaseModel):
    """Class level returned by API."""
    id: int
    class_name: str
    display_order: int
    sections: str | None

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Subject Schemas
# ============================================

class SubjectCreate(BaseModel):
    """Request body for creating a new subject."""
    subject_name: str  # e.g. "Mathematics"
    subject_code: str | None = None  # e.g. "MATH"


class SubjectUpdate(BaseModel):
    """Request body for updating a subject."""
    subject_name: str | None = None
    subject_code: str | None = None


class SubjectResponse(BaseModel):
    """Subject returned by API."""
    id: int
    subject_name: str
    subject_code: str | None

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Exam Schemas
# ============================================

class ExamCreate(BaseModel):
    """Request body for creating a new exam."""
    exam_name: str  # e.g. "PT1"
    display_order: int  # e.g. 1


class ExamUpdate(BaseModel):
    """Request body for updating an exam."""
    exam_name: str | None = None
    display_order: int | None = None


class ExamResponse(BaseModel):
    """Exam returned by API."""
    id: int
    exam_name: str
    display_order: int

    model_config = ConfigDict(from_attributes=True)
