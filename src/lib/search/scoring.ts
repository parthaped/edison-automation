import type { OmekaItem } from "@/lib/omeka/types";
import { extractSearchableText } from "@/lib/omeka/client";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countTermMatches(text: string, terms: string[]): Map<string, number> {
  const normalized = text.toLowerCase();
  const counts = new Map<string, number>();

  for (const term of terms) {
    if (!term) continue;
    const pattern = new RegExp(`\\b${escapeRegex(term)}\\b`, "gi");
    const matches = normalized.match(pattern);
    counts.set(term, matches?.length ?? 0);
  }

  return counts;
}

export function scoreDocumentRelevance(
  item: OmekaItem,
  query: string,
  expandedTerms: string[],
): { score: number; matchedTerms: string[]; snippet: string } {
  const searchableText = extractSearchableText(item);
  const normalizedText = searchableText.toLowerCase();
  const queryLower = query.toLowerCase();

  let score = 0;
  const matchedTerms: string[] = [];

  if (normalizedText.includes(queryLower)) {
    score += 50;
    matchedTerms.push(query);
  }

  const title =
    (item["dcterms:title"]?.[0]?.["@value"] as string | undefined) ||
    item["o:title"] ||
    "";
  const titleLower = title.toLowerCase();

  if (titleLower.includes(queryLower)) {
    score += 30;
  }

  const termCounts = countTermMatches(searchableText, expandedTerms);
  for (const [term, count] of termCounts) {
    if (count > 0) {
      matchedTerms.push(term);
      const titleBonus = titleLower.includes(term) ? 3 : 0;
      const subjectBonus = (item["dcterms:subject"] ?? []).some((entry) =>
        String(entry["@value"] ?? "").toLowerCase().includes(term),
      )
        ? 2
        : 0;
      score += count * (2 + titleBonus + subjectBonus);
    }
  }

  const uniqueMatched = [...new Set(matchedTerms)];
  const snippet = buildSnippet(searchableText, query, expandedTerms);

  return { score, matchedTerms: uniqueMatched, snippet };
}

function buildSnippet(
  text: string,
  query: string,
  expandedTerms: string[],
): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  const lower = normalized.toLowerCase();
  const needles = [query.toLowerCase(), ...expandedTerms].filter(Boolean);

  let bestIndex = -1;
  for (const needle of needles) {
    const index = lower.indexOf(needle);
    if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index;
    }
  }

  const contextRadius = 160;
  const start = bestIndex === -1 ? 0 : Math.max(0, bestIndex - 60);
  const end = Math.min(normalized.length, start + contextRadius);
  let snippet = normalized.slice(start, end).trim();

  if (start > 0) {
    snippet = `…${snippet}`;
  }
  if (end < normalized.length) {
    snippet = `${snippet}…`;
  }

  return snippet;
}

export function sortByRelevance<T extends { relevanceScore: number; title: string }>(
  results: T[],
): T[] {
  return [...results].sort((left, right) => {
    if (right.relevanceScore !== left.relevanceScore) {
      return right.relevanceScore - left.relevanceScore;
    }
    return left.title.localeCompare(right.title);
  });
}
