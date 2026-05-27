export interface OmekaVerificationResult {
  apiRoot: "ok" | "failed";
  itemsEndpoint: "ok" | "failed";
  itemSetsEndpoint: "ok" | "failed";
  iiifPresentation: "ok" | "failed" | "not-configured";
  iiifImage: "ok" | "failed" | "not-configured";
  notes: string[];
}

type CheckKey = keyof Omit<OmekaVerificationResult, "notes">;

interface EndpointCheck {
  key: CheckKey;
  url: string;
}

interface CheckOutcome {
  key: CheckKey;
  status: "ok" | "failed" | "not-configured";
  note?: string;
}

export async function verifyOmekaPublicEndpoints(
  baseUrl = "https://edisondigital.rutgers.edu",
  fetcher: typeof fetch = fetch,
): Promise<OmekaVerificationResult> {
  const checks: EndpointCheck[] = [
    { key: "apiRoot", url: `${baseUrl}/api` },
    { key: "itemsEndpoint", url: `${baseUrl}/api/items?per_page=1` },
    { key: "itemSetsEndpoint", url: `${baseUrl}/api/item_sets?per_page=1` },
    { key: "iiifPresentation", url: `${baseUrl}/iiif-presentation/3/item/1/manifest` },
    { key: "iiifImage", url: `${baseUrl}/iiif/159390/info.json` },
  ];

  const outcomes = await Promise.all(
    checks.map<Promise<CheckOutcome>>(async (check) => {
      try {
        const response = await fetcher(check.url, { method: "GET" });
        if (response.ok) {
          return { key: check.key, status: "ok" };
        }
        if (check.key === "iiifPresentation" || check.key === "iiifImage") {
          return {
            key: check.key,
            status: "not-configured",
            note: `${check.url} returned ${response.status}; verify IIIF modules with admin access.`,
          };
        }
        return {
          key: check.key,
          status: "failed",
          note: `${check.url} returned ${response.status}.`,
        };
      } catch {
        return {
          key: check.key,
          status: "failed",
          note: `${check.url} could not be reached.`,
        };
      }
    }),
  );

  const notes: string[] = [];
  const result: OmekaVerificationResult = {
    apiRoot: "failed",
    itemsEndpoint: "failed",
    itemSetsEndpoint: "failed",
    iiifPresentation: "not-configured",
    iiifImage: "not-configured",
    notes,
  };

  for (const outcome of outcomes) {
    if (outcome.key === "iiifPresentation" || outcome.key === "iiifImage") {
      result[outcome.key] = outcome.status;
    } else {
      result[outcome.key] = outcome.status === "ok" ? "ok" : "failed";
    }
    if (outcome.note) {
      notes.push(outcome.note);
    }
  }

  notes.push(
    "Authenticated Omeka write access, CSV import settings, and IIIF server module settings require Rutgers/Edison admin credentials.",
  );

  return result;
}
