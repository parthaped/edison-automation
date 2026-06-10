# Edison Papers Research Platform

Public semantic search across [edisondigital.rutgers.edu](https://edisondigital.rutgers.edu) plus a secured staff workbench for transcription review, confidence grading, and Omeka CSV export.

**Production:** [edison-papers-research.vercel.app](https://edison-papers-research.vercel.app)

![Side-by-side transcription review workbench](docs/images/review-workbench.png)

## Architecture at a Glance

![Edison Papers pipeline architecture](docs/images/architecture.svg)

The diagram above walks the full pipeline: manual ingest, file validation, page extraction, document ID assignment, AI transcription and indexing, density-based confidence grading, human approval, and CSV export. See [`docs/architecture.md`](docs/architecture.md) for the written companion.

## What This Builds

### Research Platform (public)

- Semantic search across a pre-built index of edisondigital.rutgers.edu Omeka S metadata and transcriptions
- Context-aware query expansion (e.g. “crushing ore” also finds related mineral-processing language)
- Advanced filters: time period, document type, collection, author, recipient, subject, place, identifier

### Staff Workbench (authenticated)

- Manual ingest endpoints for archival batches
- File validation and extraction planning for PDFs and image files
- AI transcription and Dublin Core-aligned indexing with versioned prompts
- Human review workbench with side-by-side source document, editable transcription, and approval gating
- Regular CSV export for approved transcriptions

![Upload and transcription workflow](docs/images/upload-workflow.png)

![Audit trail for processing history](docs/images/audit-trail.png)

## Stack

- Next.js App Router with TypeScript and Tailwind CSS
- Vercel for the web app, API routes, preview deployments, and orchestration
- Vercel Blob for durable record persistence
- Vitest and Testing Library for tests

## Development

```bash
npm install
npm run dev
```

Run checks:

```bash
npm run lint
npm run typecheck
npm test
```

## Search

Research search queries the **live Omeka S catalog** at [edisondigital.rutgers.edu](https://edisondigital.rutgers.edu) — no pre-built index or Vercel Blob upload is required for search to work.

Keyword queries use Omeka fulltext search with local synonym expansion (`SEARCH_AI_EXPANSION_ENABLED` defaults off). Advanced filters map to Omeka Dublin Core property queries.

Optional offline tooling (not required for production search):

```bash
# Harvest Omeka S into a local MiniSearch index (optional benchmarking / offline use)
npm run search:build:local
```

**Gemini RPD:** search uses local synonym expansion only. Gemini quota is reserved for workbench PaddleOCR-VL formatting.

## Key Routes

### Research (public)

- `/` — research home and search entry point
- `/search?q=...` — semantic search results
- `/item/[itemId]` — document detail with metadata and transcription excerpt

### Workbench (login required)

- `/workbench/login` — staff sign-in
- `/workbench/review` — reviewer queue and side-by-side correction workbench
- `/workbench/upload` — manual upload and transcription entry point
- `/workbench/past` — approved transcriptions
- `/workbench/audit` — processing history and confidence/status filters

Dev credentials (override via `WORKBENCH_DEV_USERNAME` / `WORKBENCH_DEV_PASSWORD`):

- Username: `edison-admin`
- Password: `edison-dev-2026`

### API

- `/api/health` — deployment health check (`service: edison-papers-research`)
- `/api/search` — context-aware search over the live edisondigital.rutgers.edu Omeka S catalog (keywords + advanced filters)
- `/api/search/rebuild` — legacy index cache refresh (cron / staff auth); research search no longer requires a pre-built index
- `/api/ingest/manual` — multipart manual file ingest (protected)
- `/api/export/transcriptions` — CSV export for approved transcriptions (protected)
- `/api/ocr/worker/*` — OCR pull queue for laptop/Amarel workers

## Production Notes

Runtime code goes through `EdisonAutomationService` and `EdisonRepository`; local development uses `InMemoryEdisonRepository`, while production uses the Vercel Blob-backed repository.

OCR workers should target **`https://edison-papers-research.vercel.app`** (or set `EDISON_VERCEL_URL`). The legacy hostname `edison-automation.vercel.app` is retired.

Do not import `sample-data.ts` from routes or production UI. It is seed data for local development and tests only.

## Repository

GitHub: [github.com/parthaped/edison-automation](https://github.com/parthaped/edison-automation) (repo name unchanged; Vercel project is `edison-papers-research`)
