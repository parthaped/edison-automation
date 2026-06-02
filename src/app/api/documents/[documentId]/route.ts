import { NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/edison/app-error";
import { getEdisonService } from "@/lib/edison/service-factory";

export const runtime = "nodejs";
export const maxDuration = 30;

const patchBodySchema = z
  .object({
    diplomaticText: z.string().optional(),
    status: z.literal("approved").optional(),
  })
  .refine(
    (body) => body.diplomaticText !== undefined || body.status !== undefined,
    { message: "Provide diplomaticText to edit or status to approve." },
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
    const document =
      parsed.data.status === "approved"
        ? await service.approveDocument(documentId)
        : await service.saveTranscriptionEdit(
            documentId,
            parsed.data.diplomaticText ?? "",
          );

    return NextResponse.json({ document });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
