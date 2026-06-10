/** Lightweight semantic query expansion without requiring an LLM. */

const SYNONYM_GROUPS: string[][] = [
  ["crush", "crushing", "crushed", "break", "breaking", "break apart", "smash", "smashing", "pulverize", "grind"],
  ["ore", "mineral", "iron ore", "copper ore", "nickel ore"],
  ["electric", "electrical", "electricity", "current", "voltage", "power"],
  ["light", "lamp", "bulb", "incandescent", "illumination"],
  ["phonograph", "gramophone", "record", "recording", "sound"],
  ["telegraph", "telegraphy", "wire", "cable", "message"],
  ["battery", "cell", "storage", "accumulator"],
  ["laboratory", "lab", "experiment", "experimental", "test", "testing"],
  ["patent", "invention", "invent", "invented", "application"],
  ["factory", "works", "mill", "plant", "manufacturing"],
  ["letter", "correspondence", "memo", "memorandum", "note", "notes"],
  ["motion picture", "motion pictures", "kinetoscope", "cinematograph", "moving pictures", "moving picture", "film", "films", "movies", "cinema", "cinematography"],
  ["machine", "machinery", "apparatus", "device", "mechanism"],
  ["carbon", "filament", "electrode", "conductor"],
  ["mine", "mining", "extract", "extraction", "quarry"],
];

function normalizeTerm(term: string): string {
  return term.toLowerCase().replace(/[^\w\s-]/g, " ").trim();
}

function tokenize(query: string): string[] {
  return normalizeTerm(query)
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function expandToken(token: string): string[] {
  const expanded = new Set<string>([token]);

  for (const group of SYNONYM_GROUPS) {
    const normalizedGroup = group.map(normalizeTerm);
    if (normalizedGroup.some((entry) => entry.includes(token) || token.includes(entry))) {
      for (const entry of group) {
        expanded.add(normalizeTerm(entry));
      }
    }
  }

  if (token.endsWith("ing") && token.length > 4) {
    expanded.add(token.slice(0, -3));
  }
  if (token.endsWith("ed") && token.length > 3) {
    expanded.add(token.slice(0, -2));
  }
  if (token.endsWith("s") && token.length > 3) {
    expanded.add(token.slice(0, -1));
  }

  return [...expanded];
}

export function expandQueryTerms(query: string): string[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return [];
  }

  const expanded = new Set<string>();
  expanded.add(normalizeTerm(query));

  for (const token of tokens) {
    for (const term of expandToken(token)) {
      expanded.add(term);
    }
  }

  for (let index = 0; index < tokens.length - 1; index++) {
    expanded.add(`${tokens[index]} ${tokens[index + 1]}`);
  }

  return [...expanded].slice(0, 20);
}

/** Expand only the topic portion of a compound query (avoids unrelated synonym groups). */
export function expandTopicTerms(topicQuery: string): string[] {
  const tokens = tokenize(topicQuery);
  if (tokens.length === 0) {
    return [];
  }

  const expanded = new Set<string>();
  expanded.add(normalizeTerm(topicQuery));

  for (const token of tokens) {
    expanded.add(token);
    for (const term of expandToken(token)) {
      expanded.add(term);
    }
  }

  for (let index = 0; index < tokens.length - 1; index++) {
    expanded.add(`${tokens[index]} ${tokens[index + 1]}`);
  }

  return [...expanded].slice(0, 16);
}

export async function expandQueryWithAi(
  query: string,
): Promise<string[] | null> {
  const { getAppEnv } = await import("@/lib/edison/env");
  const env = getAppEnv();
  if (env.SEARCH_AI_EXPANSION_ENABLED !== "true") {
    return null;
  }

  try {
    const { generateText } = await import("ai");
    const { resolveGeminiModel } = await import("@/lib/edison/gemini-model");
    const { isGeminiConfigured } = await import("@/lib/edison/gemini-config");

    if (!isGeminiConfigured()) {
      return null;
    }

    const model = resolveGeminiModel();
    const { text } = await generateText({
      model,
      prompt: `You are helping researchers search the Thomas A. Edison Papers digital archive (historical letters, lab notes, patents, business records, 1870s–1930s).

Given this search query: "${query}"

Return a JSON array of 8-12 alternative search phrases that capture the same MEANING using different historical or modern wording. Include synonyms, related technical terms, and period-appropriate language.

Examples:
- "crushing ore" → ["breaking apart ore", "smashing ore", "ore pulverization", "grinding mineral", "crushing mineral ore"]
- "electric light" → ["incandescent lamp", "electric illumination", "light bulb", "carbon filament lamp"]

Return ONLY a JSON array of strings, no markdown.`,
      maxOutputTokens: 256,
    });

    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      return null;
    }

    const parsed = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map(normalizeTerm)
      .filter(Boolean)
      .slice(0, 12);
  } catch {
    return null;
  }
}

export async function getExpandedSearchTerms(query: string): Promise<{
  terms: string[];
  mode: "semantic" | "keyword";
}> {
  const baseTerms = expandQueryTerms(query);
  return {
    terms: baseTerms.length ? baseTerms : [normalizeTerm(query)],
    mode: "keyword",
  };
}
