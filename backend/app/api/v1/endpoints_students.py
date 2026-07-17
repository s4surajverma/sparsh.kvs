"""
School Result Analysis System - Student & Enrollment Endpoints

APIs for:
- Student registry (create, get, search, update)
- Student enrollment (create, update)

Authorization:
- Admin: Full CRUD access
- Teacher / Principal: Read-only access

Key Rules:
- Admission Number is immutable after creation.
- A student can only be enrolled once per academic year.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import (
    get_db,
    get_current_active_user,
    get_current_admin,
)
from app.models.user import User
from app.models.student import Student, StudentEnrollment
from app.models.result import StudentResult
from app.models.report import HistoricalReport
from app.models.academic import AcademicYear, ClassLevel
from app.schemas.student_schema import (
    StudentCreate, StudentUpdate, StudentResponse, StudentSearchResponse,
    PaginatedStudentSearchResponse, PaginatedEnrollmentResponse,
    EnrollmentCreate, EnrollmentUpdate, EnrollmentResponse,
)

router = APIRouter()


# ============================================
# STUDENT ENDPOINTS
# ============================================

@router.post("/", response_model=StudentResponse, status_code=status.HTTP_201_CREATED)
def create_student(
    data: StudentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """
    Register a new student with a permanent Admission Number. Admin only.
    If class_level_id, section, and roll_number are provided, also enrolls
    the student in the currently active academic year.
    """
    existing = db.query(Student).filter_by(
        admission_number=data.admission_number
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Student with Admission Number '{data.admission_number}' already exists.",
        )

    student = Student(
        admission_number=data.admission_number,
        student_name=data.student_name,
    )
    db.add(student)

    if data.class_level_id and data.section and data.roll_number is not None:
        current_year = db.query(AcademicYear).filter_by(is_current=True).first()
        if not current_year:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No active academic year configured. Cannot enroll student.",
            )
        cls = db.query(ClassLevel).filter_by(id=data.class_level_id).first()
        if not cls:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid class level ID.",
            )

        # Check for duplicate roll number in same class/section/year
        roll_conflict = db.query(StudentEnrollment).filter_by(
            academic_year_id=current_year.id,
            class_level_id=data.class_level_id,
            section=data.section.upper(),
            roll_number=data.roll_number,
        ).first()
        if roll_conflict:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Roll number {data.roll_number} is already assigned to another student in {cls.class_name} – {data.section.upper()} for this academic year.",
            )

        enrollment = StudentEnrollment(
            admission_number=student.admission_number,
            academic_year_id=current_year.id,
            class_level_id=data.class_level_id,
            section=data.section.upper(),
            roll_number=data.roll_number,
        )
        db.add(enrollment)

    db.commit()
    db.refresh(student)
    return student


@router.get("/search", response_model=PaginatedStudentSearchResponse)
def search_students(
    q: str | None = Query(None, description="Search by name or admission number"),
    class_level_id: int | None = Query(None, description="Filter by class level"),
    section: str | None = Query(None, description="Filter by section"),
    academic_year_id: int | None = Query(None, description="Filter by academic year (defaults to current)"),
    skip: int = Query(0, ge=0, description="Pagination skip"),
    limit: int = Query(100, ge=1, le=200, description="Pagination limit"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Search students with optional filters.
    Returns student identity along with enrollment details for the specified year.
    """
    # Determine which academic year to search in
    if academic_year_id is None:
        current_year = db.query(AcademicYear).filter_by(is_current=True).first()
        if current_year:
            academic_year_id = current_year.id

    # Build base query joining students with enrollments
    query = (
        db.query(
            Student.admission_number,
            Student.student_name,
            AcademicYear.year_label,
            ClassLevel.class_name,
            ClassLevel.id.label('class_level_id'),
            StudentEnrollment.id.label('enrollment_id'),
            StudentEnrollment.section,
            StudentEnrollment.roll_number,
        )
        .outerjoin(
            StudentEnrollment,
            (Student.admission_number == StudentEnrollment.admission_number)
            & (StudentEnrollment.academic_year_id == academic_year_id)
            if academic_year_id
            else (Student.admission_number == StudentEnrollment.admission_number)
        )
        .outerjoin(AcademicYear, StudentEnrollment.academic_year_id == AcademicYear.id)
        .outerjoin(ClassLevel, StudentEnrollment.class_level_id == ClassLevel.id)
    )

    # Apply filters
    if q:
        search_term = f"%{q}%"
        query = query.filter(
            (Student.student_name.ilike(search_term))
            | (Student.admission_number.ilike(search_term))
        )

    if class_level_id:
        query = query.filter(StudentEnrollment.class_level_id == class_level_id)

    if section:
        query = query.filter(StudentEnrollment.section == section.upper())

    total = query.count()
    results = query.order_by(Student.student_name).offset(skip).limit(limit).all()

    items = [
        StudentSearchResponse(
            admission_number=r.admission_number,
            student_name=r.student_name,
            academic_year=r.year_label,
            class_name=r.class_name,
            class_id=r.class_level_id,
            section=r.section,
            roll_number=r.roll_number,
            enrollment_id=r.enrollment_id,
        )
        for r in results
    ]
    return {"total": total, "items": items}


