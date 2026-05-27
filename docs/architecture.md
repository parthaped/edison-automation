# Architecture

![Edison Automation pipeline architecture](images/architecture.png)

The diagram is generated from [`images/architecture.svg`](images/architecture.svg). To regenerate the PNG after editing the SVG, run `node scripts/render-architecture-png.mjs` from the repository root.

## Provider Decision

Use Vercel for the browser application, API routes, preview deployments, and durable orchestration. Keep large originals and extracted page images in object storage, and keep durable package/review/export state in managed Postgres.

GitHub Pages is reserved for static documentation because it cannot run secure Box API calls, file uploads, background workers, or database-backed review queues.

Streamlit is useful for prompt experiments but should not be the long-lived production application because large file extraction, multi-user review, retryable background work, and audit trails need a more conventional web app architecture.

Render remains the fallback if the image/OCR worker layer needs always-on Python processes as a primary deployment concern.

## Processing Flow

1. Box webhook records completed uploads and their associated folder/path in the Box intake queue.
2. A platform user reviews the Box intake queue and clicks **Start transcription** for the file or folder set that is ready.
3. The start action queues the AGI/transcription pipeline job. The webhook itself does not download or process files.
4. File validation determines whether the source can be extracted or must be routed to manual review.
5. Extraction creates a page manifest and deterministic image filenames.
6. The ID policy preserves supplied identifiers or generates collision-free temporary identifiers.
7. OCR and AI transcription run in staged prompts.
8. Confidence scoring routes packages to high, medium, low, or blocked queues.
9. Reviewers correct transcription and metadata in the workbench.
10. Reviewer corrections are captured as structured feedback for agent improvement.
11. Approved records export to Omeka-compatible CSV/API payloads.

## Service Boundaries

The production path must avoid UI/API code importing sample data or calling storage directly. The current boundaries are:

- `EdisonAutomationService`: application workflows for dashboard data, manual ingest, Box webhook job creation, review audit events, and Omeka export.
- `EdisonRepository`: persistence contract for documents, transcriptions, metadata, review events, and export rows.
- `InMemoryEdisonRepository`: development adapter seeded with representative records. This is not the production storage layer.
- Future `PostgresEdisonRepository`: durable implementation for Vercel/managed Postgres.
- Future object storage adapter: owns original files, extracted page images, thumbnails, and export artifacts.

Routes should call the service. Components should receive typed view data. Domain modules should stay framework-independent where possible.

## Feedback-Guided Agent Improvement

The application should improve agents through reviewer evidence, not through untracked prompt edits.

- `AgentFeedback` stores original output, corrected output, issue tags, prompt version, model, and confidence before/after.
- `feedback-engine.ts` turns recurring issue tags into prompt revision candidates and confidence calibration suggestions.
- Generated agent scripts remain `draft` until evaluated against a gold-standard benchmark set and approved by staff.
- Confidence calibration suggestions lower trust in similar future outputs when reviewers correct outputs that were previously marked high confidence.
- This creates a reproducible loop: output → human correction → structured feedback → draft script → benchmark evaluation → approved prompt version.

## Omeka/IIIF Notes

The Edison Digital Edition public API models item sets as folders and items as documents. Production integration still needs administrator verification for authenticated write access, CSV import requirements, IIIF Presentation module configuration, and image server behavior.
