import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocumentViewer } from "@/components/document-viewer";
import { getEdisonService } from "@/lib/edison/service-factory";

export const metadata: Metadata = {
  title: "Edison Papers \u00b7 Document viewer",
  description:
    "Side-by-side viewer for Edison Papers source images and transcriptions.",
  robots: { index: false, follow: false },
};

interface ViewerPageProps {
  params: Promise<{ documentId: string }>;
}

export default async function ViewerPage({ params }: ViewerPageProps) {
  const { documentId } = await params;

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

  const transcription = reviewCase.transcriptions[document.documentId];

  return (
    <main className="flex h-[100svh] flex-col overflow-hidden bg-background p-3 sm:p-6">
      <DocumentViewer
        document={document}
        transcription={transcription}
        className="min-h-0 flex-1"
      />
    </main>
  );
}
