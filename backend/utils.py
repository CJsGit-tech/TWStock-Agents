"""Shared utilities used across orchestrators and app.py."""

from __future__ import annotations

from dataclasses import fields, is_dataclass
from typing import Any


def to_jsonable(value: Any) -> Any:
    """Convert SDK objects to JSON-safe dicts without deep-copy."""
    if hasattr(value, "model_dump"):
        try:
            return value.model_dump(mode="json")
        except Exception:
            return str(value)
    if is_dataclass(value) and not isinstance(value, type):
        return {field.name: to_jsonable(getattr(value, field.name)) for field in fields(value)}
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)
