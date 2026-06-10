import { NextResponse } from "next/server";
import { head } from "@vercel/blob";
import { getAppEnv } from "@/lib/edison/env";
import {
  BLOB_MANIFEST_PATH,
  BLOB_MINISEARCH_PATH,
} from "@/lib/search/index-types";
import {
  clearSearchIndexCache,
  getSearchIndex,
} from "@/lib/search/index-store";

function isAuthorized(request: Request, env: ReturnType<typeof getAppEnv>): boolean {
  const cronSecret = request.headers.get("authorization");
  if (env.CRON_SECRET && cronSecret === `Bearer ${env.CRON_SECRET}`) {
    return true;
  }

  const rebuildPassword = request.headers.get("x-rebuild-password");
  if (
    env.WORKBENCH_DEV_PASSWORD &&
    rebuildPassword === env.WORKBENCH_DEV_PASSWORD
  ) {
    return true;
  }

  return false;
}

export async function GET(request: Request) {
  const env = getAppEnv();
  if (!isAuthorized(request, env)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  clearSearchIndexCache();

  let manifestUrl: string | null = null;
  let indexUrl: string | null = null;

  if (env.BLOB_READ_WRITE_TOKEN) {
    try {
      const [manifestMeta, indexMeta] = await Promise.all([
        head(BLOB_MANIFEST_PATH),
        head(BLOB_MINISEARCH_PATH),
      ]);
      manifestUrl = manifestMeta.url;
      indexUrl = indexMeta.url;
    } catch {
      // Blob artifacts missing — documented manual rebuild path.
    }
  }

  try {
    const loaded = await getSearchIndex(true);
    return NextResponse.json({
      status: "ok",
      source: loaded.source,
      recordCount: loaded.manifest.recordCount,
      builtAt: loaded.manifest.builtAt,
      manifestUrl,
      indexUrl,
      message:
        "Index cache refreshed. Full rebuild: run `npm run search:build` locally, then upload to Blob.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "missing",
        manifestUrl,
        indexUrl,
        error: error instanceof Error ? error.message : "Index unavailable",
        message:
          "Run `npm run search:build` locally with BLOB_READ_WRITE_TOKEN to publish the search index.",
      },
      { status: 503 },
    );
  }
}
