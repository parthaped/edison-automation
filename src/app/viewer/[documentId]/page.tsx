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

  return (
    <main className="flex min-h-screen flex-col bg-background p-3 sm:p-6">
      <DocumentViewer
        document={document}
        transcription={reviewCase.transcription}
        className="flex-1"
      />
    </main>
  );
}
