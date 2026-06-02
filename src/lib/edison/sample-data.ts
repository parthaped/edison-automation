import type {
  DocumentPackage,
  MetadataExtraction,
  TranscriptionRun,
} from "./types";

// Development seed data only. Runtime code should access records through the
// EdisonRepository interface so this can be replaced by Postgres/object storage.
export const sampleDocuments: DocumentPackage[] = [
  {
    id: "D9032-00001",
    folderId: "D9032-F",
    documentId: "D9032-00001",
    title: "[D9032-00001], Electric Light correspondence",
    sourceFile: {
      id: "seed-file-1",
      name: "D9032-00001.pdf",
      size: 184_000,
      mimeType: "application/pdf",
    },
    pages: [
      {
        id: "D9032-00001-page-1",
        documentId: "D9032-00001",
        pageIndex: 0,
        imageFilename: "D9032-00001/d9032-00001_0001.jpg",
        sourcePage: 1,
        width: 1300,
        height: 801,
      },
      {
        id: "D9032-00001-page-2",
        documentId: "D9032-00001",
        pageIndex: 1,
        imageFilename: "D9032-00001/d9032-00001_0002.jpg",
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
    id: "N042-00002",
    folderId: "N042-F",
    documentId: "N042-00002",
    title: "[N042-00002], Notebook page with project list",
    sourceFile: {
      id: "seed-file-2",
      name: "notebook-page.tif",
      size: 21_900_000,
      mimeType: "image/tiff",
    },
    pages: [
      {
        id: "N042-00002-page-1",
        documentId: "N042-00002",
        pageIndex: 0,
        imageFilename: "N042-00002/notebook-page_0001.jpg",
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
    id: "NEW-D8501-00003",
    folderId: "D8501-F",
    documentId: "NEW-D8501-00003",
    title: "[NEW-D8501-00003], blocked upload",
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
  id: "D9032-00001-run-1",
  documentId: "D9032-00001",
  model: "gateway-configured-model",
  promptVersion: "3.0.0",
  ocrText:
    "## D9032-00001/d9032-00001_0001.jpg\n\nLetterhead:\nEdison Electric Light Co. of Philadelphia\n\nDateline:\nPhiladelphia, Jan. 12, 1890\n\nBody:\nMr. Marks reports on the [filament?] tests and station materials.\n\nSignature:\nW. D. Marks",
  diplomaticText:
    "## D9032-00001/d9032-00001_0001.jpg\n\nLetterhead:\nEdison Electric Light Co. of Philadelphia\n\nDateline:\nPhiladelphia, Jan. 12, 1890\n\nBody:\nMr. Marks reports on the [filament?] tests and station materials.\n\nSignature:\nW. D. Marks",
  uncertainReadings: ["[filament?]"],
  costUsd: 0.012,
  inputTokens: 1420,
  outputTokens: 320,
};

export const sampleMetadata: MetadataExtraction = {
  folderId: "D9032-F",
  documentId: "D9032-00001",
  title: "Marks, William D. to Edison Electric Light Co. of Philadelphia",
  documentType: "correspondence",
  date: "1890-01-12",
  authors: ["Marks, William D."],
  recipients: ["Unknown"],
  mentionedNames: ["Edison Electric Light Co. of Philadelphia"],
  subjects: ["Electric light", "station materials"],
  imageNames: ["D9032-00001/d9032-00001_0001.jpg", "D9032-00001/d9032-00001_0002.jpg"],
  confidence: "medium",
};
