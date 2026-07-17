"""
One-time script to reset the admin user's password in the database.
Uses the DEFAULT_ADMIN_PASSWORD value from your .env file.

Usage:  python reset_admin_password.py
"""

from app.core.config import settings
from app.core.security import get_password_hash
from app.db.database import SessionLocal
from app.models.user import User


def reset_admin_password():
    db = SessionLocal()
    try:
        admin = db.query(User).filter_by(username=settings.DEFAULT_ADMIN_USERNAME).first()
        if not admin:
            print(f"[FAIL] Admin user '{settings.DEFAULT_ADMIN_USERNAME}' not found in database.")
            return

        new_hash = get_password_hash(settings.DEFAULT_ADMIN_PASSWORD)
        admin.password_hash = new_hash
        db.commit()
        print(f"[OK] Password for '{admin.username}' has been reset to the value in .env")
        print(f"   Username: {settings.DEFAULT_ADMIN_USERNAME}")
        print(f"   Password: {settings.DEFAULT_ADMIN_PASSWORD}")
    except Exception as e:
        db.rollback()
        print(f"[ERROR] {e}")
    finally:
        db.close()


if __name__ == "__main__":
    reset_admin_password()
