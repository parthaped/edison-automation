# Qwen OCR on Amarel + Vercel (no Cloudflare)

Use Rutgers Amarel GPUs for transcription **without** exposing Amarel to the internet. Amarel makes **outbound** HTTPS calls to your Vercel app; Vercel never needs to reach campus.

Kraken is not required.

## Recommended: pull queue (free)

```
Vercel upload workflow
  → rasterize PDF → page JPEGs in Blob
  → write OCR job to Blob (pending)
  → workflow polls until complete
Amarel GPU worker (login or compute node)
  → GET /api/ocr/worker/next  (claim job)
  → download page images from Blob URLs
  → Qwen2.5-VL bf16 on L40S
  → POST /api/ocr/worker/{jobId}/complete
Vercel workflow continues
  → Gemini (text-only): split PDFs + Omeka metadata
```

**Cost:** Vercel Blob + AI Gateway only. Amarel is free for Rutgers. No tunnel service.

## 1. Vercel environment

| Variable | Value |
|----------|--------|
| `EDISON_OCR_QUEUE_ENABLED` | `true` |
| `EDISON_OCR_WORKER_SECRET` | Long random shared secret |
| `EDISON_GEMINI_API_KEY` | For post-OCR structure/metadata (text-only) |
| `BLOB_READ_WRITE_TOKEN` | Already required for uploads |
| `EDISON_OCR_QUEUE_TIMEOUT_MS` | `7200000` (2h) for large PDFs on a busy queue |
| `EDISON_OCR_QUEUE_POLL_MS` | `5000` |

Do **not** set `EDISON_REMOTE_OCR_URL` when using the queue.

Redeploy after changing env vars.

## 2. Amarel model setup (once)

```bash
module load cuda/12.1.0
micromamba activate edison
cd ~/edison-automation

hf download Qwen/Qwen2.5-VL-7B-Instruct \
  --local-dir /scratch/$USER/edison/models/Qwen2.5-VL-7B-Instruct

pip install -r ml/requirements-qwen-vl.txt
```

## 3. Run the pull worker

Request a GPU and run the worker in that session:

```bash
srun --partition=gpu --gres=gpu:1 --cpus-per-task=8 --mem=32G --time=12:00:00 --pty bash
module load cuda/12.1.0
micromamba activate edison
cd ~/edison-automation

export EDISON_VERCEL_URL=https://edison-automation.vercel.app
export EDISON_OCR_WORKER_SECRET='same-as-vercel'
export EDISON_QWEN_MODEL_DIR=/scratch/$USER/edison/models/Qwen2.5-VL-7B-Instruct

python ml/scripts/amarel_ocr_worker.py --dtype bf16 --idle-sleep 30
```

The worker loads Qwen once, polls for jobs, transcribes every page, and posts results back.

### Keep it running between logins

On the **login node** (no GPU), use a `sbatch` wrapper that runs the worker on a GPU node:

```bash
sbatch --partition=gpu --gres=gpu:1 --cpus-per-task=8 --mem=32G --time=12:00:00 \
  --wrap='module load cuda/12.1.0 && source /scratch/$USER/micromamba/envs/edison/bin/activate && \
  export EDISON_VERCEL_URL=https://edison-automation.vercel.app && \
  export EDISON_OCR_WORKER_SECRET=... && \
  cd ~/edison-automation && python ml/scripts/amarel_ocr_worker.py --dtype bf16'
```

Check `squeue -u $USER`. Re-submit when the 12h wall clock ends.

## 4. Upload from Vercel

1. Start the Amarel worker (step 3).
2. Upload a PDF in the Edison workbench.
3. The ingest workflow waits until the worker completes the job, then runs Gemini for splits/metadata.

## Throughput

| Setting | Notes |
|---------|--------|
| Warm model in worker | First page slow; later pages ~10–30 s each |
| `bf16` on L40S | ~15 GB VRAM, best quality |
| One worker | Processes one PDF job at a time; add a second worker + secret only if you need parallelism |
| Gemini | ~1 text call per PDF (no vision rate limits) |

40 pages ≈ 7–20 minutes on GPU + one quick Gemini call.

## Optional: direct HTTP (laptop dev only)

If you are on the same machine as the OCR server (local dev), you can still use `EDISON_REMOTE_OCR_URL=http://127.0.0.1:8787/transcribe` with `serve_qwen_ocr.py` and **without** the queue. Production on Amarel should use the pull queue instead of a tunnel.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Workflow times out | Raise `EDISON_OCR_QUEUE_TIMEOUT_MS`; ensure worker is running |
| `401` on worker | Match `EDISON_OCR_WORKER_SECRET` on Amarel and Vercel |
| Job stuck `pending` | Worker not running or cannot reach Vercel/Blob outbound |
| Empty transcription | Check worker stderr on Amarel; verify model path |
