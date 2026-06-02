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
    status: z.literal("approved").optional(),
  })
  .refine(
    (body) =>
      body.diplomaticText !== undefined ||
      body.comments !== undefined ||
      body.status !== undefined,
    { message: "Provide diplomaticText, comments, or status to update." },
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
    if (parsed.data.status === "approved") {
      document = await service.approveDocument(documentId);
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
