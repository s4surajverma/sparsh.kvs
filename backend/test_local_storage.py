"""Local storage end-to-end test: upload a PDF, download it, compare hashes."""
import httpx
import hashlib
import os

BASE = "http://127.0.0.1:8001/api/v1"
ADM = "1272"       # Known student in the DB
YEAR_ID = 3        # year_id 3 = 2025-2026, no existing report

# Login
r = httpx.post(f"{BASE}/auth/login", json={"username": "admin", "password": "admin123"})
token = r.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

# Ensure provider is local
r_switch = httpx.put(f"{BASE}/settings/storage", headers=headers,
                     json={"storage_provider": "local", "drive_folder_id": None})
print(f"SWITCH TO LOCAL: {r_switch.status_code} provider={r_switch.json().get('storage_provider')}")

# Create a minimal valid PDF
pdf_content = (
    b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n"
    b"xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n"
    b"0000000058 00000 n \n0000000115 00000 n \n"
    b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF"
)
original_hash = hashlib.sha256(pdf_content).hexdigest()
print(f"ORIGINAL SHA256: {original_hash}")
print(f"ORIGINAL SIZE: {len(pdf_content)} bytes")

# Check storage dir existence BEFORE upload
print(f"STORAGE DIR EXISTS BEFORE UPLOAD: {os.path.isdir('./report_storage')}")

# Upload
r_upload = httpx.post(
    f"{BASE}/reports/upload",
    headers=headers,
    files={"file": ("test_report.pdf", pdf_content, "application/pdf")},
    data={"admission_number": ADM, "academic_year_id": str(YEAR_ID)},
)
print(f"UPLOAD STATUS: {r_upload.status_code}")
print(f"UPLOAD RESPONSE: {r_upload.text[:400]}")

# Check storage dir existence AFTER upload
print(f"STORAGE DIR EXISTS AFTER UPLOAD: {os.path.isdir('./report_storage')}")

if r_upload.status_code == 201:
    # Download and verify
    r_download = httpx.get(f"{BASE}/reports/{ADM}/{YEAR_ID}/download", headers=headers)
    print(f"DOWNLOAD STATUS: {r_download.status_code}")
    downloaded_hash = hashlib.sha256(r_download.content).hexdigest()
    print(f"DOWNLOADED SHA256: {downloaded_hash}")
    print(f"DOWNLOADED SIZE: {len(r_download.content)} bytes")
    print(f"BYTES MATCH: {original_hash == downloaded_hash}")

    # Clean up: delete the test report
    r_del = httpx.delete(f"{BASE}/reports/{ADM}/{YEAR_ID}", headers=headers)
    print(f"DELETE STATUS: {r_del.status_code}")

    # Confirm the file was also deleted from disk
    storage_path = os.path.join("report_storage", "reports", ADM, f"{ADM}_2025-2026.pdf")
    print(f"FILE STILL ON DISK AFTER DELETE: {os.path.exists(storage_path)}")
else:
    print("UPLOAD FAILED - cannot test download")
