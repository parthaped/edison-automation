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
  searchParams: Promise<{ page?: string }>;
}

export default async function ViewerPage({ params, searchParams }: ViewerPageProps) {
  const { documentId } = await params;
  const { page: pageParam } = await searchParams;
  const parsedPage = Number.parseInt(pageParam ?? "", 10);
  const initialPage =
    Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage - 1 : 0;

  const record = await getEdisonService().getDocumentRecord(documentId);

  if (!record) {
    notFound();
  }

  return (
    <main className="flex h-[100svh] flex-col overflow-hidden bg-background p-3 sm:p-6">
      <DocumentViewer
        document={record.document}
        transcription={record.transcription}
        initialPage={initialPage}
        className="min-h-0 flex-1"
      />
    </main>
  );
}
