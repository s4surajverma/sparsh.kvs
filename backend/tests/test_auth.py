import pytest

def test_login_success(client):
    response = client.post("/api/v1/auth/login", json={"username": "admin_test", "password": "password123"})
    assert response.status_code == 200
    assert "access_token" in response.json()

def test_login_failure(client):
    response = client.post("/api/v1/auth/login", json={"username": "admin_test", "password": "wrongpassword"})
    assert response.status_code == 401

def test_login_disabled_user(client):
    response = client.post("/api/v1/auth/login", json={"username": "disabled_test", "password": "password123"})
    assert response.status_code == 403

def test_login_lockout(client):
    # First 5 attempts from IP 1.1.1.1 should return 401
    for i in range(5):
        res = client.post("/api/v1/auth/login", json={"username": "teacher_test", "password": "wrong"}, headers={"x-forwarded-for": "1.1.1.1"})
        assert res.status_code == 401, f"Attempt {i+1} should be 401 but was {res.status_code}"
    
    # 6th attempt from 1.1.1.1 should be 429 (lockout triggered)
    response = client.post("/api/v1/auth/login", json={"username": "teacher_test", "password": "password123"}, headers={"x-forwarded-for": "1.1.1.1"})
    print("RESPONSE WAS:", response.status_code, response.text)
    assert response.status_code == 429
    assert "Too many failed attempts" in response.json().get("message", response.json().get("detail", ""))
    
    # Attempt from a different IP should NOT be locked out
    response_diff_ip = client.post("/api/v1/auth/login", json={"username": "teacher_test", "password": "password123"}, headers={"x-forwarded-for": "2.2.2.2"})
    assert response_diff_ip.status_code == 200

def test_rbac_admin_only(client, admin_token_headers, teacher_token_headers):
    # Admin can access
    res_admin = client.get("/api/v1/auth/test/admin-only", headers=admin_token_headers)
    assert res_admin.status_code == 404 # since we set DEBUG=False by default

    # Override config for testing
    from app.core.config import settings
    settings.DEBUG = True
    
    res_admin = client.get("/api/v1/auth/test/admin-only", headers=admin_token_headers)
    assert res_admin.status_code == 200
    
    res_teacher = client.get("/api/v1/auth/test/admin-only", headers=teacher_token_headers)
    assert res_teacher.status_code == 403
    
    settings.DEBUG = False
