"""
School Result Analysis System - Student Schemas

Pydantic DTOs for Student and StudentEnrollment
validation and serialization.
"""

from pydantic import BaseModel, ConfigDict


# ============================================
# Student Schemas
# ============================================

class StudentCreate(BaseModel):
    """Request body for creating a new student."""
    admission_number: str  # Permanent unique ID — immutable after creation
    student_name: str


class StudentUpdate(BaseModel):
    """Request body for updating a student. Admission number cannot change."""
    student_name: str


class StudentResponse(BaseModel):
    """Student identity returned by API."""
    admission_number: str
    student_name: str

    model_config = ConfigDict(from_attributes=True)


class StudentSearchResponse(BaseModel):
    """Student with current enrollment details."""
    admission_number: str
    student_name: str
    academic_year: str | None = None
    class_name: str | None = None
    section: str | None = None
    roll_number: int | None = None


# ============================================
# Student Enrollment Schemas
# ============================================

class EnrollmentCreate(BaseModel):
    """Request body for enrolling a student in an academic year."""
    admission_number: str
    academic_year_id: int
    class_level_id: int
    section: str  # e.g. "A", "B", "C"
    roll_number: int


class EnrollmentUpdate(BaseModel):
    """Request body for updating an enrollment (section/roll changes)."""
    class_level_id: int | None = None
    section: str | None = None
    roll_number: int | None = None


class EnrollmentResponse(BaseModel):
    """Full enrollment record returned by API."""
    id: int
    admission_number: str
    academic_year_id: int
    class_level_id: int
    section: str
    roll_number: int

    # Resolved names for display convenience
    student_name: str | None = None
    year_label: str | None = None
    class_name: str | None = None

    model_config = ConfigDict(from_attributes=True)


class PaginatedStudentSearchResponse(BaseModel):
    """Paginated list of student search results."""
    total: int
    items: list[StudentSearchResponse]


class PaginatedEnrollmentResponse(BaseModel):
    """Paginated list of enrollments."""
    total: int
    items: list[EnrollmentResponse]
