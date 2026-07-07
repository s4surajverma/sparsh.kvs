import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db.base import Base
from app.api.deps import get_db
from app.core.security import get_password_hash
from app.models.user import User

# In-memory SQLite for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="session", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)

@pytest.fixture(autouse=True)
def reset_db_data():
    """Clear all data before each test."""
    db = TestingSessionLocal()
    for table in reversed(Base.metadata.sorted_tables):
        db.execute(table.delete())
    db.commit()
    db.close()

@pytest.fixture
def db():
    db = TestingSessionLocal()
    try:
        # Seed test users
        admin = User(username="admin_test", password_hash=get_password_hash("password123"), full_name="Admin", role="admin", is_active=True)
        teacher = User(username="teacher_test", password_hash=get_password_hash("password123"), full_name="Teacher", role="teacher", is_active=True)
        principal = User(username="principal_test", password_hash=get_password_hash("password123"), full_name="Principal", role="principal", is_active=True)
        disabled_user = User(username="disabled_test", password_hash=get_password_hash("password123"), full_name="Disabled", role="teacher", is_active=False)
        db.add_all([admin, teacher, principal, disabled_user])
        db.commit()
        yield db
    finally:
        db.close()

@pytest.fixture
def client(db):
    def override_get_db():
        try:
            yield db
        finally:
            pass
            
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()

@pytest.fixture
def admin_token_headers(client):
    response = client.post("/api/v1/auth/login", json={"username": "admin_test", "password": "password123"})
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def teacher_token_headers(client):
    response = client.post("/api/v1/auth/login", json={"username": "teacher_test", "password": "password123"})
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def principal_token_headers(client):
    response = client.post("/api/v1/auth/login", json={"username": "principal_test", "password": "password123"})
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
