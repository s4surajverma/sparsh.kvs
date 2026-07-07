"""Verify legacy drive-scope flow is still working: switch back to google_drive and check state."""
import httpx
import json

BASE = "http://127.0.0.1:8001/api/v1"

# Login
r = httpx.post(f"{BASE}/auth/login", json={"username": "admin", "password": "admin123"})
token = r.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

# Switch back to Google Drive
r2 = httpx.put(f"{BASE}/settings/storage", headers=headers,
               json={"storage_provider": "google_drive", "drive_folder_id": "1g8iSqUbtQ30hQbl28ZASlV4LKCctIXpm"})
print(f"SWITCH TO GOOGLE DRIVE: {r2.status_code}")

# Read back settings
r3 = httpx.get(f"{BASE}/settings/storage", headers=headers)
data = r3.json()
print(f"provider={data['storage_provider']}")
print(f"scope={data['google_oauth_scope']}")
print(f"connected={data['google_drive_connected']}")
print(f"folder_id={data['drive_folder_id']}")
print(f"picker_api_key={data['google_picker_api_key']}")
print(f"client_id present={bool(data['google_client_id'])}")

# Test the legacy verify endpoint (it should try to verify the folder via Drive API)
print("\n--- Legacy Verify Endpoint ---")
r4 = httpx.post(f"{BASE}/settings/storage/verify", headers=headers,
                json={"folder_url": "https://drive.google.com/drive/folders/1g8iSqUbtQ30hQbl28ZASlV4LKCctIXpm"})
print(f"VERIFY STATUS: {r4.status_code}")
print(f"VERIFY RESPONSE: {json.dumps(r4.json(), indent=2)}")

# Test the legacy test-upload endpoint
print("\n--- Legacy Test Upload Endpoint ---")
r5 = httpx.post(f"{BASE}/settings/storage/test-upload", headers=headers,
                json={"folder_url": "https://drive.google.com/drive/folders/1g8iSqUbtQ30hQbl28ZASlV4LKCctIXpm"})
print(f"TEST UPLOAD STATUS: {r5.status_code}")
print(f"TEST UPLOAD RESPONSE: {json.dumps(r5.json(), indent=2)}")

# Test the picker-token endpoint (should work since we have a refresh token)
print("\n--- Picker Token Endpoint ---")
r6 = httpx.post(f"{BASE}/settings/storage/picker-token", headers=headers)
print(f"PICKER TOKEN STATUS: {r6.status_code}")
if r6.status_code == 200:
    token_data = r6.json()
    print(f"ACCESS TOKEN RECEIVED: {bool(token_data.get('access_token'))}")
    print(f"TOKEN PREFIX: {token_data['access_token'][:20]}...")
else:
    print(f"PICKER TOKEN ERROR: {r6.text[:300]}")
