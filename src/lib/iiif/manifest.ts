export interface IiifPageSource {
  label: string;
  url: string;
  width?: number;
  height?: number;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function readId(value: unknown): string | null {
  const object = asObject(value);
  if (!object) {
    return null;
  }
  const id = object["@id"] ?? object.id;
  return typeof id === "string" && id.trim() ? id : null;
}

function readImageResource(canvas: JsonObject): IiifPageSource | null {
  const images = canvas.images;
  if (!Array.isArray(images)) {
    return null;
  }

  for (const imageEntry of images) {
    const annotation = asObject(imageEntry);
    if (!annotation) {
      continue;
    }
    const resource = asObject(annotation.resource);
    if (!resource) {
      continue;
    }

    const url = readId(resource);
    if (!url) {
      continue;
    }

    const width = typeof resource.width === "number" ? resource.width : undefined;
    const height = typeof resource.height === "number" ? resource.height : undefined;
    const label = typeof canvas.label === "string" ? canvas.label : "";

    return { label, url, width, height };
  }

  return null;
}

function readPresentationPages(manifest: JsonObject): IiifPageSource[] {
  const sequences = manifest.sequences;
  if (!Array.isArray(sequences)) {
    return [];
  }

  const pages: IiifPageSource[] = [];

  for (const sequenceEntry of sequences) {
    const sequence = asObject(sequenceEntry);
    if (!sequence || !Array.isArray(sequence.canvases)) {
      continue;
    }

    for (const canvasEntry of sequence.canvases) {
      const canvas = asObject(canvasEntry);
      if (!canvas) {
        continue;
      }
      const page = readImageResource(canvas);
      if (page) {
        pages.push(page);
      }
    }
  }

  return pages;
}

function readPresentation3Pages(manifest: JsonObject): IiifPageSource[] {
  const items = manifest.items;
  if (!Array.isArray(items)) {
    return [];
  }

  const pages: IiifPageSource[] = [];

  for (const itemEntry of items) {
    const canvas = asObject(itemEntry);
    if (!canvas) {
      continue;
    }

    const itemsWithinCanvas = canvas.items;
    if (!Array.isArray(itemsWithinCanvas)) {
      continue;
    }

    for (const annotationPageEntry of itemsWithinCanvas) {
      const annotationPage = asObject(annotationPageEntry);
      if (!annotationPage || !Array.isArray(annotationPage.items)) {
        continue;
      }

      for (const annotationEntry of annotationPage.items) {
        const annotation = asObject(annotationEntry);
        if (!annotation) {
          continue;
        }
        const body = asObject(annotation.body);
        const url = body ? readId(body) : null;
        if (!url) {
          continue;
        }

        pages.push({
          label: typeof canvas.label === "string" ? canvas.label : "",
          url,
          width: typeof body?.width === "number" ? body.width : undefined,
          height: typeof body?.height === "number" ? body.height : undefined,
        });
      }
    }
  }

  return pages;
}

export function parseIiifManifest(manifest: unknown): IiifPageSource[] {
  const object = asObject(manifest);
  if (!object) {
    return [];
  }

  const presentation2Pages = readPresentationPages(object);
  if (presentation2Pages.length > 0) {
    return presentation2Pages;
  }

  return readPresentation3Pages(object);
}
