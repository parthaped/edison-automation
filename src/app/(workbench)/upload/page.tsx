import Link from "next/link";
import { ContentHeader } from "@/components/workbench/content-header";
import { UploadBatchForm } from "@/components/upload-batch-form";
import { getRuntimeCapabilities } from "@/lib/edison/env";

export const metadata = {
  title: "Upload & transcribe · Edison Automation Workbench",
};

export default function UploadPage() {
  const capabilities = getRuntimeCapabilities();
  const aiReady = capabilities.ai !== "not-configured";
  const localOcrOnly = capabilities.ai === "local-ocr-configured";
  const blobReady = capabilities.files === "object-storage-configured";

  return (
    <>
      <ContentHeader
        title="Upload & transcribe"
        description="Drop archival pages here. Each file is transcribed, indexed with structured metadata, then sent to review for verification."
      />
      <main className="flex-1 overflow-y-auto px-6 py-6 sm:px-8">
        <div className="mx-auto w-full max-w-5xl space-y-4">
          {!aiReady ? (
            <CapabilityNotice>
              <strong className="font-semibold">
                Transcription is not configured.
              </strong>{" "}
              Set <code className="font-mono">AI_GATEWAY_API_KEY</code> and/or{" "}
              <code className="font-mono">EDISON_LOCAL_OCR_URL</code> in{" "}
              <code className="font-mono">.env.local</code> and restart the dev
              server. Uploads are still accepted, but transcriptions will be
              empty.
            </CapabilityNotice>
          ) : null}

          {localOcrOnly ? (
            <CapabilityNotice>
              <strong className="font-semibold">Local OCR only.</strong> Page
              transcription uses <code className="font-mono">EDISON_LOCAL_OCR_URL</code>
              . Set <code className="font-mono">AI_GATEWAY_API_KEY</code> as well
              for post-transcribe document splitting on large PDFs.
            </CapabilityNotice>
          ) : null}

          {!blobReady ? (
            <CapabilityNotice>
              <strong className="font-semibold">
                Vercel Blob is not configured.
              </strong>{" "}
              Set <code className="font-mono">BLOB_READ_WRITE_TOKEN</code> so
              files larger than 4 MB upload directly to Blob. Without it, large
              uploads fail with{" "}
              <code className="font-mono">Request Entity Too Large</code> on
              Vercel.
            </CapabilityNotice>
          ) : null}

          <p className="text-[13px] text-muted-foreground">
            Pipeline: each file is transcribed (AI Gateway and/or local Kraken
            OCR), indexed
            for document type, date, authors, recipients, names, and subjects,
            then bundled for download and queued for review. Need image-file
            lists from{" "}
            <span className="font-medium text-foreground">
              edisondigital.rutgers.edu
            </span>
            ? Follow the{" "}
            <Link
              href="/docs/operator/edison-digital-image-lists"
              className="font-medium text-foreground underline hover:no-underline"
            >
              Omeka CSV &rarr; Gemini split guide
            </Link>{" "}
            first.
          </p>

          <UploadBatchForm blobReady={blobReady} />
        </div>
      </main>
    </>
  );
}

function CapabilityNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {children}
    </div>
  );
}
