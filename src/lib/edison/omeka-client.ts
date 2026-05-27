export interface OmekaVerificationResult {
  apiRoot: "ok" | "failed";
  itemsEndpoint: "ok" | "failed";
  itemSetsEndpoint: "ok" | "failed";
  iiifPresentation: "ok" | "failed" | "not-configured";
  iiifImage: "ok" | "failed" | "not-configured";
  notes: string[];
}

export async function verifyOmekaPublicEndpoints(
  baseUrl = "https://edisondigital.rutgers.edu",
  fetcher: typeof fetch = fetch,
): Promise<OmekaVerificationResult> {
  const notes: string[] = [];
  const result: OmekaVerificationResult = {
    apiRoot: "failed",
    itemsEndpoint: "failed",
    itemSetsEndpoint: "failed",
    iiifPresentation: "not-configured",
    iiifImage: "not-configured",
    notes,
  };

  const checks: Array<{
    key: keyof Omit<OmekaVerificationResult, "notes">;
    url: string;
  }> = [
    { key: "apiRoot", url: `${baseUrl}/api` },
    { key: "itemsEndpoint", url: `${baseUrl}/api/items?per_page=1` },
    { key: "itemSetsEndpoint", url: `${baseUrl}/api/item_sets?per_page=1` },
    { key: "iiifPresentation", url: `${baseUrl}/iiif-presentation/3/item/1/manifest` },
    { key: "iiifImage", url: `${baseUrl}/iiif/159390/info.json` },
  ];

  for (const check of checks) {
    try {
      const response = await fetcher(check.url, { method: "GET" });
      if (response.ok) {
        result[check.key] = "ok";
      } else if (check.key === "iiifPresentation" || check.key === "iiifImage") {
        result[check.key] = "not-configured";
        notes.push(`${check.url} returned ${response.status}; verify IIIF modules with admin access.`);
      } else {
        result[check.key] = "failed";
        notes.push(`${check.url} returned ${response.status}.`);
      }
    } catch {
      result[check.key] = "failed";
      notes.push(`${check.url} could not be reached.`);
    }
  }

  notes.push(
    "Authenticated Omeka write access, CSV import settings, and IIIF server module settings require Rutgers/Edison admin credentials.",
  );

  return result;
}
