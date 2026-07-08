"""
SPARSH - Student Master Import Endpoints

Three-step import wizard for bulk student master data:
  POST /students/import/analyze   — parse xlsx, detect columns, preview
  POST /students/import/dry-run   — validate rows, flag existing admission numbers
  POST /students/import/commit    — write students + enrollments per admin decisions

Design contract:
  - Import creates BOTH Student and StudentEnrollment records when
    class_level_id, section, and roll_number columns are present.
  - Duplicate admission numbers during dry-run are NOT auto-skipped.
    They are returned for admin decision: "keep" | "update_name".
  - Rule: This import only creates students. It never creates result
    records. Result Import must never create students automatically.
  - If a student already has a StudentEnrollment for the target year,
    enrollment creation is skipped and reported as a warning.

Authorization: Admin only.
"""

import io
import openpyxl

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_role
from app.models.user import User
from app.models.student import Student, StudentEnrollment
from app.models.academic import AcademicYear, ClassLevel

router_import = APIRouter()

REQUIRED_COLUMNS = {"admission_number", "student_name"}
ENROLLMENT_COLUMNS = {"class_level_id", "section", "roll_number"}


# ─────────────────────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────────────────────

def _validate_xlsx(file: UploadFile) -> None:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .xlsx files are supported.",
        )


def _parse_xlsx(file_bytes: bytes) -> tuple[list[str], list[dict]]:
    """Return (header_row, data_rows) from the first sheet of an xlsx file."""
    try:
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        wb.close()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read Excel file: {str(e)}")

    if not rows:
        raise HTTPException(status_code=400, detail="The uploaded file contains no data.")

    # First row = headers; normalize to lowercase stripped strings
    headers = [str(h).strip().lower().replace(" ", "_") if h else f"col_{i}" for i, h in enumerate(rows[0])]
    data_rows = []
    for row in rows[1:]:
        if all(v is None or str(v).strip() == "" for v in row):
            continue  # skip blank rows
        row_dict = {}
        for i, col in enumerate(headers):
            val = row[i] if i < len(row) else None
            row_dict[col] = str(val).strip() if val is not None and str(val).strip() != "" else None
        data_rows.append(row_dict)

    return headers, data_rows


def _normalize_admission(raw: str | None) -> str | None:
    if not raw:
        return None
    s = raw.strip()
    # Strip trailing .0 from numeric values read as floats
    if s.endswith(".0"):
        s = s[:-2]
    return s or None


# ─────────────────────────────────────────────────────────────
#  POST /students/import/analyze
# ─────────────────────────────────────────────────────────────

@router_import.post("/import/analyze")
async def analyze_student_import(
    file: UploadFile = File(...),
    current_user: User = Depends(require_role("admin")),
):
    """
    Parse the uploaded xlsx, detect column names, and return a preview of the first 10 rows.
    Does NOT write to the database.
    """
    _validate_xlsx(file)
    file_bytes = await file.read()
    headers, data_rows = _parse_xlsx(file_bytes)

    detected = {
        "admission_number": next((h for h in headers if "admission" in h or h == "adm"), None),
        "student_name": next((h for h in headers if "name" in h or h == "student_name"), None),
        "class_level_id": next((h for h in headers if "class" in h), None),
        "section": next((h for h in headers if h == "section"), None),
        "roll_number": next((h for h in headers if "roll" in h), None),
    }

    missing_required = [col for col in ["admission_number", "student_name"] if not detected.get(col)]
    has_enrollment_columns = all(detected.get(c) for c in ["class_level_id", "section", "roll_number"])

    return {
        "filename": file.filename,
        "total_rows": len(data_rows),
        "headers": headers,
        "detected_columns": detected,
        "has_enrollment_columns": has_enrollment_columns,
        "missing_required_columns": missing_required,
        "sample_rows": data_rows[:10],
        "issues": [f"Required column '{c}' not detected. Please verify the header row." for c in missing_required],
    }


