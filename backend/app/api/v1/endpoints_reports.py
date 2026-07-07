"""
School Result Analysis System - Historical Report Endpoints

APIs for:
- POST /upload             — Upload a single PDF
- POST /upload-multiple    — Upload multiple PDFs
- POST /upload-zip/preview — Scan ZIP and preview matches (no DB changes)
- POST /upload-zip         — Import PDFs from ZIP
- GET  /{admission_number} — List reports for a student
- GET  /{admission_number}/{year_id}/download — Download a report PDF

File naming convention: AdmissionNumber_AcademicYear.pdf
Example: 2024001_2023-2024.pdf

Authorization:
- Admin / Teacher: Upload + read
- Principal: Read-only
"""

import io
import re
import zipfile
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import (
    get_db,
    get_current_active_user,
    require_role,
)
from app.models.user import User
from app.models.student import Student
from app.models.academic import AcademicYear
from app.models.report import HistoricalReport
from app.services.storage_service import get_storage_provider, get_storage_provider_name
from app.schemas.report_schema import (
    ReportResponse,
    SingleUploadResponse,
    ZipFileEntry,
    ZipPreviewResponse,
    ZipUploadResult,
    ZipImportResponse,
)

router = APIRouter()
logger = logging.getLogger(__name__)

# Expected filename pattern: AdmissionNumber_AcademicYear.pdf
FILENAME_PATTERN = re.compile(r"^(.+?)_(\d{4}-\d{4})\.pdf$", re.IGNORECASE)


def _parse_report_filename(filename: str) -> tuple[str | None, str | None]:
    """
    Parse a filename into (admission_number, academic_year_label).
    Returns (None, None) if the filename doesn't match the expected pattern.
    """
    match = FILENAME_PATTERN.match(filename)
    if not match:
        return None, None
    return match.group(1).strip(), match.group(2).strip()


def _build_storage_key(admission_number: str, year_label: str) -> str:
    """Build a consistent storage key for a report file."""
    return f"reports/{admission_number}/{admission_number}_{year_label}.pdf"


def _build_report_response(report: HistoricalReport, db: Session) -> ReportResponse:
    """Enrich a HistoricalReport with resolved display names."""
    student = db.query(Student).filter_by(
        admission_number=report.admission_number
    ).first()
    year = db.query(AcademicYear).filter_by(id=report.academic_year_id).first()

    return ReportResponse(
        id=report.id,
        admission_number=report.admission_number,
        academic_year_id=report.academic_year_id,
        storage_provider=report.storage_provider,
        storage_key=report.storage_key,
        original_filename=report.original_filename,
        uploaded_by=report.uploaded_by,
        uploaded_at=report.uploaded_at,
        student_name=student.student_name if student else None,
        year_label=year.year_label if year else None,
    )


# ============================================
# SINGLE PDF UPLOAD
# ============================================

