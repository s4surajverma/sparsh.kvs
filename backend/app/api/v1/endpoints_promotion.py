"""
SPARSH - Bulk Promotion / Rollover Endpoint

POST /students/promote

Bulk-promotes all students enrolled in a source class/section/year into
a target class/section/year by creating new StudentEnrollment records.

Roll number handling modes (selected by admin):
  keep      — copy roll_number from source enrollment
  clear     — set roll_number to None in new enrollment
  auto      — assign sequential integers ordered by student_name (1, 2, 3...)

Exclusions: any admission_number in exclude_admission_numbers is skipped.
Conflicts: if target enrollment already exists, it is skipped and reported.

Authorization: Admin only.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_role
from app.models.user import User
from app.models.student import Student, StudentEnrollment
from app.models.academic import AcademicYear, ClassLevel

router = APIRouter()


class PromoteRequest(BaseModel):
    source_year_id: int
    source_class_level_id: int
    source_section: str
    target_year_id: int
    target_class_level_id: int
    target_section: str
    roll_number_mode: str = Field("keep", pattern="^(keep|clear|auto)$")
    exclude_admission_numbers: list[str] = []


@router.post("/promote")
def bulk_promote(
    req: PromoteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """
    Bulk-promote students from source class/section/year to a target.
    Returns counts and per-student outcome details.
    """
    # Validate references
    for year_id, label in [(req.source_year_id, "Source"), (req.target_year_id, "Target")]:
        if not db.query(AcademicYear).filter_by(id=year_id).first():
            raise HTTPException(status_code=404, detail=f"{label} academic year not found.")
    for cls_id, label in [(req.source_class_level_id, "Source"), (req.target_class_level_id, "Target")]:
        if not db.query(ClassLevel).filter_by(id=cls_id).first():
            raise HTTPException(status_code=404, detail=f"{label} class level not found.")

    # Fetch all source enrollments
    source_enrollments = (
        db.query(StudentEnrollment)
        .filter_by(
            academic_year_id=req.source_year_id,
            class_level_id=req.source_class_level_id,
            section=req.source_section.upper(),
        )
        .join(Student, StudentEnrollment.admission_number == Student.admission_number)
        .order_by(Student.student_name)
        .all()
    )

    exclude_set = {adm.strip().upper() for adm in req.exclude_admission_numbers}
    promoted = []
    already_enrolled = []
    excluded = []
    auto_counter = 1

    for enroll in source_enrollments:
        adm = enroll.admission_number

        if adm.upper() in exclude_set:
            excluded.append(adm)
            continue

        # Check for conflict in target
        existing = db.query(StudentEnrollment).filter_by(
            admission_number=adm,
            academic_year_id=req.target_year_id,
        ).first()

        if existing:
            already_enrolled.append(adm)
            continue

        # Determine roll number
        if req.roll_number_mode == "keep":
            roll = enroll.roll_number
        elif req.roll_number_mode == "clear":
            roll = None
        else:  # auto
            roll = auto_counter
            auto_counter += 1

        new_enroll = StudentEnrollment(
            admission_number=adm,
            academic_year_id=req.target_year_id,
            class_level_id=req.target_class_level_id,
            section=req.target_section.upper(),
            roll_number=roll,
        )
        db.add(new_enroll)
        promoted.append(adm)

    db.commit()

    return {
        "status": "completed",
        "roll_number_mode": req.roll_number_mode,
        "summary": {
            "promoted": len(promoted),
            "skipped_already_enrolled": len(already_enrolled),
            "skipped_excluded": len(excluded),
        },
        "promoted_admission_numbers": promoted,
        "already_enrolled": already_enrolled,
        "excluded": excluded,
    }
