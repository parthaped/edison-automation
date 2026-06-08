#!/usr/bin/env python3
"""Shared Gemini auth helpers for ML scripts (API key or Vertex service account)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]


def normalize_private_key(private_key: str) -> str:
    return private_key.replace("\\n", "\n")


def load_service_account_info() -> dict[str, Any] | None:
    json_raw = (
        os.environ.get("EDISON_GCP_SERVICE_ACCOUNT_JSON", "").strip()
        or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON", "").strip()
    )
    if json_raw:
        return json.loads(json_raw)

    client_email = (
        os.environ.get("EDISON_GCP_CLIENT_EMAIL", "").strip()
        or os.environ.get("GOOGLE_CLIENT_EMAIL", "").strip()
    )
    private_key = (
        os.environ.get("EDISON_GCP_PRIVATE_KEY", "").strip()
        or os.environ.get("GOOGLE_PRIVATE_KEY", "").strip()
    )
    if client_email and private_key:
        return {
            "client_email": client_email,
            "private_key": normalize_private_key(private_key),
            "token_uri": "https://oauth2.googleapis.com/token",
        }

    credentials_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if credentials_path and Path(credentials_path).exists():
        return json.loads(Path(credentials_path).read_text(encoding="utf-8"))

    return None


def vertex_project_id() -> str | None:
    for name in (
        "EDISON_GCP_PROJECT_ID",
        "GOOGLE_CLOUD_PROJECT",
        "GCP_PROJECT_ID",
        "GCLOUD_PROJECT",
    ):
        value = os.environ.get(name, "").strip()
        if value:
            return value
    info = load_service_account_info() or {}
    project_id = str(info.get("project_id", "")).strip()
    return project_id or None


def vertex_location() -> str:
    return (
        os.environ.get("EDISON_GCP_LOCATION", "").strip()
        or os.environ.get("GOOGLE_CLOUD_LOCATION", "").strip()
        or "us-central1"
    )


def gemini_api_key() -> str | None:
    for name in (
        "EDISON_GEMINI_API_KEY",
        "GOOGLE_GENERATIVE_AI_API_KEY",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
    ):
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


def is_vertex_configured() -> bool:
    return bool(load_service_account_info() and vertex_project_id())


def get_vertex_access_token() -> str:
    info = load_service_account_info()
    if not info:
        raise RuntimeError(
            "Vertex service account not configured. Set EDISON_GCP_SERVICE_ACCOUNT_JSON."
        )
    try:
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account
    except ImportError as error:
        raise RuntimeError(
            "Vertex auth requires google-auth. Run: pip install google-auth"
        ) from error

    credentials = service_account.Credentials.from_service_account_info(
        info,
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )
    credentials.refresh(Request())
    token = credentials.token
    if not token:
        raise RuntimeError("Failed to obtain Vertex access token.")
    return token
