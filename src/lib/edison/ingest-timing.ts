/** Per-stage durations emitted after each file completes ingest. */
export interface FileStageTimingMs {
  fetchMs: number;
  rasterizeMs: number;
  transcribeMs: number;
  persistMs: number;
  totalMs: number;
  /** Populated when page-chunked transcription ran. */
  transcribeChunkCount?: number;
  /** Which rasterization backend produced page images. */
  rasterizeBackend?: "pdfjs" | "pdftoppm";
}

export class StageTimer {
  private readonly startedAt = Date.now();
  private readonly marks = new Map<string, number>();

  mark(label: string): void {
    this.marks.set(label, Date.now());
  }

  elapsedSince(label: string): number {
    const mark = this.marks.get(label);
    if (mark === undefined) return 0;
    return Date.now() - mark;
  }

  segmentMs(fromLabel: string, toLabel: string): number {
    const from = this.marks.get(fromLabel);
    const to = this.marks.get(toLabel);
    if (from === undefined || to === undefined) return 0;
    return Math.max(0, to - from);
  }

  totalMs(): number {
    return Date.now() - this.startedAt;
  }

  build(input: {
    fetchStart: string;
    rasterizeStart?: string;
    transcribeStart?: string;
    persistStart: string;
    persistEnd: string;
    transcribeChunkCount?: number;
    rasterizeBackend?: FileStageTimingMs["rasterizeBackend"];
  }): FileStageTimingMs {
    const fetchMs = this.segmentMs(input.fetchStart, input.rasterizeStart ?? input.transcribeStart ?? input.persistStart);
    const rasterizeMs =
      input.rasterizeStart && (input.transcribeStart ?? input.persistStart)
        ? this.segmentMs(input.rasterizeStart, input.transcribeStart ?? input.persistStart)
        : 0;
    const transcribeMs =
      input.transcribeStart && input.persistStart
        ? this.segmentMs(input.transcribeStart, input.persistStart)
        : 0;
    const persistMs = this.segmentMs(input.persistStart, input.persistEnd);
    return {
      fetchMs,
      rasterizeMs,
      transcribeMs,
      persistMs,
      totalMs: this.totalMs(),
      transcribeChunkCount: input.transcribeChunkCount,
      rasterizeBackend: input.rasterizeBackend,
    };
  }
}
