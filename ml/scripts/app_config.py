"""Canonical deployment identity for edison-papers-research.vercel.app."""

from __future__ import annotations

import os

APP_SERVICE_ID = "edison-papers-research"
APP_PRODUCTION_URL = "https://edison-papers-research.vercel.app"
LEGACY_APP_PRODUCTION_URL = "https://edison-automation.vercel.app"


def get_vercel_url() -> str:
    """Resolve the Edison app base URL (env override, then production default)."""
    return os.environ.get("EDISON_VERCEL_URL", "").strip() or APP_PRODUCTION_URL
