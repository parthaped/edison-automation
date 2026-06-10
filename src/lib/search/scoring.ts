import {
  extractSearchableText,
  getFirstValue,
  getValueStrings,
} from "@/lib/omeka/client";
import type { OmekaItem } from "@/lib/omeka/types";
import type { QueryIntent } from "./query-intent";
import { hasCompoundTopicIntent } from "./query-intent";

export const MIN_RELEVANCE_SCORE = 5;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countTermMatches(text: string, terms: string[]): Map<string, number> {
  const normalized = text.toLowerCase();
  const counts = new Map<string, number>();

  for (const term of terms) {
    if (!term) continue;
    const pattern =
      term.includes(" ") || term.includes("-")
        ? new RegExp(escapeRegex(term), "gi")
        : new RegExp(`\\b${escapeRegex(term)}\\b`, "gi");
    const matches = normalized.match(pattern);
    counts.set(term, matches?.length ?? 0);
  }

  return counts;
}

function getBodySearchableText(item: OmekaItem): string {
  const parts = [
    ...getValueStrings(item["dcterms:description"]),
    ...getValueStrings(item["dcterms:subject"]),
    ...getValueStrings(item["scripto:transcription"]),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function getTitleText(item: OmekaItem): string {
  return (
    (item["dcterms:title"]?.[0]?.["@value"] as string | undefined) ||
    item["o:title"] ||
    ""
  ).toLowerCase();
}

function countTopicMatchesInText(text: string, topicTerms: string[]): number {
  const counts = countTermMatches(text, topicTerms);
  let hits = 0;
  for (const count of counts.values()) {
    if (count > 0) {
      hits += 1;
    }
  }
  return hits;
}

export function meetsTopicThreshold(item: OmekaItem, intent: QueryIntent): boolean {
  if (!hasCompoundTopicIntent(intent)) {
    return true;
  }

  const bodyText = getBodySearchableText(item);
  const topicHits = countTopicMatchesInText(bodyText, intent.topicTerms);

  if (intent.topicTerms.length >= 4) {
    return topicHits >= 2;
  }

  if (intent.topicTerms.length >= 2) {
    return topicHits >= 1;
  }

  return topicHits >= 1;
}

export function scoreDocumentRelevance(
  item: OmekaItem,
  query: string,
  expandedTerms: string[],
  intent?: QueryIntent,
): { score: number; matchedTerms: string[]; snippet: string } {
  const searchableText = extractSearchableText(item);
  const normalizedText = searchableText.toLowerCase();
  const queryLower = query.toLowerCase();
  const bodyText = getBodySearchableText(item);
  const titleLower = getTitleText(item);
  const topicTerms = intent?.topicTerms.length ? intent.topicTerms : expandedTerms;

  let score = 0;
  const matchedTerms: string[] = [];

  if (normalizedText.includes(queryLower)) {
    score += 50;
    matchedTerms.push(query);
  }

  if (intent && intent.topicQuery && bodyText.includes(intent.topicQuery.toLowerCase())) {
    score += 40;
    matchedTerms.push(intent.topicQuery);
  }

  if (titleLower.includes(queryLower)) {
    score += 20;
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

  const topicCounts = countTermMatches(bodyText, topicTerms);
  for (const [term, count] of topicCounts) {
    if (count > 0) {
      matchedTerms.push(term);
      const isPhrase = term.includes(" ");
      score += count * (isPhrase ? 12 : 6);
    }
  }

  if (intent && hasCompoundTopicIntent(intent)) {
    const bodyTopicHits = countTopicMatchesInText(bodyText, intent.topicTerms);
    const titleTopicHits = countTopicMatchesInText(titleLower, intent.topicTerms);

    if (bodyTopicHits === 0 && titleTopicHits > 0) {
      score -= 25;
    }

    if (bodyTopicHits === 0) {
      score -= 15;
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

export function getItemTranscriptionPreview(item: OmekaItem): string {
  return getFirstValue(item["scripto:transcription"]).slice(0, 500);
}
