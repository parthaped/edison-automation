# Edison HTR Ground-Truth Policy

The first model target is diplomatic transcription: preserve the document's spelling, punctuation, capitalization, abbreviations, and line content as written.

## Include

- Body text, headings, signatures, datelines, postscripts, and marginal notes.
- Original punctuation and capitalization.
- Historical spelling and abbreviations.
- Line text exactly as the annotator wants the recognizer to produce it.

## Exclude From Training Or Flag

Exclude a line from recognizer training when the reference text is uncertain enough that it would teach noise. If the line is useful but difficult, keep it and add `quality_flags`.

Recommended flags:

- `uncertain`
- `struck_out`
- `marginal`
- `low_contrast`
- `overwritten`
- `rotated`
- `table`
- `printed`
- `mixed_hand`

## Uncertain Readings

Do not train bracketed guesses such as `[filament?]` unless the brackets are a deliberate target convention. Prefer one of these:

- Exclude the line from training.
- Keep the line in evaluation only.
- Train only the confident part if the PAGE XML line can be split cleanly.

## Normalized Text

Normalized text is useful for search and metadata, but it should be a separate field. Do not mix normalized text into recognizer labels.

## Splits

Split by document, folder, or known writer group. Do not randomly split individual lines from the same document into train and test, because that inflates performance and hides generalization problems.
