import type {
  DocumentPackage,
  MetadataExtraction,
  TranscriptionRun,
} from "./types";

// Development seed data only. Runtime code should access records through the
// EdisonRepository interface so this can be replaced by Postgres/object storage.
// IDs follow the TAEP convention demonstrated by the Rutgers Omeka form
// exports: `<folder>` for GLOC and `<folder><AAA>` for documents.
export const sampleDocuments: DocumentPackage[] = [
  {
    id: "E2002AAA",
    folderId: "E2002",
    documentId: "E2002AAA",
    title: "[E2002AAA], Traiser to Edison",
    sourceFile: {
      id: "seed-file-1",
      name: "E2002.pdf",
      size: 184_000,
      mimeType: "application/pdf",
    },
    pages: [
      {
        id: "E2002AAA-page-1",
        documentId: "E2002AAA",
        pageIndex: 0,
        imageFilename: "E2002_Page_01.jpg",
        sourcePage: 1,
        width: 1300,
        height: 801,
      },
      {
        id: "E2002AAA-page-2",
        documentId: "E2002AAA",
        pageIndex: 1,
        imageFilename: "E2002_Page_02.jpg",
        sourcePage: 2,
        width: 1300,
        height: 801,
      },
    ],
    status: "needs_review",
    confidence: "medium",
    validationWarnings: ["2 uncertain readings need review."],
    uncertaintyNotes: ["line 4: [filament?]", "line 8: [Philadelphia?]"],
    createdAt: "2026-05-27T12:00:00.000Z",
    updatedAt: "2026-05-27T12:20:00.000Z",
  },
  {
    id: "N042AAA",
    folderId: "N042",
    documentId: "N042AAA",
    title: "[N042AAA], Notebook page with project list",
    sourceFile: {
      id: "seed-file-2",
      name: "N042.tif",
      size: 21_900_000,
      mimeType: "image/tiff",
    },
    pages: [
      {
        id: "N042AAA-page-1",
        documentId: "N042AAA",
        pageIndex: 0,
        imageFilename: "N042_Page_01.jpg",
        sourcePage: 1,
      },
    ],
    status: "needs_review",
    confidence: "low",
    validationWarnings: ["Large TIFF normalized for review."],
    uncertaintyNotes: ["project charge information is unclear"],
    createdAt: "2026-05-27T12:00:00.000Z",
    updatedAt: "2026-05-27T12:30:00.000Z",
  },
  {
    id: "D8501AAA",
    folderId: "D8501",
    documentId: "D8501AAA",
    title: "[D8501AAA], blocked upload",
    sourceFile: {
      id: "seed-file-3",
      name: "unknown-archive.bin",
      size: 7000,
      mimeType: "application/octet-stream",
    },
    pages: [],
    status: "blocked",
    confidence: "blocked",
    validationWarnings: ["Unsupported file type. The original will be routed to manual review."],
    uncertaintyNotes: [],
    createdAt: "2026-05-27T12:00:00.000Z",
    updatedAt: "2026-05-27T12:10:00.000Z",
  },
];

export const sampleTranscription: TranscriptionRun = {
  id: "E2002AAA-run-1",
  documentId: "E2002AAA",
  model: "gemini-configured-model",
  promptVersion: "3.0.0",
  ocrText:
    "## E2002_Page_01.jpg\n\nLetterhead:\nEdison Electric Light Co. of Philadelphia\n\nDateline:\nPhiladelphia, Jan. 12, 1890\n\nBody:\nMr. Marks reports on the [filament?] tests and station materials.\n\nSignature:\nW. D. Marks",
  diplomaticText:
    "## E2002_Page_01.jpg\n\nLetterhead:\nEdison Electric Light Co. of Philadelphia\n\nDateline:\nPhiladelphia, Jan. 12, 1890\n\nBody:\nMr. Marks reports on the [filament?] tests and station materials.\n\nSignature:\nW. D. Marks",
  uncertainReadings: ["[filament?]"],
  costUsd: 0.012,
  inputTokens: 1420,
  outputTokens: 320,
};

export const sampleMetadata: MetadataExtraction = {
  folderId: "E2002",
  documentId: "E2002AAA",
  title: "Marks, William D. to Edison Electric Light Co. of Philadelphia",
  documentType: "Letter",
  date: "1890-01-12",
  authors: ["Marks, William D."],
  recipients: [],
  mentionedNames: ["Edison Electric Light Co. of Philadelphia"],
  subjects: ["Electric light", "station materials"],
  places: ["Philadelphia"],
  imageNames: ["E2002_Page_01.jpg", "E2002_Page_02.jpg"],
  confidence: "medium",
};
