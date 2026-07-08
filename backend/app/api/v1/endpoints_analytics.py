"""
School Result Analysis System - Performance Analytics Endpoints

Read-only aggregation APIs for cross-year performance comparison.
All percentages are calculated server-side as marks_obtained / max_marks * 100.
Raw marks are never stored; percentage is a computed view only.

Three views:
  a) Student trend   — one student across all years they have results for
  b) Class trend     — a class+section label across multiple years (cohort-label semantics)
  c) Subject trend   — a subject across years, optionally filtered by class

Authorization: All authenticated users (admin, teacher, principal).
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.api.deps import get_db, get_current_active_user
from app.models.user import User
from app.models.student import Student, StudentEnrollment
from app.models.academic import AcademicYear, ClassLevel, Subject, Exam
from app.models.result import StudentResult

router = APIRouter()


# ============================================================
# SCHEMA-LIKE RESPONSE HELPERS (inline dicts — no Pydantic needed
# for these read-only analytics payloads)
# ============================================================


# ============================================================
# a) STUDENT TREND VIEW
# ============================================================

@router.get("/student/{admission_number}")
def get_student_trend(
    admission_number: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    For a given student (admission_number), return their performance
    per subject across every academic year they have results for.

    Returns avg_marks and avg_percentage per (year, subject) pair.
    Years/subjects with no results are absent from the response
    (frontend renders as Chart.js gaps using spanGaps: false).
    """
    student = db.query(Student).filter_by(admission_number=admission_number).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    # Join: StudentResult → StudentEnrollment → AcademicYear + Subject
    rows = (
        db.query(
            AcademicYear.year_label,
            AcademicYear.id.label("year_id"),
            Subject.subject_name,
            Subject.id.label("subject_id"),
            func.avg(StudentResult.marks_obtained).label("avg_marks"),
            func.avg(StudentResult.max_marks).label("avg_max"),
            func.count(StudentResult.id).label("result_count"),
        )
        .join(StudentEnrollment, StudentResult.student_enrollment_id == StudentEnrollment.id)
        .join(AcademicYear, StudentEnrollment.academic_year_id == AcademicYear.id)
        .join(Subject, StudentResult.subject_id == Subject.id)
        .filter(
            StudentEnrollment.admission_number == admission_number,
            StudentResult.marks_obtained.isnot(None),
            StudentResult.max_marks.isnot(None),
            StudentResult.max_marks > 0,
        )
        .group_by(AcademicYear.id, Subject.id)
        .order_by(AcademicYear.year_label, Subject.subject_name)
        .all()
    )

    data = []
    for r in rows:
        avg_pct = round((r.avg_marks / r.avg_max) * 100, 2) if r.avg_max else None
        data.append({
            "year_label": r.year_label,
            "year_id": r.year_id,
            "subject_name": r.subject_name,
            "subject_id": r.subject_id,
            "avg_marks": round(r.avg_marks, 2) if r.avg_marks is not None else None,
            "avg_percentage": avg_pct,
            "result_count": r.result_count,
        })

    return {
        "admission_number": admission_number,
        "student_name": student.student_name,
        "data": data,
    }


# ============================================================
# b) CLASS / SECTION TREND VIEW
# ============================================================

