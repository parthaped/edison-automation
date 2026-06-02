import { NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/edison/app-error";
import { getEdisonService } from "@/lib/edison/service-factory";

export const runtime = "nodejs";
export const maxDuration = 30;

const splitSchema = z.object({
  startPage: z.number().int().min(1),
  endPage: z.number().int().min(1),
  title: z.string().optional(),
});

const bodySchema = z.object({
  splits: z.array(splitSchema).min(1),
});

// Returns the current set of siblings for a group with their page ranges.
// Used by the splits-editor UI so it can populate page-range inputs without
// requiring callers to denormalize ranges onto `DocumentPackage.sourceGroup`.
export async function GET(
  _request: Request,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const { groupId } = await context.params;
    const siblings = await getEdisonService().getGroupSiblings(groupId);
    const totalPages = siblings[0].document.sourceGroup?.totalPages ?? 0;
    return NextResponse.json({
      groupId,
      totalPages,
      originalFileName:
        siblings[0].document.sourceGroup?.originalFileName ?? "",
      siblings: siblings.map((record) => {
        const pages = record.document.pages;
        return {
          documentId: record.document.documentId,
          startPage: pages[0]?.sourcePage ?? 1,
          endPage: pages[pages.length - 1]?.sourcePage ?? 1,
          title: record.metadata.title,
          status: record.document.status,
        };
      }),
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

// Rewrites the entire set of sibling documents inside a group. The body must
// describe a contiguous, non-overlapping cover of the source PDF; partial
// edits are rejected so the document set always remains self-consistent. See
// `EdisonAutomationService.updateGroupSplits` for the rebuild logic.
export async function POST(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const { groupId } = await context.params;
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid splits payload.", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const service = getEdisonService();
    const updated = await service.updateGroupSplits(groupId, parsed.data.splits);
    return NextResponse.json({
      groupId,
      siblings: updated.map((record) => ({
        documentId: record.document.documentId,
        startPage: record.document.pages[0]?.sourcePage ?? null,
        endPage:
          record.document.pages[record.document.pages.length - 1]?.sourcePage ??
          null,
        status: record.document.status,
      })),
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
