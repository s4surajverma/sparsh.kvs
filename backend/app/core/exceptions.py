"""
School Result Analysis System - Global Exception Handlers

Registers centralized exception handlers on the FastAPI application
so that all errors return a consistent JSON structure.
"""

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
import logging

logger = logging.getLogger(__name__)


def register_exception_handlers(app: FastAPI) -> None:
    """
    Attach global exception handlers to the FastAPI application instance.
    Ensures all error responses follow a uniform JSON format:
    {
        "error": "ERROR_CODE",
        "message": "Human-readable description"
    }
    """

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        """Handles intentional HTTP exceptions raised in route handlers."""
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": "HTTP_ERROR",
                "message": exc.detail,
                "detail": exc.detail,
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ):
        """Handles Pydantic request validation failures."""
        errors = exc.errors()
        first_error = errors[0] if errors else {}
        field = " -> ".join(str(loc) for loc in first_error.get("loc", []))
        message = first_error.get("msg", "Validation error")
        full_message = f"{field}: {message}"

        return JSONResponse(
            status_code=422,
            content={
                "error": "VALIDATION_ERROR",
                "message": full_message,
                "detail": full_message,
                "details": jsonable_encoder(errors),
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        """Catches all unhandled exceptions to prevent raw stack traces."""
        logger.error(f"Unhandled exception: {exc}", exc_info=True)
        msg = "An unexpected error occurred. Please try again later."
        return JSONResponse(
            status_code=500,
            content={
                "error": "INTERNAL_SERVER_ERROR",
                "message": msg,
                "detail": msg,
            },
        )
