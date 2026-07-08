"""
School Result Analysis System - Academic Management Endpoints

CRUD APIs for:
- Academic Years (with single-current enforcement)
- Class Levels
- Subjects
- Exams

Authorization:
- Admin: Full CRUD access
- Teacher / Principal: Read-only access
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import (
    get_db,
    get_current_active_user,
    get_current_admin,
)
from app.models.user import User
from app.models.academic import AcademicYear, ClassLevel, Subject, Exam
from app.schemas.academic_schema import (
    AcademicYearCreate, AcademicYearUpdate, AcademicYearResponse,
    ClassLevelCreate, ClassLevelUpdate, ClassLevelResponse,
    SubjectCreate, SubjectUpdate, SubjectResponse,
    ExamCreate, ExamUpdate, ExamResponse,
)

router = APIRouter()


# ============================================
# ACADEMIC YEAR ENDPOINTS
# ============================================

@router.get("/years", response_model=list[AcademicYearResponse])
def list_academic_years(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all academic years, ordered by label."""
    return db.query(AcademicYear).order_by(AcademicYear.year_label).all()


@router.post("/years", response_model=AcademicYearResponse, status_code=status.HTTP_201_CREATED)
def create_academic_year(
    data: AcademicYearCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """Create a new academic year. Admin only."""
    # Check for duplicate
    existing = db.query(AcademicYear).filter_by(year_label=data.year_label).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Academic year '{data.year_label}' already exists.",
        )

    # If setting as current, unset all others
    if data.is_current:
        db.query(AcademicYear).update({"is_current": False})

    year = AcademicYear(**data.model_dump())
    db.add(year)
    db.commit()
    db.refresh(year)
    return year


@router.put("/years/{year_id}", response_model=AcademicYearResponse)
def update_academic_year(
    year_id: int,
    data: AcademicYearUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """Update an academic year. Admin only."""
    year = db.query(AcademicYear).filter_by(id=year_id).first()
    if not year:
        raise HTTPException(status_code=404, detail="Academic year not found.")

    if data.year_label is not None:
        # Check for duplicate label
        dup = db.query(AcademicYear).filter(
            AcademicYear.year_label == data.year_label,
            AcademicYear.id != year_id,
        ).first()
        if dup:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Academic year '{data.year_label}' already exists.",
            )
        year.year_label = data.year_label

    if data.is_current is not None:
        if data.is_current:
            # Unset all others before setting this one
            db.query(AcademicYear).update({"is_current": False})
        year.is_current = data.is_current

    db.commit()
    db.refresh(year)
    return year


@router.put("/years/{year_id}/set-current", response_model=AcademicYearResponse)
def set_current_academic_year(
    year_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """Set a specific academic year as the current one. Unsets all others. Admin only."""
    year = db.query(AcademicYear).filter_by(id=year_id).first()
    if not year:
        raise HTTPException(status_code=404, detail="Academic year not found.")

    db.query(AcademicYear).update({"is_current": False})
    year.is_current = True
    db.commit()
    db.refresh(year)
    return year


# ============================================
# CLASS LEVEL ENDPOINTS
# ============================================

@router.get("/classes", response_model=list[ClassLevelResponse])
def list_class_levels(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all class levels, ordered by display_order."""
    return db.query(ClassLevel).order_by(ClassLevel.display_order).all()


@router.post("/classes", response_model=ClassLevelResponse, status_code=status.HTTP_201_CREATED)
def create_class_level(
    data: ClassLevelCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """Create a new class level. Admin only."""
    existing = db.query(ClassLevel).filter_by(class_name=data.class_name).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Class '{data.class_name}' already exists.",
        )

    cls = ClassLevel(**data.model_dump())
    db.add(cls)
    db.commit()
    db.refresh(cls)
    return cls


@router.put("/classes/{class_id}", response_model=ClassLevelResponse)
def update_class_level(
    class_id: int,
    data: ClassLevelUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """Update a class level. Admin only."""
    cls = db.query(ClassLevel).filter_by(id=class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class level not found.")

    if data.class_name is not None:
        dup = db.query(ClassLevel).filter(
            ClassLevel.class_name == data.class_name,
            ClassLevel.id != class_id,
        ).first()
        if dup:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Class '{data.class_name}' already exists.",
            )
        cls.class_name = data.class_name

    if data.display_order is not None:
        cls.display_order = data.display_order

    if data.sections is not None:
        cls.sections = data.sections

    db.commit()
    db.refresh(cls)
    return cls


# ============================================
# SUBJECT ENDPOINTS
# ============================================

@router.get("/subjects", response_model=list[SubjectResponse])
def list_subjects(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all subjects, ordered by name."""
    return db.query(Subject).order_by(Subject.subject_name).all()


@router.post("/subjects", response_model=SubjectResponse, status_code=status.HTTP_201_CREATED)
def create_subject(
    data: SubjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """Create a new subject. Admin only."""
    existing = db.query(Subject).filter_by(subject_name=data.subject_name).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Subject '{data.subject_name}' already exists.",
        )

    if data.subject_code:
        code_dup = db.query(Subject).filter_by(subject_code=data.subject_code).first()
        if code_dup:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Subject code '{data.subject_code}' already exists.",
            )

    subj = Subject(**data.model_dump())
    db.add(subj)
    db.commit()
    db.refresh(subj)
    return subj


@router.put("/subjects/{subject_id}", response_model=SubjectResponse)
def update_subject(
    subject_id: int,
    data: SubjectUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """Update a subject. Admin only."""
    subj = db.query(Subject).filter_by(id=subject_id).first()
    if not subj:
        raise HTTPException(status_code=404, detail="Subject not found.")

    if data.subject_name is not None:
        dup = db.query(Subject).filter(
            Subject.subject_name == data.subject_name,
            Subject.id != subject_id,
        ).first()
        if dup:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Subject '{data.subject_name}' already exists.",
            )
        subj.subject_name = data.subject_name

    if data.subject_code is not None:
        code_dup = db.query(Subject).filter(
            Subject.subject_code == data.subject_code,
            Subject.id != subject_id,
        ).first()
        if code_dup:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Subject code '{data.subject_code}' already exists.",
            )
        subj.subject_code = data.subject_code

    db.commit()
    db.refresh(subj)
    return subj


# ============================================
# EXAM ENDPOINTS
# ============================================

@router.get("/exams", response_model=list[ExamResponse])
def list_exams(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all exams, ordered by display_order."""
    return db.query(Exam).order_by(Exam.display_order).all()


@router.post("/exams", response_model=ExamResponse, status_code=status.HTTP_201_CREATED)
def create_exam(
    data: ExamCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """Create a new exam. Admin only."""
    existing = db.query(Exam).filter_by(exam_name=data.exam_name).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Exam '{data.exam_name}' already exists.",
        )

    exam = Exam(**data.model_dump())
    db.add(exam)
    db.commit()
    db.refresh(exam)
    return exam


@router.put("/exams/{exam_id}", response_model=ExamResponse)
def update_exam(
    exam_id: int,
    data: ExamUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """Update an exam. Admin only."""
    exam = db.query(Exam).filter_by(id=exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")

    if data.exam_name is not None:
        dup = db.query(Exam).filter(
            Exam.exam_name == data.exam_name,
            Exam.id != exam_id,
        ).first()
        if dup:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Exam '{data.exam_name}' already exists.",
            )
        exam.exam_name = data.exam_name

    if data.display_order is not None:
        exam.display_order = data.display_order

    db.commit()
    db.refresh(exam)
    return exam
