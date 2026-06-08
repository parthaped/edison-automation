# Google Gemini — Edison

Edison calls Gemini through **either**:

1. **Vertex AI + service account** (typical Google Cloud setup) — **recommended if your org requires service accounts**
2. **API key** via Google AI Studio (simpler personal/dev setup)

Vercel AI Gateway is not used.

---

## Option 1 — Vertex AI (service account)

### In Google Cloud Console

1. Select your project and note the **Project ID**.
2. **APIs & Services → Library** → enable **Vertex AI API**.
3. **IAM & Admin → Service accounts** → create (or pick) a service account.
4. Grant role: **Vertex AI User** (`roles/aiplatform.user`).
5. **Keys → Add key → JSON** → download the JSON file.

### Vercel environment variables

Paste the **entire service account JSON on one line** (minified):

| Variable | Required | Example |
|----------|----------|---------|
| `EDISON_GCP_PROJECT_ID` | **Yes** | `my-edison-project-123` |
| `EDISON_GCP_SERVICE_ACCOUNT_JSON` | **Yes** | `{"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n..."}` |
| `EDISON_GCP_LOCATION` | No | `us-central1` (default) |
| `EDISON_OCR_MODEL` | No | `gemini-2.5-flash` |

**Alternative** (split fields instead of full JSON):

```bash
EDISON_GCP_PROJECT_ID=my-edison-project-123
EDISON_GCP_CLIENT_EMAIL=edison-ocr@my-project.iam.gserviceaccount.com
EDISON_GCP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### Local development

Set the JSON env var in `.env.local`:

```bash
EDISON_GCP_PROJECT_ID=my-edison-project-123
EDISON_GCP_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
EDISON_GCP_LOCATION=us-central1
```

For **ML scripts only**, you can also use `GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json` (see `ml/scripts/gemini_auth.py`). The Next.js app and workflow steps read credentials from env vars only.

### API endpoint (automatic)

```text
https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent
```

Auth: OAuth2 bearer token from the service account (handled by Edison).

### ML scripts on Vertex

```powershell
pip install google-auth
python ml/scripts/test_gemini_auth.py
```

---

## Option 2 — API key (AI Studio)

If your project allows API keys (no service account required):

1. [Google AI Studio → API keys](https://aistudio.google.com/apikey)
2. Enable **Generative Language API** on the GCP project.

| Variable | Value |
|----------|--------|
| `EDISON_GEMINI_API_KEY` | `AIza…` |

Endpoint (automatic):

```text
https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
```

---

## Common Vercel settings

| Variable | Purpose |
|----------|---------|
| `BLOB_READ_WRITE_TOKEN` | Uploads (unchanged) |
| `EDISON_PAGE_CHUNK_SIZE` | `20` for fewer vision calls on large PDFs |
| `EDISON_PAGE_CHUNK_BATCH_DELAY_MS` | `10000` to reduce 429s |
| `EDISON_AI_TIMEOUT_MS` | `180000` |

**Remove** (obsolete):

- `EDISON_AI_GATEWAY_KEY`
- `AI_GATEWAY_API_KEY`

Redeploy after env changes.

---

## Priority

If **both** Vertex service account and API key are set, Edison uses **Vertex first**.

---

## Research quota

Apply for higher limits: [Gemini Academic Program](https://ai.google.dev/gemini-api/docs/gemini-for-research).

---

## FAQ: “I can’t select Gemini or Vertex AI in API keys”

**That’s normal.** Google does **not** show a “Gemini” or “Vertex AI” product when you create an API key. There is no dropdown to pick.

| What you want | Where to go | What you create |
|---------------|-------------|-----------------|
| **Vertex AI (service account)** — use this if GCP requires service accounts | [IAM → Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts) | **JSON key file** (not an API key) |
| **Simple API key** | [Google AI Studio → API keys](https://aistudio.google.com/apikey) | Key starting with `AIza…` |

### Vertex path (recommended for you)

You **do not** use **APIs & Services → Credentials → Create API key** for Vertex.

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Pick your project (top bar). Copy the **Project ID** → `EDISON_GCP_PROJECT_ID`.
3. **APIs & Services → Library** → search **Vertex AI API** → **Enable**.
4. **IAM & Admin → Service accounts** → **Create service account** (or use existing).
5. On the service account → **Permissions** → add role **Vertex AI User**.
6. Open the service account → **Keys** tab → **Add key → Create new key → JSON** → download.
7. Paste that JSON into Vercel as `EDISON_GCP_SERVICE_ACCOUNT_JSON` (one line).

Edison never asks you to “select Gemini” in the console — it calls `gemini-2.5-flash` on Vertex using that JSON.

### If you only see “Create API key” in Credentials

That screen is for **generic** API keys. After creating one, you can optionally **Edit key → API restrictions** and allow:

- **Generative Language API** (AI Studio style), or  
- **Vertex AI API**

…but if your org requires a **service account**, skip API keys and use the JSON service account steps above.

### Quick check

- Service account JSON has `"type": "service_account"` and `"client_email": "...iam.gserviceaccount.com"` → use **Vertex env vars**.
- Key starts with `AIza` from AI Studio → use `EDISON_GEMINI_API_KEY`.
