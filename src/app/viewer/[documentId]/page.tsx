import { notFound } from "next/navigation";
import { DocumentViewer } from "@/components/document-viewer";
import type {
  DocumentViewerPanel,
  DocumentViewerTheme,
} from "@/components/document-viewer";
import { getEdisonService } from "@/lib/edison/service-factory";

interface ViewerPageProps {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{
    page?: string;
    panel?: string;
    theme?: string;
  }>;
}

function parsePanel(value: string | undefined): DocumentViewerPanel {
  if (value === "thumbnails" || value === "both") {
    return value;
  }
  return "transcription";
}

function parseTheme(value: string | undefined): DocumentViewerTheme {
  return value === "dark" ? "dark" : "light";
}

function parsePage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 1;
}

export default async function ViewerPage({
  params,
  searchParams,
}: ViewerPageProps) {
  const [{ documentId }, query] = await Promise.all([params, searchParams]);

  const reviewCase = await getEdisonService().getReviewCase(documentId);

  if (!reviewCase) {
    notFound();
  }

  const document = reviewCase.documents.find(
    (item) => item.documentId === documentId,
  );

  if (!document) {
    notFound();
  }

  return (
    <main className="flex min-h-screen flex-col bg-background p-3 sm:p-6">
      <DocumentViewer
        document={document}
        transcription={reviewCase.transcription}
        mode="embed"
        initialPage={parsePage(query.page)}
        initialPanel={parsePanel(query.panel)}
        theme={parseTheme(query.theme)}
        className="flex-1"
      />
    </main>
  );
}
