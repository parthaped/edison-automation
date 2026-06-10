# Kraken local OCR (deprecated)

**Ingest no longer uses Kraken.** Use [amarel-qwen-ocr.md](./amarel-qwen-ocr.md) with `serve_qwen_ocr.py` and `EDISON_REMOTE_OCR_URL`.

---

# Kraken local OCR (legacy — laptop + Cloudflare Tunnel)

## Quick start (T1200, Windows)

```powershell
cd edison-automation
.\ml\scripts\setup_kraken_cuda.ps1
```

Download a Kraken 7 recognition model into `ml/models/` (for example a published English baseline from the [Kraken model repository](https://github.com/mittagessen/kraken)).

```powershell
.\ml\.venv\Scripts\Activate.ps1
python ml\scripts\serve_kraken_ocr.py --model ml\models\<your-model>.mlmodel --device cuda:0 --batch-size 16
```

Health: `http://127.0.0.1:8787/health`  
Transcribe: `POST http://127.0.0.1:8787/transcribe` (multipart `file` + `mediaType`)

## Cloudflare Tunnel (Vercel prod → laptop)

1. Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2. Cloudflare Zero Trust → **Networks** → **Tunnels** → create tunnel → run the connector on the laptop.
3. Public hostname: `ocr.<your-domain>` → `http://127.0.0.1:8787`.
4. Restrict access: Cloudflare Access service token and/or set `EDISON_KRAKEN_OCR_SECRET` on the server and `EDISON_LOCAL_OCR_SECRET` on Vercel (same value).

Example connector config (`%USERPROFILE%\.cloudflared\config.yml`):

```yaml
tunnel: <tunnel-id>
credentials-file: C:\Users\<you>\.cloudflared\<tunnel-id>.json

ingress:
  - hostname: ocr.example.com
    service: http://127.0.0.1:8787
  - service: http_status:404
```

Run: `cloudflared tunnel run <tunnel-name>` (keep running during ingest).

## Vercel environment

| Variable | Purpose |
|----------|---------|
| `EDISON_LOCAL_OCR_URL` | `https://ocr.example.com/transcribe` |
| `EDISON_LOCAL_OCR_SECRET` | Must match `EDISON_KRAKEN_OCR_SECRET` on laptop |
| `EDISON_GEMINI_API_KEY` | Required for post-transcribe document splitting (text-only) |
| `EDISON_PAGE_CHUNK_BATCH_DELAY_MS` | `0` when using local OCR |
| `EDISON_PAGE_CHUNK_CONCURRENCY` | `2`–`4` (server serializes GPU) |
| `EDISON_AI_TIMEOUT_MS` | `120000` or higher for slow pages |

## T1200 tuning

- Default `--batch-size 16`; lower to `8` on CUDA OOM.
- Only one GPU job runs at a time (server lock); Vercel may send parallel HTTP requests safely.
