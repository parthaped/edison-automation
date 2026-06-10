import { expandTopicTerms } from "./query-expand";

export interface QueryIntent {
  rawQuery: string;
  documentTypeHint?: string;
  topicQuery: string;
  topicTerms: string[];
  genericTerms: string[];
}

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "for",
  "from",
  "with",
  "about",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "under",
  "again",
  "further",
  "then",
  "once",
  "here",
  "there",
  "when",
  "where",
  "why",
  "how",
  "all",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "can",
  "will",
  "just",
  "don",
  "should",
  "now",
  "related",
  "regarding",
  "concerning",
  "involving",
  "mentioning",
  "discussing",
  "discuss",
  "describe",
  "describing",
]);

const COMPOUND_CONNECTORS =
  /\b(?:about|on|regarding|concerning|related\s+to|involving|discussing|mentioning|for)\b/i;

const DOCUMENT_TYPE_HINTS: Record<string, string> = {
  letter: "Letter",
  letters: "Letter",
  correspondence: "Letter",
  memo: "Memorandum",
  memos: "Memorandum",
  memorandum: "Memorandum",
  memoranda: "Memorandum",
  note: "Note",
  notes: "Note",
  notebook: "Notebook page",
  "notebook page": "Notebook page",
  "notebook pages": "Notebook page",
  patent: "Patent",
  patents: "Patent",
  telegram: "Telegram",
  telegrams: "Telegram",
  report: "Report",
  reports: "Report",
  invoice: "Invoice",
  invoices: "Invoice",
  contract: "Contract",
  contracts: "Contract",
};

const GENERIC_DOC_TERMS = new Set([
  "letter",
  "letters",
  "correspondence",
  "memo",
  "memos",
  "memorandum",
  "memoranda",
  "note",
  "notes",
  "notebook",
  "page",
  "pages",
  "document",
  "documents",
  "record",
  "records",
  "file",
  "files",
]);

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function findDocumentTypeHint(tokens: string[]): string | undefined {
  const joined = tokens.join(" ");

  for (const [hint, documentType] of Object.entries(DOCUMENT_TYPE_HINTS)) {
    if (hint.includes(" ")) {
      if (joined.includes(hint)) {
        return documentType;
      }
      continue;
    }

    if (tokens.includes(hint)) {
      return documentType;
    }
  }

  return undefined;
}

function extractTopicQuery(rawQuery: string): {
  topicQuery: string;
  documentTypeHint?: string;
} {
  const normalized = normalizeQuery(rawQuery);
  const match = normalized.match(
    new RegExp(
      `^(.+?)\\s+${COMPOUND_CONNECTORS.source}\\s+(.+)$`,
      "i",
    ),
  );

  if (!match) {
    return { topicQuery: normalized };
  }

  const typePart = match[1]?.trim() ?? "";
  const topicPart = match[2]?.trim() ?? "";
  const typeTokens = tokenize(typePart);
  const documentTypeHint = findDocumentTypeHint(typeTokens);

  if (documentTypeHint && topicPart) {
    return { topicQuery: topicPart, documentTypeHint };
  }

  return { topicQuery: normalized };
}

function collectGenericTerms(tokens: string[]): string[] {
  return tokens.filter((token) => GENERIC_DOC_TERMS.has(token));
}

function collectRequiredTopicTokens(topicQuery: string): string[] {
  const tokens = tokenize(topicQuery).filter((token) => !STOPWORDS.has(token));
  const phrases: string[] = [];

  const normalizedTopic = topicQuery.toLowerCase();
  if (normalizedTopic.includes("motion picture")) {
    phrases.push("motion picture", "motion pictures");
  }
  if (normalizedTopic.includes("moving picture")) {
    phrases.push("moving picture", "moving pictures");
  }
  if (normalizedTopic.includes("electric light")) {
    phrases.push("electric light");
  }

  return [...new Set([...phrases, ...tokens])];
}

export function parseQueryIntent(rawQuery: string): QueryIntent {
  const normalized = normalizeQuery(rawQuery);
  if (!normalized) {
    return {
      rawQuery: "",
      topicQuery: "",
      topicTerms: [],
      genericTerms: [],
    };
  }

  const { topicQuery, documentTypeHint } = extractTopicQuery(normalized);
  const topicTokens = collectRequiredTopicTokens(topicQuery);
  const expandedTopicTerms = expandTopicTerms(topicQuery);
  const topicTerms = [...new Set([...topicTokens, ...expandedTopicTerms])].filter(
    Boolean,
  );

  const genericTerms = collectGenericTerms(tokenize(normalized));

  return {
    rawQuery: normalized,
    documentTypeHint,
    topicQuery: topicQuery || normalized,
    topicTerms,
    genericTerms,
  };
}

export function hasCompoundTopicIntent(intent: QueryIntent): boolean {
  return (
    Boolean(intent.documentTypeHint) &&
    intent.topicQuery !== intent.rawQuery &&
    intent.topicTerms.length > 0
  );
}
