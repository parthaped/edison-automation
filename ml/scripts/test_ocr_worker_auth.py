#!/usr/bin/env python3
"""Verify OCR worker auth against a deployed Edison app."""

from __future__ import annotations

import argparse
import json
import os
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--vercel-url",
        default=os.environ.get("EDISON_VERCEL_URL", "").strip(),
    )
    parser.add_argument(
        "--worker-secret",
        default=os.environ.get("EDISON_OCR_WORKER_SECRET", "").strip(),
    )
    return parser.parse_args()


def fetch_json(url: str, *, secret: str | None = None) -> tuple[int, dict]:
    headers = {"Accept": "application/json"}
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    request = Request(url, headers=headers, method="GET")
    try:
        with urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            payload = {"error": body}
        return error.code, payload


def main() -> int:
    args = parse_args()
    if not args.vercel_url:
        raise SystemExit("Set --vercel-url or EDISON_VERCEL_URL")
    if not args.worker_secret:
        raise SystemExit("Set --worker-secret or EDISON_OCR_WORKER_SECRET")

    base = args.vercel_url.rstrip("/")
    print(f"Using EDISON_VERCEL_URL={base}")
    print(f"Using EDISON_OCR_WORKER_SECRET ({len(args.worker_secret)} chars)")

    health_status, health = fetch_json(f"{base}/api/health")
    print(f"GET /api/health -> {health_status}")
    capabilities = health.get("checks", {}).get("capabilities", {})
    print(json.dumps(capabilities, indent=2))

    worker_status, worker = fetch_json(
        f"{base}/api/ocr/worker/next",
        secret=args.worker_secret,
    )
    print(f"GET /api/ocr/worker/next -> {worker_status}")
    print(json.dumps(worker, indent=2))

    if worker_status == 200:
        print("Worker auth OK.")
        return 0

    print("Worker auth failed.", file=sys.stderr)
    if capabilities.get("ocrQueue") != "configured":
        print(
            "- Set EDISON_OCR_QUEUE_ENABLED=true on Vercel (Production) and redeploy.",
            file=sys.stderr,
        )
    secret_flag = capabilities.get("ocrWorkerSecretConfigured")
    if secret_flag is False:
        print(
            "- Set EDISON_OCR_WORKER_SECRET on Vercel (Production) and redeploy.",
            file=sys.stderr,
        )
    elif secret_flag is None and capabilities.get("ocrQueue") == "configured":
        print(
            "- Redeploy latest app code so /api/health exposes "
            "ocrWorkerSecretConfigured, or confirm the exact var name is "
            "EDISON_OCR_WORKER_SECRET (not EDISON_LOCAL_OCR_SECRET or EDISON_OCR_SECRET).",
            file=sys.stderr,
        )
    if worker_status == 401:
        if capabilities.get("ocrQueue") == "configured":
            print(
                "- Queue is enabled but auth failed: local EDISON_OCR_WORKER_SECRET "
                "must exactly match Vercel Production (no extra quotes). Redeploy after "
                "changing env vars.",
                file=sys.stderr,
            )
        else:
            print(
                "- Local EDISON_OCR_WORKER_SECRET must exactly match Vercel (no extra quotes).",
                file=sys.stderr,
            )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
