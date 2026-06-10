import { AppError } from "./app-error";

export interface SplitValidationResult {
  errorMessage?: string;
  perRow: Array<string | undefined>;
}

/**
 * Validates a splits array and returns per-row and overall error messages
 * without throwing. Safe to call from client components for inline feedback.
 */
export function checkSplitRules(
  splits: Array<{ startPage: number; endPage: number }>,
  totalPages: number,
): SplitValidationResult {
  const perRow: Array<string | undefined> = splits.map(() => undefined);
  if (splits.length === 0) {
    return { errorMessage: "Add at least one split.", perRow };
  }
  let cursor = 0;
  let errorMessage: string | undefined;
  for (const [index, split] of splits.entries()) {
    if (!Number.isInteger(split.startPage) || !Number.isInteger(split.endPage)) {
      perRow[index] = "Page numbers must be whole integers.";
      errorMessage ??= perRow[index];
      continue;
    }
    if (split.startPage !== cursor + 1) {
      perRow[index] = `Must start at page ${cursor + 1}.`;
      errorMessage ??= perRow[index];
      continue;
    }
    if (split.endPage < split.startPage) {
      perRow[index] = "End page is before start page.";
      errorMessage ??= perRow[index];
      continue;
    }
    if (split.endPage > totalPages) {
      perRow[index] = `Exceeds source page count (${totalPages}).`;
      errorMessage ??= perRow[index];
      continue;
    }
    cursor = split.endPage;
  }
  if (!errorMessage && cursor !== totalPages) {
    errorMessage = `Splits cover pages 1\u2013${cursor}, but the source has ${totalPages} pages.`;
  }
  return { errorMessage, perRow };
}

/**
 * Server-side guard: throws AppError("BAD_REQUEST") on any splits violation.
 * Delegates rule evaluation to checkSplitRules so both paths stay in sync.
 */
export function validateContiguousSplits(
  splits: Array<{ startPage: number; endPage: number }>,
  totalPages: number,
): void {
  const { errorMessage } = checkSplitRules(splits, totalPages);
  if (errorMessage) {
    throw new AppError("BAD_REQUEST", errorMessage, 400);
  }
}