@router.get("/class")
def get_class_trend(
    class_level_id: int = Query(..., description="Class level ID"),
    section: str = Query(..., description="Section (e.g. A)"),
    subject_id: int | None = Query(None, description="Filter by subject (optional)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    For a given class-level + section label, return average performance
    per subject across all academic years that have enrollment data.

    IMPORTANT — cohort-label semantics:
    This compares the class/section *label* across years, not the same
    individual students. Students in Class 6-A in 2023-24 are a different
    group from students in Class 6-A in 2024-25.
    The UI must label this distinction clearly.

    Returns avg_marks, avg_percentage, and student_count per (year, subject).
    Missing year/subject combinations are absent (frontend renders as gaps).
    """
    cls = db.query(ClassLevel).filter_by(id=class_level_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class level not found.")

    query = (
        db.query(
            AcademicYear.year_label,
            AcademicYear.id.label("year_id"),
            Subject.subject_name,
            Subject.id.label("subject_id"),
            func.avg(StudentResult.marks_obtained).label("avg_marks"),
            func.avg(StudentResult.max_marks).label("avg_max"),
            func.count(func.distinct(StudentEnrollment.admission_number)).label("student_count"),
        )
        .join(StudentEnrollment, StudentResult.student_enrollment_id == StudentEnrollment.id)
        .join(AcademicYear, StudentEnrollment.academic_year_id == AcademicYear.id)
        .join(Subject, StudentResult.subject_id == Subject.id)
        .filter(
            StudentEnrollment.class_level_id == class_level_id,
            StudentEnrollment.section == section.upper(),
            StudentResult.marks_obtained.isnot(None),
            StudentResult.max_marks.isnot(None),
            StudentResult.max_marks > 0,
        )
    )

    if subject_id:
        query = query.filter(StudentResult.subject_id == subject_id)

    rows = (
        query
        .group_by(AcademicYear.id, Subject.id)
        .order_by(AcademicYear.year_label, Subject.subject_name)
        .all()
    )

    data = []
    for r in rows:
        avg_pct = round((r.avg_marks / r.avg_max) * 100, 2) if r.avg_max else None
        data.append({
            "year_label": r.year_label,
            "year_id": r.year_id,
            "subject_name": r.subject_name,
            "subject_id": r.subject_id,
            "avg_marks": round(r.avg_marks, 2) if r.avg_marks is not None else None,
            "avg_percentage": avg_pct,
            "student_count": r.student_count,
        })

    return {
        "class_name": cls.class_name,
        "section": section.upper(),
        "note": "Cohort-label view: compares students occupying this class/section label per year, not the same individuals across years.",
        "data": data,
    }


# ============================================================
# c) SUBJECT-WIDE TREND VIEW
# ============================================================

@router.get("/subject/{subject_id}")
def get_subject_trend(
    subject_id: int,
    class_level_id: int | None = Query(None, description="Filter by class (optional; omit for school-wide)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    For a given subject, return average performance across academic years.

    - If class_level_id is provided: results grouped by (year, class).
    - If omitted: results grouped by (year, class) across all classes,
      giving a per-class breakdown per year (grouped bar chart).

    Returns avg_marks, avg_percentage, and student_count per (year, class).
    Missing combinations are absent (frontend renders as gaps).
    """
    subject = db.query(Subject).filter_by(id=subject_id).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found.")

    query = (
        db.query(
            AcademicYear.year_label,
            AcademicYear.id.label("year_id"),
            ClassLevel.class_name,
            ClassLevel.id.label("class_id"),
            func.avg(StudentResult.marks_obtained).label("avg_marks"),
            func.avg(StudentResult.max_marks).label("avg_max"),
            func.count(func.distinct(StudentEnrollment.admission_number)).label("student_count"),
        )
        .join(StudentEnrollment, StudentResult.student_enrollment_id == StudentEnrollment.id)
        .join(AcademicYear, StudentEnrollment.academic_year_id == AcademicYear.id)
        .join(ClassLevel, StudentEnrollment.class_level_id == ClassLevel.id)
        .filter(
            StudentResult.subject_id == subject_id,
            StudentResult.marks_obtained.isnot(None),
            StudentResult.max_marks.isnot(None),
            StudentResult.max_marks > 0,
        )
    )

    if class_level_id:
        query = query.filter(StudentEnrollment.class_level_id == class_level_id)

    rows = (
        query
        .group_by(AcademicYear.id, ClassLevel.id)
        .order_by(AcademicYear.year_label, ClassLevel.display_order)
        .all()
    )

    data = []
    for r in rows:
        avg_pct = round((r.avg_marks / r.avg_max) * 100, 2) if r.avg_max else None
        data.append({
            "year_label": r.year_label,
            "year_id": r.year_id,
            "class_name": r.class_name,
            "class_id": r.class_id,
            "avg_marks": round(r.avg_marks, 2) if r.avg_marks is not None else None,
            "avg_percentage": avg_pct,
            "student_count": r.student_count,
        })

    return {
        "subject_name": subject.subject_name,
        "subject_code": subject.subject_code,
        "filter_class_id": class_level_id,
        "data": data,
    }
