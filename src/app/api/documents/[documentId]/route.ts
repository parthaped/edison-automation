import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, toErrorResponse } from "@/lib/edison/app-error";
import { getEdisonService } from "@/lib/edison/service-factory";

export const runtime = "nodejs";
export const maxDuration = 30;

const patchBodySchema = z
  .object({
    diplomaticText: z.string().optional(),
    comments: z.string().optional(),
    status: z.enum(["approved", "needs_review"]).optional(),
    folderId: z.string().min(1).optional(),
  })
  .refine(
    (body) =>
      body.diplomaticText !== undefined ||
      body.comments !== undefined ||
      body.status !== undefined ||
      body.folderId !== undefined,
    {
      message:
        "Provide diplomaticText, comments, status, or folderId to update.",
    },
  );

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId } = await context.params;
    const service = getEdisonService();
    await service.deleteDocument(documentId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId } = await context.params;
    const parsed = patchBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid document payload.", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const service = getEdisonService();
    let document;
    // Folder rename is handled first since it changes the document id; any
    // subsequent updates would need the new id and there's no sensible way
    // to combine a rename with a transcription edit in the same request.
    if (parsed.data.folderId !== undefined) {
      const renamed = await service.renameFolderId(
        documentId,
        parsed.data.folderId,
      );
      return NextResponse.json({
        document: renamed[0].document,
        renamed: renamed.map((record) => ({
          documentId: record.document.documentId,
          folderId: record.document.folderId,
        })),
      });
    }
    if (parsed.data.status === "approved") {
      document = await service.approveDocument(documentId);
    } else if (parsed.data.status === "needs_review") {
      document = await service.unapproveDocument(documentId);
    } else if (parsed.data.comments !== undefined) {
      await service.saveMetadataComments(documentId, parsed.data.comments);
      const record = await service.getDocumentRecord(documentId);
      if (!record) {
        throw new AppError("NOT_FOUND", "Document was not found.", 404);
      }
      document = record.document;
    } else {
      document = await service.saveTranscriptionEdit(
        documentId,
        parsed.data.diplomaticText ?? "",
      );
    }

    return NextResponse.json({ document });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
