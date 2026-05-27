import { NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/edison/app-error";
import { getEdisonService } from "@/lib/edison/service-factory";

export const runtime = "nodejs";

const boxWebhookSchema = z.object({
  id: z.string(),
  trigger: z.string(),
  source: z.object({
    id: z.string(),
    type: z.string(),
    name: z.string().optional(),
    size: z.number().optional(),
    sha1: z.string().optional(),
    parent: z
      .object({
        id: z.string(),
        name: z.string(),
      })
      .optional(),
    path_collection: z
      .object({
        entries: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              type: z.string().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
  }),
});

export async function POST(request: Request) {
  try {
    const payload = boxWebhookSchema.safeParse(await request.json());

    if (!payload.success) {
      return NextResponse.json(
        { error: "Invalid Box webhook payload.", issues: payload.error.issues },
        { status: 400 },
      );
    }

    return NextResponse.json(await getEdisonService().handleBoxWebhook(payload.data));
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