@router.post("/upload", response_model=SingleUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_single_report(
    file: UploadFile = File(...),
    admission_number: str = Form(...),
    academic_year_id: int = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "teacher")),
):
    """
    Upload a single PDF report card for a specific student and academic year.
    The file does not need to follow the naming convention — metadata is provided via form fields.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .pdf files are accepted.",
        )

    # Validate student
    student = db.query(Student).filter_by(admission_number=admission_number).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    # Validate academic year
    year = db.query(AcademicYear).filter_by(id=academic_year_id).first()
    if not year:
        raise HTTPException(status_code=404, detail="Academic year not found.")

    # Check for duplicate
    existing = db.query(HistoricalReport).filter_by(
        admission_number=admission_number,
        academic_year_id=academic_year_id,
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Report already exists for {admission_number} / {year.year_label}.",
        )

    # Upload to storage
    storage = get_storage_provider()
    file_name_key = _build_storage_key(admission_number, year.year_label)
    file_bytes = await file.read()
    actual_storage_key = storage.upload_file(file_bytes, file_name_key)

    # Save metadata — use the provider-returned ID as the storage_key
    report = HistoricalReport(
        admission_number=admission_number,
        academic_year_id=academic_year_id,
        uploaded_by=current_user.id,
        storage_provider=get_storage_provider_name(),
        storage_key=actual_storage_key,
        original_filename=file.filename,
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    return SingleUploadResponse(
        report_id=report.id,
        admission_number=admission_number,
        academic_year=year.year_label,
        original_filename=file.filename,
        message="Report uploaded successfully.",
    )


# ============================================
# MULTIPLE PDF UPLOAD
# ============================================

@router.post("/upload-multiple", response_model=list[ZipUploadResult])
async def upload_multiple_reports(
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "teacher")),
):
    """
    Upload multiple PDF files at once.
    Each filename must follow the convention: AdmissionNumber_AcademicYear.pdf
    Example: 2024001_2023-2024.pdf
    """
    storage = get_storage_provider()
    results = []

    for file in files:
        filename = file.filename or "unknown"

        if not filename.lower().endswith(".pdf"):
            results.append(ZipUploadResult(
                filename=filename, status="error",
                message="Not a PDF file.",
            ))
            continue

        adm, year_label = _parse_report_filename(filename)
        if not adm or not year_label:
            results.append(ZipUploadResult(
                filename=filename, status="error",
                message="Filename doesn't match pattern: AdmissionNumber_AcademicYear.pdf",
            ))
            continue

        # Validate student
        student = db.query(Student).filter_by(admission_number=adm).first()
        if not student:
            results.append(ZipUploadResult(
                filename=filename, admission_number=adm, academic_year=year_label,
                status="error", message=f"Student '{adm}' not found.",
            ))
            continue

        # Validate academic year
        year = db.query(AcademicYear).filter_by(year_label=year_label).first()
        if not year:
            results.append(ZipUploadResult(
                filename=filename, admission_number=adm, academic_year=year_label,
                status="error", message=f"Academic year '{year_label}' not found.",
            ))
            continue

        # Check duplicate
        existing = db.query(HistoricalReport).filter_by(
            admission_number=adm, academic_year_id=year.id,
        ).first()
        if existing:
            results.append(ZipUploadResult(
                filename=filename, admission_number=adm, academic_year=year_label,
                status="skipped", message="Report already exists.",
            ))
            continue

        # Upload
        file_bytes = await file.read()
        file_name_key = _build_storage_key(adm, year_label)
        actual_storage_key = storage.upload_file(file_bytes, file_name_key)

        report = HistoricalReport(
            admission_number=adm,
            academic_year_id=year.id,
            uploaded_by=current_user.id,
            storage_provider=get_storage_provider_name(),
            storage_key=actual_storage_key,
            original_filename=filename,
        )
        db.add(report)

        results.append(ZipUploadResult(
            filename=filename, admission_number=adm, academic_year=year_label,
            status="uploaded", message="Report uploaded successfully.",
        ))

    db.commit()
    return results


# ============================================
# ZIP PREVIEW (no DB changes)
# ============================================

@router.post("/upload-zip/preview", response_model=ZipPreviewResponse)
async def preview_zip_upload(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "teacher")),
):
    """
    Scan a ZIP file and preview which PDFs will be imported.
    No database or storage changes are made.

    Each PDF inside the ZIP must follow: AdmissionNumber_AcademicYear.pdf
    """
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .zip files are accepted.",
        )

    file_bytes = await file.read()
    try:
        zf = zipfile.ZipFile(io.BytesIO(file_bytes))
    except zipfile.BadZipFile:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or corrupted ZIP file.",
        )

    entries = []
    matched = 0
    errors = 0

    for name in zf.namelist():
        # Skip directories and macOS resource forks
        if name.endswith("/") or name.startswith("__MACOSX"):
            continue

        # Extract just the filename (ignore directory paths inside ZIP)
        basename = name.rsplit("/", 1)[-1] if "/" in name else name

        if not basename.lower().endswith(".pdf"):
            entries.append(ZipFileEntry(
                filename=basename, status="invalid_format",
                message="Not a PDF file.",
            ))
            errors += 1
            continue

        adm, year_label = _parse_report_filename(basename)
        if not adm or not year_label:
            entries.append(ZipFileEntry(
                filename=basename, status="invalid_format",
                message="Filename doesn't match: AdmissionNumber_AcademicYear.pdf",
            ))
            errors += 1
            continue

        # Validate student
        student = db.query(Student).filter_by(admission_number=adm).first()
        if not student:
            entries.append(ZipFileEntry(
                filename=basename, admission_number=adm, academic_year=year_label,
                status="student_not_found",
                message=f"Student '{adm}' not found in database.",
            ))
            errors += 1
            continue

        # Validate academic year
        year = db.query(AcademicYear).filter_by(year_label=year_label).first()
        if not year:
            entries.append(ZipFileEntry(
                filename=basename, admission_number=adm, academic_year=year_label,
                status="year_not_found",
                message=f"Academic year '{year_label}' not found.",
            ))
            errors += 1
            continue

        # Check duplicate
        existing = db.query(HistoricalReport).filter_by(
            admission_number=adm, academic_year_id=year.id,
        ).first()
        if existing:
            entries.append(ZipFileEntry(
                filename=basename, admission_number=adm, academic_year=year_label,
                status="duplicate",
                message="Report already exists for this student/year.",
            ))
            errors += 1
            continue

        entries.append(ZipFileEntry(
            filename=basename, admission_number=adm, academic_year=year_label,
            status="matched",
            message=f"Ready to import for {student.student_name}.",
        ))
        matched += 1

    zf.close()

    return ZipPreviewResponse(
        total_files=len(entries),
        matched=matched,
        errors=errors,
        entries=entries,
    )


# ============================================
# ZIP IMPORT (commit)
# ============================================

@router.post("/upload-zip", response_model=ZipImportResponse)
async def import_zip(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "teacher")),
):
    """
    Extract and import all valid PDFs from a ZIP file.
    Files must follow naming convention: AdmissionNumber_AcademicYear.pdf

    Only matched files are imported. Invalid/duplicate files are skipped with details.
    """
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .zip files are accepted.",
        )

    file_bytes = await file.read()
    try:
        zf = zipfile.ZipFile(io.BytesIO(file_bytes))
    except zipfile.BadZipFile:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or corrupted ZIP file.",
        )

    storage = get_storage_provider()
    results = []
    uploaded = 0
    skipped = 0
    error_count = 0

    for name in zf.namelist():
        if name.endswith("/") or name.startswith("__MACOSX"):
            continue

        basename = name.rsplit("/", 1)[-1] if "/" in name else name

        if not basename.lower().endswith(".pdf"):
            results.append(ZipUploadResult(
                filename=basename, status="error", message="Not a PDF file.",
            ))
            error_count += 1
            continue

        adm, year_label = _parse_report_filename(basename)
        if not adm or not year_label:
            results.append(ZipUploadResult(
                filename=basename, status="error",
                message="Filename doesn't match: AdmissionNumber_AcademicYear.pdf",
            ))
            error_count += 1
            continue

        student = db.query(Student).filter_by(admission_number=adm).first()
        if not student:
            results.append(ZipUploadResult(
                filename=basename, admission_number=adm, academic_year=year_label,
                status="error", message=f"Student '{adm}' not found.",
            ))
            error_count += 1
            continue

        year = db.query(AcademicYear).filter_by(year_label=year_label).first()
        if not year:
            results.append(ZipUploadResult(
                filename=basename, admission_number=adm, academic_year=year_label,
                status="error", message=f"Academic year '{year_label}' not found.",
            ))
            error_count += 1
            continue

        existing = db.query(HistoricalReport).filter_by(
            admission_number=adm, academic_year_id=year.id,
        ).first()
        if existing:
            results.append(ZipUploadResult(
                filename=basename, admission_number=adm, academic_year=year_label,
                status="skipped", message="Report already exists.",
            ))
            skipped += 1
            continue

        # Extract and upload the PDF
        pdf_bytes = zf.read(name)
        file_name_key = _build_storage_key(adm, year_label)
        actual_storage_key = storage.upload_file(pdf_bytes, file_name_key)

        report = HistoricalReport(
            admission_number=adm,
            academic_year_id=year.id,
            uploaded_by=current_user.id,
            storage_provider=get_storage_provider_name(),
            storage_key=actual_storage_key,
            original_filename=basename,
        )
        db.add(report)
        uploaded += 1

        results.append(ZipUploadResult(
            filename=basename, admission_number=adm, academic_year=year_label,
            status="uploaded", message=f"Uploaded for {student.student_name}.",
        ))

    zf.close()
    db.commit()

    return ZipImportResponse(
        total_files=len(results),
        uploaded=uploaded,
        skipped=skipped,
        errors=error_count,
        results=results,
    )


# ============================================
# REPORT RETRIEVAL
# ============================================

@router.get("/{admission_number}", response_model=list[ReportResponse])
def list_student_reports(
    admission_number: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all historical reports for a specific student."""
    student = db.query(Student).filter_by(admission_number=admission_number).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    reports = (
        db.query(HistoricalReport)
        .filter_by(admission_number=admission_number)
        .order_by(HistoricalReport.academic_year_id.desc())
        .all()
    )

    return [_build_report_response(r, db) for r in reports]


@router.get("/{admission_number}/{academic_year_id}/download")
def download_report(
    admission_number: str,
    academic_year_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Download a specific historical report PDF."""
    report = db.query(HistoricalReport).filter_by(
        admission_number=admission_number,
        academic_year_id=academic_year_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")

    storage = get_storage_provider()
    file_bytes = storage.get_file(report.storage_key)
    if file_bytes is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report file not found in storage.",
        )

    return StreamingResponse(
        io.BytesIO(file_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{report.original_filename}"'
        },
    )


@router.delete("/{admission_number}/{academic_year_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_report(
    admission_number: str,
    academic_year_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "teacher")),
):
    """
    Delete a specific historical report.
    This removes the record from the database and attempts to remove the file from storage.
    """
    report = db.query(HistoricalReport).filter_by(
        admission_number=admission_number,
        academic_year_id=academic_year_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")

    storage = get_storage_provider()
    # Attempt to delete from storage (ignores 404s if already deleted manually)
    storage.delete_file(report.storage_key)

    # Delete from database
    db.delete(report)
    db.commit()

    return None
