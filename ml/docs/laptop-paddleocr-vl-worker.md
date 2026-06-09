# Laptop PaddleOCR-VL worker + Vercel queue

Production ingest uses **PaddleOCR-VL-1.6** on your laptop (or any outbound worker) and **Gemini text-only** on Vercel for Edison Markdown formatting plus document splits/metadata.

Kraken is not used in ingest.

## Flow

```
Vercel upload workflow
  → rasterize PDF/image → page JPEGs in Blob
  → write OCR job to Blob (pending)
  → workflow polls until complete
Laptop worker
  → GET /api/ocr/worker/next
  → download page images from Blob URLs
  → PaddleOCR-VL-1.6 per page
  → POST /api/ocr/worker/{jobId}/complete
Vercel workflow continues
  → Gemini (text-only): Edison Markdown formatting
  → Gemini (text-only): split PDFs + Omeka metadata
```

## 1. Vercel environment

| Variable | Value |
|----------|--------|
| `EDISON_OCR_QUEUE_ENABLED` | `true` |
| `EDISON_OCR_WORKER_SECRET` | Long random shared secret |
| `GOOGLE_GENERATIVE_AI_API_KEY` or `EDISON_GEMINI_API_KEY` | Text-only format + structure passes |
| `BLOB_READ_WRITE_TOKEN` | Already required for uploads |
| `EDISON_OCR_QUEUE_TIMEOUT_MS` | `7200000` (2h) recommended |
| `EDISON_OCR_QUEUE_POLL_MS` | `5000` |

Do **not** set `EDISON_REMOTE_OCR_URL` when using the queue.

Redeploy after changing env vars.

## 2. Laptop setup (once)

```powershell
cd C:\Users\Partha\edison-automation
.\ml\scripts\setup_paddleocr_vl.ps1
```

Creates `ml\.venv-paddle-vl` with PaddlePaddle GPU + `paddleocr[doc-parser]`.

## 3. Run the worker

Set env vars (or pass via script params):

```powershell
$env:EDISON_VERCEL_URL = "https://your-app.vercel.app"
$env:EDISON_OCR_WORKER_SECRET = "your-shared-secret"
.\ml\scripts\start_edison_worker.ps1
```

Or directly:

```powershell
ml\.venv-paddle-vl\Scripts\Activate.ps1
python ml/scripts/edison_ocr_worker.py --backend paddleocr-vl --idle-sleep 10
```

The worker polls until killed. One job at a time is recommended on 4GB GPUs.

## 4. Upload a document

Use the Edison workbench upload UI. With the worker running, the workflow waits for OCR, then runs Gemini formatting on Vercel.

Check `/api/health` — expect `transcriptionMode: "paddleocr-vl-queue-gemini-format"` and `ocrWorkerExpected: "paddleocr-vl-1.6"`.

## 5. Optional backends

| Backend | Command | Notes |
|---------|---------|--------|
| PaddleOCR-VL (default) | `--backend paddleocr-vl` | Laptop / Windows GPU |
| Qwen2.5-VL | `--backend qwen` | Amarel / large GPU; see [amarel-qwen-ocr.md](./amarel-qwen-ocr.md) |

Use [`edison_ocr_worker.py`](../scripts/edison_ocr_worker.py) for both backends.

## 6. Local evaluation (offline)

```powershell
ml\.venv-paddle-vl\Scripts\Activate.ps1
python ml/scripts/paddleocr_vl_pipeline.py --input "C:\path\to\file.pdf"
ml\.venv\Scripts\Activate.ps1
python ml/scripts/compare_ocr_to_gemini.py --pdf "C:\path\to\file.pdf" --predictions "paddleocr-vl-1.6=ml/reports/paddleocr_vl/..."
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| HTTP 401 Unauthorized | `EDISON_OCR_WORKER_SECRET` on the laptop must **exactly** match Vercel. No extra quotes in the Vercel UI. Redeploy after changing env vars. |
| HTTP 503 from `/api/ocr/worker/next` | Set `EDISON_OCR_QUEUE_ENABLED=true` and `EDISON_OCR_WORKER_SECRET` on Vercel, then redeploy. |
| Worker gets no jobs | Confirm `EDISON_OCR_QUEUE_ENABLED=true` on Vercel and check [`/api/health`](https://edison-automation.vercel.app/api/health): `ocrQueue` and `ocrWorkerSecretConfigured` should be `"configured"` / `true`. |
| Workflow times out | Raise `EDISON_OCR_QUEUE_TIMEOUT_MS`; ensure worker is running |
| GPU OOM on laptop | Use `--device cpu` or process one job at a time |
| CUDNN warning | Paddle may warn about CUDNN version mismatch; usually still runs |
| OCR slower than local CLI | Worker now batches pages into one PDF `predict()` call (same as `paddleocr_vl_pipeline.py`). Restart the worker after pulling latest code. Start worker **before** upload to skip idle polling. |
| Wide white margins in viewer | New uploads trim PDF media-box margins during rasterize. Re-upload affected PDFs after deploying the latest app code. |

Verify auth before starting the worker:

```powershell
$env:EDISON_VERCEL_URL = "https://edison-automation.vercel.app"
$env:EDISON_OCR_WORKER_SECRET = "your-shared-secret"
ml\.venv-paddle-vl\Scripts\python.exe ml\scripts\test_ocr_worker_auth.py
```