@router.get("/{admission_number}", response_model=StudentResponse)
def get_student(
    admission_number: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get a student by their permanent Admission Number."""
    student = db.query(Student).filter_by(
        admission_number=admission_number
    ).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")
    return student


@router.put("/{admission_number}", response_model=StudentResponse)
def update_student(
    admission_number: str,
    data: StudentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """
    Update a student's name. Admin only.
    Admission Number is immutable and cannot be changed.
    """
    student = db.query(Student).filter_by(
        admission_number=admission_number
    ).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    student.student_name = data.student_name
    db.commit()
    db.refresh(student)
    return student


@router.delete("/{admission_number}", status_code=status.HTTP_204_NO_CONTENT)
def delete_student(
    admission_number: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """
    Delete a student and all associated enrollments, results, and historical reports.
    Admin only.
    """
    student_exists = db.query(Student.admission_number).filter_by(
        admission_number=admission_number
    ).first()
    if not student_exists:
        raise HTTPException(status_code=404, detail="Student not found.")

    # Find all enrollment IDs for this student directly via query without loading ORM objects
    enrollment_ids = [
        r[0] for r in db.query(StudentEnrollment.id).filter_by(admission_number=admission_number).all()
    ]
    if enrollment_ids:
        # Delete results tied to those enrollments
        db.query(StudentResult).filter(StudentResult.student_enrollment_id.in_(enrollment_ids)).delete(
            synchronize_session=False
        )

    # Delete enrollments
    db.query(StudentEnrollment).filter_by(admission_number=admission_number).delete(
        synchronize_session=False
    )

    # Delete historical reports
    db.query(HistoricalReport).filter_by(admission_number=admission_number).delete(
        synchronize_session=False
    )

    # Delete student
    db.query(Student).filter_by(admission_number=admission_number).delete(
        synchronize_session=False
    )
    db.commit()


# ============================================
# ENROLLMENT ENDPOINTS
# ============================================

@router.post("/enrollments", response_model=EnrollmentResponse, status_code=status.HTTP_201_CREATED)
def create_enrollment(
    data: EnrollmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """
    Enroll a student into an academic year with class, section, and roll number.
    Admin only. Enforces unique enrollment per student per year.
    """
    # Validate student exists
    student = db.query(Student).filter_by(
        admission_number=data.admission_number
    ).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    # Validate academic year exists
    year = db.query(AcademicYear).filter_by(id=data.academic_year_id).first()
    if not year:
        raise HTTPException(status_code=404, detail="Academic year not found.")

    # Validate class level exists
    cls = db.query(ClassLevel).filter_by(id=data.class_level_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class level not found.")

    # Check for duplicate enrollment (same student + same year)
    existing = db.query(StudentEnrollment).filter_by(
        admission_number=data.admission_number,
        academic_year_id=data.academic_year_id,
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Student '{data.admission_number}' is already enrolled in this academic year.",
        )

    # Check for duplicate roll number in same class/section/year
    roll_conflict = db.query(StudentEnrollment).filter_by(
        academic_year_id=data.academic_year_id,
        class_level_id=data.class_level_id,
        section=data.section.upper(),
        roll_number=data.roll_number,
    ).first()
    if roll_conflict:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Roll number {data.roll_number} is already assigned to another student in {cls.class_name} – {data.section.upper()} for this academic year.",
        )

    enrollment = StudentEnrollment(**data.model_dump())
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)

    return EnrollmentResponse(
        id=enrollment.id,
        admission_number=enrollment.admission_number,
        academic_year_id=enrollment.academic_year_id,
        class_level_id=enrollment.class_level_id,
        section=enrollment.section,
        roll_number=enrollment.roll_number,
        student_name=student.student_name,
        year_label=year.year_label,
        class_name=cls.class_name,
    )


@router.get("/enrollments/by-year/{academic_year_id}", response_model=PaginatedEnrollmentResponse)
def list_enrollments_by_year(
    academic_year_id: int,
    class_level_id: int | None = Query(None, description="Filter by class"),
    section: str | None = Query(None, description="Filter by section"),
    skip: int = Query(0, ge=0, description="Pagination skip"),
    limit: int = Query(100, ge=1, le=200, description="Pagination limit"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    List all enrollments for a given academic year.
    Optionally filter by class and section.
    """
    query = (
        db.query(
            StudentEnrollment,
            Student.student_name,
            AcademicYear.year_label,
            ClassLevel.class_name,
        )
        .join(Student, StudentEnrollment.admission_number == Student.admission_number)
        .join(AcademicYear, StudentEnrollment.academic_year_id == AcademicYear.id)
        .join(ClassLevel, StudentEnrollment.class_level_id == ClassLevel.id)
        .filter(StudentEnrollment.academic_year_id == academic_year_id)
    )

    if class_level_id:
        query = query.filter(StudentEnrollment.class_level_id == class_level_id)
    if section:
        query = query.filter(StudentEnrollment.section == section.upper())

    total = query.count()
    query = query.order_by(ClassLevel.display_order, StudentEnrollment.section, StudentEnrollment.roll_number)
    results = query.offset(skip).limit(limit).all()

    items = [
        EnrollmentResponse(
            id=enrollment.id,
            admission_number=enrollment.admission_number,
            academic_year_id=enrollment.academic_year_id,
            class_level_id=enrollment.class_level_id,
            section=enrollment.section,
            roll_number=enrollment.roll_number,
            student_name=student_name,
            year_label=year_label,
            class_name=class_name,
        )
        for enrollment, student_name, year_label, class_name in results
    ]
    return {"total": total, "items": items}


@router.get("/{admission_number}/enrollments", response_model=list[EnrollmentResponse])
def get_student_enrollments(
    admission_number: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get all enrollments (history) for a specific student."""
    student = db.query(Student).filter_by(
        admission_number=admission_number
    ).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    results = (
        db.query(
            StudentEnrollment,
            AcademicYear.year_label,
            ClassLevel.class_name,
        )
        .join(AcademicYear, StudentEnrollment.academic_year_id == AcademicYear.id)
        .join(ClassLevel, StudentEnrollment.class_level_id == ClassLevel.id)
        .filter(StudentEnrollment.admission_number == admission_number)
        .order_by(AcademicYear.year_label)
        .all()
    )

    return [
        EnrollmentResponse(
            id=enrollment.id,
            admission_number=enrollment.admission_number,
            academic_year_id=enrollment.academic_year_id,
            class_level_id=enrollment.class_level_id,
            section=enrollment.section,
            roll_number=enrollment.roll_number,
            student_name=student.student_name,
            year_label=year_label,
            class_name=class_name,
        )
        for enrollment, year_label, class_name in results
    ]


@router.put("/enrollments/{enrollment_id}", response_model=EnrollmentResponse)
def update_enrollment(
    enrollment_id: int,
    data: EnrollmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """Update an enrollment's class, section, or roll number. Admin only."""
    enrollment = db.query(StudentEnrollment).filter_by(id=enrollment_id).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found.")

    # Resolve the effective final values (what we want to save) — do this BEFORE
    # touching the ORM object so SQLAlchemy's auto-flush does not interfere with
    # the conflict query below.
    effective_class_id = data.class_level_id if data.class_level_id is not None else enrollment.class_level_id
    effective_section  = data.section.upper() if data.section is not None else enrollment.section
    effective_roll     = data.roll_number if data.roll_number is not None else enrollment.roll_number

    # Validate new class exists
    if data.class_level_id is not None:
        cls_check = db.query(ClassLevel).filter_by(id=data.class_level_id).first()
        if not cls_check:
            raise HTTPException(status_code=404, detail="Class level not found.")

    # Check for duplicate roll number BEFORE mutating the ORM object
    if data.roll_number is not None or data.class_level_id is not None or data.section is not None:
        roll_conflict = db.query(StudentEnrollment).filter(
            StudentEnrollment.academic_year_id == enrollment.academic_year_id,
            StudentEnrollment.class_level_id   == effective_class_id,
            StudentEnrollment.section          == effective_section,
            StudentEnrollment.roll_number      == effective_roll,
            StudentEnrollment.id               != enrollment_id,
        ).first()
        if roll_conflict:
            cls_name = db.query(ClassLevel).filter_by(id=effective_class_id).first()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Roll number {effective_roll} is already taken by another student "
                    f"in {cls_name.class_name if cls_name else '?'} - {effective_section} "
                    f"for this academic year."
                ),
            )

    # All checks passed — apply the changes
    if data.class_level_id is not None:
        enrollment.class_level_id = data.class_level_id
    if data.section is not None:
        enrollment.section = effective_section
    if data.roll_number is not None:
        enrollment.roll_number = data.roll_number

    db.commit()
    db.refresh(enrollment)

    # Resolve names for response
    student = db.query(Student).filter_by(
        admission_number=enrollment.admission_number
    ).first()
    year = db.query(AcademicYear).filter_by(id=enrollment.academic_year_id).first()
    cls = db.query(ClassLevel).filter_by(id=enrollment.class_level_id).first()

    return EnrollmentResponse(
        id=enrollment.id,
        admission_number=enrollment.admission_number,
        academic_year_id=enrollment.academic_year_id,
        class_level_id=enrollment.class_level_id,
        section=enrollment.section,
        roll_number=enrollment.roll_number,
        student_name=student.student_name if student else None,
        year_label=year.year_label if year else None,
        class_name=cls.class_name if cls else None,
    )
