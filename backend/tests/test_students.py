import pytest

def test_create_and_search_student(client, admin_token_headers):
    # Create student
    res = client.post("/api/v1/students/", json={"admission_number": "S1001", "student_name": "John Doe"}, headers=admin_token_headers)
    assert res.status_code == 201
    
    # Search student
    res_search = client.get("/api/v1/students/search?q=John", headers=admin_token_headers)
    assert res_search.status_code == 200
    assert res_search.json()["total"] >= 1
    assert res_search.json()["items"][0]["admission_number"] == "S1001"

def test_pagination_limit_cap(client, admin_token_headers):
    # Requesting limit=999 should be rejected or capped by Pydantic validation (le=200)
    res = client.get("/api/v1/students/search?limit=999", headers=admin_token_headers)
    assert res.status_code == 422
