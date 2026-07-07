"""
SPARSH - Marks Entry Endpoints

APIs for manual marks entry via a spreadsheet-style grid:
- GET  /load  — Load enrolled students + existing marks for a class/section/exam
- POST /save  — Batch upsert marks for multiple students

Authorization:
- Admin / Teacher: Full access (load and save)
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_db, require_role
from app.models.user import User
from app.models.academic import AcademicYear, ClassLevel, Subject, Exam
from app.models.student import Student, StudentEnrollment
from app.models.result import StudentResult

router = APIRouter()


# ============================================
# Schemas (local to this module)
# ============================================

class SubjectMarkEntry(BaseModel):
    """A single subject mark for one student."""
    subject_id: int
    marks_obtained: float | None = None
    grade: str | None = None


class StudentMarkEntry(BaseModel):
    """All subject marks for one student."""
    admission_number: str
    results: list[SubjectMarkEntry]


class MaxMarksEntry(BaseModel):
    """Max marks for a subject."""
    subject_id: int
    max_marks: float


class MarksSaveRequest(BaseModel):
    """Full batch save payload from the marks entry grid."""
    class_level_id: int
    section: str
    exam_id: int
    max_marks: list[MaxMarksEntry] = []
    entries: list[StudentMarkEntry]


class MarksSaveResponse(BaseModel):
    """Summary of the batch save operation."""
    saved_count: int
    updated_count: int
    created_count: int
    errors: list[str]


class ExistingResult(BaseModel):
    """A single existing result for pre-populating the grid."""
    subject_id: int
    marks_obtained: float | None = None
    max_marks: float | None = None
    grade: str | None = None


class StudentWithResults(BaseModel):
    """A student with their existing results for the grid."""
    admission_number: str
    student_name: str
    roll_number: int
    enrollment_id: int
    results: list[ExistingResult]


class MarksLoadResponse(BaseModel):
    """Full grid data returned by the load endpoint."""
    academic_year_label: str
    class_name: str
    section: str
    exam_name: str
    subjects: list[dict]  # [{id, subject_name, subject_code}]
    students: list[StudentWithResults]


# ============================================
# GET — Load Students & Existing Marks
# ============================================

@router.get("/load", response_model=MarksLoadResponse)
def load_marks_grid(
    class_level_id: int = Query(...),
    section: str = Query(...),
    exam_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "teacher")),
):
    """
    Load all enrolled students for a class/section in the current academic year,
    along with any existing results for the specified exam.
    Used to pre-populate the marks entry grid.
    """
    # Get current academic year
    current_year = db.query(AcademicYear).filter_by(is_current=True).first()
    if not current_year:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active academic year is configured.",
        )

    # Validate class level
    class_level = db.query(ClassLevel).filter_by(id=class_level_id).first()
    if not class_level:
        raise HTTPException(status_code=404, detail="Class level not found.")

    # Validate exam
    exam = db.query(Exam).filter_by(id=exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")

    # Fetch enrolled students
    enrollments = (
        db.query(StudentEnrollment)
        .join(Student, StudentEnrollment.admission_number == Student.admission_number)
        .filter(
            StudentEnrollment.academic_year_id == current_year.id,
            StudentEnrollment.class_level_id == class_level_id,
            StudentEnrollment.section == section.upper(),
        )
        .options(joinedload(StudentEnrollment.student))
        .order_by(StudentEnrollment.roll_number)
        .all()
    )

    if not enrollments:
        raise HTTPException(
            status_code=404,
            detail=f"No students enrolled in {class_level.class_name} - {section.upper()} for {current_year.year_label}.",
        )

    # Fetch all subjects
    subjects = db.query(Subject).order_by(Subject.subject_name).all()

    # Fetch existing results for these enrollments + exam
    enrollment_ids = [e.id for e in enrollments]
    existing_results = (
        db.query(StudentResult)
        .filter(
            StudentResult.student_enrollment_id.in_(enrollment_ids),
            StudentResult.exam_id == exam_id,
        )
        .all()
    )

    # Build a lookup: enrollment_id -> {subject_id -> result}
    results_map: dict[int, dict[int, StudentResult]] = {}
    for r in existing_results:
        results_map.setdefault(r.student_enrollment_id, {})[r.subject_id] = r

    # Build response
    students_data = []
    for enrollment in enrollments:
        student_results = results_map.get(enrollment.id, {})
        students_data.append(
            StudentWithResults(
                admission_number=enrollment.admission_number,
                student_name=enrollment.student.student_name,
                roll_number=enrollment.roll_number,
                enrollment_id=enrollment.id,
                results=[
                    ExistingResult(
                        subject_id=r.subject_id,
                        marks_obtained=r.marks_obtained,
                        max_marks=r.max_marks,
                        grade=r.grade,
                    )
                    for r in student_results.values()
                ],
            )
        )

    return MarksLoadResponse(
        academic_year_label=current_year.year_label,
        class_name=class_level.class_name,
        section=section.upper(),
        exam_name=exam.exam_name,
        subjects=[
            {"id": s.id, "subject_name": s.subject_name, "subject_code": s.subject_code}
            for s in subjects
        ],
        students=students_data,
    )


# ============================================
# POST — Batch Save Marks (Upsert)
# ============================================

@router.post("/save", response_model=MarksSaveResponse)
def save_marks(
    payload: MarksSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "teacher")),
):
    """
    Batch save marks for multiple students.
    Uses upsert logic: updates existing results, creates new ones.
    """
    # Get current academic year
    current_year = db.query(AcademicYear).filter_by(is_current=True).first()
    if not current_year:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active academic year is configured.",
        )

    # Validate exam
    exam = db.query(Exam).filter_by(id=payload.exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")

    # Validate class level
    class_level = db.query(ClassLevel).filter_by(id=payload.class_level_id).first()
    if not class_level:
        raise HTTPException(status_code=404, detail="Class level not found.")

    # Build max marks lookup from payload
    max_marks_map: dict[int, float] = {}
    for mm in payload.max_marks:
        max_marks_map[mm.subject_id] = mm.max_marks

    # Validate all subject IDs
    valid_subject_ids = {s.id for s in db.query(Subject.id).all()}

    errors: list[str] = []
    saved_count = 0
    updated_count = 0
    created_count = 0

    for entry in payload.entries:
        # Find enrollment
        enrollment = db.query(StudentEnrollment).filter_by(
            admission_number=entry.admission_number,
            academic_year_id=current_year.id,
            class_level_id=payload.class_level_id,
            section=payload.section.upper(),
        ).first()

        if not enrollment:
            errors.append(f"Enrollment not found for student {entry.admission_number}.")
            continue

        for result_entry in entry.results:
            if result_entry.subject_id not in valid_subject_ids:
                errors.append(
                    f"Invalid subject ID {result_entry.subject_id} for student {entry.admission_number}."
                )
                continue

            # Skip entries where no marks or grade is provided
            if result_entry.marks_obtained is None and not result_entry.grade:
                continue

            # Check for existing result (upsert)
            existing = db.query(StudentResult).filter_by(
                student_enrollment_id=enrollment.id,
                subject_id=result_entry.subject_id,
                exam_id=payload.exam_id,
            ).first()

            max_marks_val = max_marks_map.get(result_entry.subject_id)

            if existing:
                # Update
                existing.marks_obtained = result_entry.marks_obtained
                existing.grade = result_entry.grade
                if max_marks_val is not None:
                    existing.max_marks = max_marks_val
                updated_count += 1
            else:
                # Create
                new_result = StudentResult(
                    student_enrollment_id=enrollment.id,
                    subject_id=result_entry.subject_id,
                    exam_id=payload.exam_id,
                    marks_obtained=result_entry.marks_obtained,
                    max_marks=max_marks_val,
                    grade=result_entry.grade,
                )
                db.add(new_result)
                created_count += 1

            saved_count += 1

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save marks: {str(e)}",
        )

    return MarksSaveResponse(
        saved_count=saved_count,
        updated_count=updated_count,
        created_count=created_count,
        errors=errors,
    )
