#!/usr/bin/env python3
"""Verify Google Gemini API auth before long relabel runs."""

from __future__ import annotations

import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from gemini_auth import gemini_api_key, is_vertex_configured  # noqa: E402
from label_provider import resolve_label_provider  # noqa: E402


def main() -> int:
    if is_vertex_configured():
        print("Vertex AI service account configured.")
    else:
        api_key = gemini_api_key()
        if not api_key:
            print(
                "Gemini not configured. Set either:\n"
                "  Vertex: EDISON_GCP_PROJECT_ID + EDISON_GCP_SERVICE_ACCOUNT_JSON\n"
                "  API key: EDISON_GEMINI_API_KEY"
            )
            return 1
        print(f"Gemini API key present (length={len(api_key)})")

    provider = resolve_label_provider("gemini")
    images = sorted(Path("ml/data/raw").rglob("*.jpg"))
    if not images:
        print("No sample images under ml/data/raw for auth probe.")
        return 1

    last_error: Exception | None = None
    for attempt in range(5):
        try:
            lines = provider.transcribe_page(images[0])
            last_error = None
            break
        except Exception as error:
            last_error = error
            message = str(error)
            retryable = any(code in message for code in ("HTTP 503", "HTTP 429", "HTTP 502"))
            if not retryable or attempt + 1 >= 5:
                break
            wait = 5 * (attempt + 1)
            print(f"Gemini transient error (attempt {attempt + 1}/5), retrying in {wait}s...")
            time.sleep(wait)

    if last_error is not None:
        print(f"Gemini API auth failed: {last_error}")
        return 1

    print(f"Gemini API OK — sample returned {len(lines)} lines from {images[0].name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
