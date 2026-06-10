#!/usr/bin/env python3
"""Pull OCR jobs from Edison on Vercel and transcribe with Qwen on Amarel.

No inbound tunnel required — only outbound HTTPS from Amarel to your Vercel app
and Vercel Blob image URLs.

Example (login node, after requesting a GPU in the same shell or via sbatch wrapper):

  export EDISON_VERCEL_URL=https://edison-papers-research.vercel.app
  export EDISON_OCR_WORKER_SECRET=your-shared-secret
  export EDISON_QWEN_MODEL_DIR=/scratch/$USER/edison/models/Qwen2.5-VL-7B-Instruct

  srun --partition=gpu --gres=gpu:1 --cpus-per-task=8 --mem=32G --time=12:00:00 \\
    python ml/scripts/amarel_ocr_worker.py --dtype bf16 --idle-sleep 30
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from serve_qwen_ocr import QwenOcrRuntime, create_runtime  # noqa: E402
from transcribe_qwen_vl import MODEL_LABEL, PROMPT_VERSION  # noqa: E402


from app_config import APP_PRODUCTION_URL, get_vercel_url  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--vercel-url",
        default=get_vercel_url(),
        help=f"Edison base URL (defaults to EDISON_VERCEL_URL or {APP_PRODUCTION_URL})",
    )
    parser.add_argument(
        "--worker-secret",
        default=os.environ.get("EDISON_OCR_WORKER_SECRET", "").strip(),
        help="Shared secret (defaults to EDISON_OCR_WORKER_SECRET)",
    )
    parser.add_argument(
        "--worker-id",
        default=os.environ.get("EDISON_OCR_WORKER_ID", "amarel-qwen"),
    )
    parser.add_argument("--model-dir", type=Path, default=None)
    parser.add_argument("--dtype", choices=("bf16", "4bit"), default="bf16")
    parser.add_argument("--max-new-tokens", type=int, default=1024)
    parser.add_argument(
        "--idle-sleep",
        type=int,
        default=30,
        help="Seconds to wait when no jobs are pending",
    )
    parser.add_argument(
        "--max-jobs",
        type=int,
        default=0,
        help="Exit after N jobs (0 = run until killed)",
    )
    return parser.parse_args()


def api_request(
    method: str,
    url: str,
    secret: str,
    worker_id: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = None
    headers = {
        "Authorization": f"Bearer {secret}",
        "X-Edison-Ocr-Worker-Id": worker_id,
        "Accept": "application/json",
    }
    if payload is not None:
        import json

        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=120) as response:
            import json

            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} for {url}: {body}") from error
    except URLError as error:
        raise RuntimeError(f"Network error for {url}: {error}") from error


def download_image(url: str, destination: Path) -> None:
    request = Request(url, headers={"Accept": "image/*"})
    with urlopen(request, timeout=120) as response:
        destination.write_bytes(response.read())


def transcribe_job(runtime: QwenOcrRuntime, job: dict[str, Any]) -> dict[str, Any]:
    pages_out: list[dict[str, Any]] = []
    for page in job["pages"]:
        page_number = int(page["pageNumber"])
        image_url = str(page["imageUrl"])
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as handle:
            temp_path = Path(handle.name)
        try:
            download_image(image_url, temp_path)
            lines, _raw = runtime.transcriber.transcribe_page(temp_path)
            text = "\n".join(lines)
            pages_out.append({"pageNumber": page_number, "text": text})
            print(
                f"job={job['jobId']} page={page_number} chars={len(text)}",
                file=sys.stderr,
            )
        finally:
            temp_path.unlink(missing_ok=True)

    return {
        "pages": pages_out,
        "model": runtime.model_label,
        "promptVersion": PROMPT_VERSION,
    }


def main() -> int:
    args = parse_args()
    if not args.vercel_url:
        raise SystemExit("Set --vercel-url or EDISON_VERCEL_URL")
    if not args.worker_secret:
        raise SystemExit("Set --worker-secret or EDISON_OCR_WORKER_SECRET")

    base = args.vercel_url.rstrip("/")
    model_dir = args.model_dir
    if model_dir is None:
        model_dir = Path(
            os.environ.get(
                "EDISON_QWEN_MODEL_DIR",
                "/scratch/edison/models/Qwen2.5-VL-7B-Instruct",
            )
        )

    namespace = argparse.Namespace(
        model_dir=model_dir,
        host="127.0.0.1",
        port=8787,
        dtype=args.dtype,
        max_new_tokens=args.max_new_tokens,
        ocr_secret="",
        model_label=MODEL_LABEL,
    )
    runtime = create_runtime(namespace)
    print(
        f"Amarel OCR worker: {base} dtype={runtime.dtype} model={model_dir}",
        file=sys.stderr,
    )

    completed = 0
    while True:
        claim = api_request(
            "GET",
            f"{base}/api/ocr/worker/next",
            args.worker_secret,
            args.worker_id,
        )
        job = claim.get("job")
        if not job:
            print("No pending OCR jobs; sleeping.", file=sys.stderr)
            time.sleep(args.idle_sleep)
            continue

        job_id = job["jobId"]
        file_name = job.get("fileName") or job_id
        print(f"Claimed job {job_id} ({file_name})", file=sys.stderr)
        try:
            payload = transcribe_job(runtime, job)
            api_request(
                "POST",
                f"{base}/api/ocr/worker/{job_id}/complete",
                args.worker_secret,
                args.worker_id,
                payload,
            )
            completed += 1
            print(f"Completed job {job_id}", file=sys.stderr)
        except Exception as error:  # noqa: BLE001
            api_request(
                "POST",
                f"{base}/api/ocr/worker/{job_id}/complete",
                args.worker_secret,
                args.worker_id,
                {"error": str(error)},
            )
            print(f"Failed job {job_id}: {error}", file=sys.stderr)

        if args.max_jobs and completed >= args.max_jobs:
            break

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
