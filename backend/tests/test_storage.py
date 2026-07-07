import pytest
from unittest.mock import patch, MagicMock

def test_get_storage_settings(client, admin_token_headers):
    res = client.get("/api/v1/settings/storage", headers=admin_token_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["storage_provider"] == "local"

def test_switch_storage_provider(client, admin_token_headers):
    # Switch to local
    res = client.put("/api/v1/settings/storage", json={"storage_provider": "local"}, headers=admin_token_headers)
    assert res.status_code == 200
    
    # Try switching to google_drive without a verified folder (should fail)
    res2 = client.put("/api/v1/settings/storage", json={"storage_provider": "google_drive"}, headers=admin_token_headers)
    assert res2.status_code == 400

@patch("app.api.v1.endpoints_settings._get_drive_service")
@patch("app.api.v1.endpoints_settings._do_test_upload")
def test_select_folder_mocked(mock_do_test_upload, mock_get_drive_service, client, admin_token_headers):
    # Mock Drive service
    mock_service = MagicMock()
    mock_get_drive_service.return_value = mock_service
    
    # Mock test upload success
    mock_do_test_upload.return_value = (True, "Test upload successful")
    
    res = client.post("/api/v1/settings/storage/select-folder", 
                      json={"folder_id": "test_folder_123", "folder_name": "Test Folder"},
                      headers=admin_token_headers)
    
    # Wait, getting a drive service will fail if not connected via OAuth
    # But we mocked `_get_drive_service`, so it returns the mock_service instead of raising an error!
    assert res.status_code == 200
    assert res.json()["success"] == True
    assert res.json()["folder_id"] == "test_folder_123"