# ─────────────────────────────────────────────────────────────
#  POST /students/import/dry-run
# ─────────────────────────────────────────────────────────────

@router_import.post("/import/dry-run")
async def dry_run_student_import(
    file: UploadFile = File(...),
    target_year_id: int = Form(..., description="Target AcademicYear.id for enrollment creation"),
    adm_col: str = Form("admission_number", description="Header name for admission number column"),
    name_col: str = Form("student_name", description="Header name for student name column"),
    class_col: str = Form(None, description="Header for class name (matched to ClassLevel.class_name)"),
    section_col: str = Form(None, description="Header for section"),
    roll_col: str = Form(None, description="Header for roll number"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """
    Validate all rows without writing. Returns:
      - new_students:      rows that will create brand-new Student records
      - existing_students: rows whose admission_number already exists in DB
                           (requires admin decision: keep | update_name)
      - enrollment_conflicts: rows already enrolled in the target year
      - errors:            rows with missing required fields
    """
    _validate_xlsx(file)
    file_bytes = await file.read()
    _, data_rows = _parse_xlsx(file_bytes)

    year = db.query(AcademicYear).filter_by(id=target_year_id).first()
    if not year:
        raise HTTPException(status_code=404, detail="Target academic year not found.")

    # Pre-build class name → id lookup for enrollment creation
    class_lookup: dict[str, int] = {}
    for cls in db.query(ClassLevel).all():
        class_lookup[cls.class_name.strip().lower()] = cls.id

    new_students = []
    existing_students = []
    enrollment_conflicts = []
    errors = []

    for idx, row in enumerate(data_rows):
        row_num = idx + 2  # 1-based, accounting for header

        adm = _normalize_admission(row.get(adm_col))
        name = row.get(name_col)

        if not adm:
            errors.append({"row": row_num, "message": "Admission number is blank."})
            continue
        if not name:
            errors.append({"row": row_num, "admission_number": adm, "message": "Student name is blank."})
            continue

        existing = db.query(Student).filter_by(admission_number=adm).first()

        entry = {
            "row": row_num,
            "admission_number": adm,
            "file_name": name,
        }

        if existing:
            entry["db_name"] = existing.student_name
            entry["name_changed"] = existing.student_name.strip().lower() != name.strip().lower()

            # Check for enrollment conflict
            if class_col and section_col:
                has_enrollment = db.query(StudentEnrollment).filter_by(
                    admission_number=adm, academic_year_id=target_year_id
                ).first()
                if has_enrollment:
                    entry["enrollment_conflict"] = True
                    enrollment_conflicts.append(entry)
                    continue

            existing_students.append(entry)
        else:
            # Resolve class → class_level_id for preview
            resolved_class_id = None
            class_warn = None
            if class_col:
                raw_class = row.get(class_col, "")
                if raw_class:
                    resolved_class_id = class_lookup.get(raw_class.strip().lower())
                    if not resolved_class_id:
                        class_warn = f"Class '{raw_class}' not found in DB; enrollment will not be created."

            entry["resolved_class_id"] = resolved_class_id
            entry["section"] = row.get(section_col) if section_col else None
            entry["roll_number"] = row.get(roll_col) if roll_col else None
            if class_warn:
                entry["warning"] = class_warn
            new_students.append(entry)

    return {
        "target_year": year.year_label,
        "total_rows": len(data_rows),
        "new_students": new_students,
        "existing_students": existing_students,
        "enrollment_conflicts": enrollment_conflicts,
        "errors": errors,
        "summary": {
            "will_create": len(new_students),
            "require_decision": len(existing_students),
            "conflicts_skipped": len(enrollment_conflicts),
            "errors": len(errors),
        }
    }


# ─────────────────────────────────────────────────────────────
#  POST /students/import/commit
# ─────────────────────────────────────────────────────────────

@router_import.post("/import/commit")
async def commit_student_import(
    file: UploadFile = File(...),
    target_year_id: int = Form(...),
    adm_col: str = Form("admission_number"),
    name_col: str = Form("student_name"),
    class_col: str = Form(None),
    section_col: str = Form(None),
    roll_col: str = Form(None),
    decisions_json: str = Form("{}",
        description='JSON: { "ADM001": "keep" | "update_name" }'),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """
    Commit the import based on admin decisions for existing students.

    For each row:
    - NEW student → always create Student; create Enrollment if class info present
    - EXISTING student, decision="keep"        → no name change, still create Enrollment
    - EXISTING student, decision="update_name" → update student_name, create Enrollment
    - EXISTING student, no decision provided   → skip (treated as "keep" by default)

    Enrollment creation is skipped (with warning) if student already enrolled in target year.
    """
    import json as _json
    _validate_xlsx(file)

    try:
        decisions: dict[str, str] = _json.loads(decisions_json)
    except Exception:
        raise HTTPException(status_code=400, detail="decisions_json must be a valid JSON object.")

    file_bytes = await file.read()
    _, data_rows = _parse_xlsx(file_bytes)

    year = db.query(AcademicYear).filter_by(id=target_year_id).first()
    if not year:
        raise HTTPException(status_code=404, detail="Target academic year not found.")

    class_lookup: dict[str, int] = {}
    for cls in db.query(ClassLevel).all():
        class_lookup[cls.class_name.strip().lower()] = cls.id

    created_students = 0
    updated_students = 0
    created_enrollments = 0
    skipped_conflicts = 0
    skipped_errors = 0
    row_details = []

    for idx, row in enumerate(data_rows):
        row_num = idx + 2
        adm = _normalize_admission(row.get(adm_col))
        name = row.get(name_col)

        if not adm or not name:
            skipped_errors += 1
            row_details.append({"row": row_num, "status": "error", "message": "Missing admission number or student name."})
            continue

        # Resolve class → class_level_id
        class_level_id = None
        section = row.get(section_col) if section_col else None
        roll_number_raw = row.get(roll_col) if roll_col else None
        try:
            roll_number = int(float(roll_number_raw)) if roll_number_raw else None
        except (ValueError, TypeError):
            roll_number = None

        if class_col:
            raw_class = row.get(class_col, "")
            if raw_class:
                class_level_id = class_lookup.get(raw_class.strip().lower())

        # Get or create Student
        student = db.query(Student).filter_by(admission_number=adm).first()
        decision = decisions.get(adm, "keep")

        if student is None:
            student = Student(admission_number=adm, student_name=name)
            db.add(student)
            db.flush()  # get the row without committing
            created_students += 1
            row_status = "created"
        elif decision == "update_name":
            student.student_name = name
            updated_students += 1
            row_status = "updated"
        else:
            row_status = "kept"

        # Create Enrollment if eligible
        enroll_msg = None
        if class_level_id and section:
            existing_enroll = db.query(StudentEnrollment).filter_by(
                admission_number=adm, academic_year_id=target_year_id
            ).first()
            if existing_enroll:
                skipped_conflicts += 1
                enroll_msg = "Already enrolled in target year — enrollment skipped."
            else:
                enrollment = StudentEnrollment(
                    admission_number=adm,
                    academic_year_id=target_year_id,
                    class_level_id=class_level_id,
                    section=section.upper(),
                    roll_number=roll_number,
                )
                db.add(enrollment)
                created_enrollments += 1
                enroll_msg = f"Enrolled in {year.year_label}."
        elif class_col:
            enroll_msg = "Class not found in database — enrollment skipped."

        row_details.append({
            "row": row_num,
            "admission_number": adm,
            "student_name": name,
            "status": row_status,
            "enrollment": enroll_msg,
        })

    db.commit()

    return {
        "status": "completed",
        "summary": {
            "students_created": created_students,
            "students_updated": updated_students,
            "students_kept": sum(1 for r in row_details if r.get("status") == "kept"),
            "enrollments_created": created_enrollments,
            "enrollment_conflicts_skipped": skipped_conflicts,
            "errors": skipped_errors,
        },
        "row_details": row_details,
    }
