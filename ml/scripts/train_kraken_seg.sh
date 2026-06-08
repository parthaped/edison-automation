#!/usr/bin/env bash
set -euo pipefail

PAGE_XML_DIR="${PAGE_XML_DIR:-ml/data/pagexml}"
PAGE_LIST="${PAGE_LIST:-}"
OUTPUT_MODEL="${OUTPUT_MODEL:-ml/models/edison-seg.mlmodel}"
BASE_MODEL="${BASE_MODEL:-}"
TRAIN_ARGS=(${TRAIN_ARGS:-})

if ! command -v ketos >/dev/null 2>&1; then
  echo "Kraken ketos CLI was not found." >&2
  exit 1
fi

if [ -n "$PAGE_LIST" ]; then
  mapfile -t XML_FILES < "$PAGE_LIST"
else
  mapfile -t XML_FILES < <(find "$PAGE_XML_DIR" -maxdepth 1 -name '*.xml' | sort)
fi

if [ "${#XML_FILES[@]}" -eq 0 ]; then
  echo "No PAGE XML files found." >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_MODEL")"
export PYTHONUTF8=1

if [ -n "$BASE_MODEL" ]; then
  ketos --workers 0 segtrain -f page -i "$BASE_MODEL" -o "$OUTPUT_MODEL" "${TRAIN_ARGS[@]}" "${XML_FILES[@]}"
else
  ketos --workers 0 segtrain -f page -o "$OUTPUT_MODEL" "${TRAIN_ARGS[@]}" "${XML_FILES[@]}"
fi

echo "Segmentation model written to ${OUTPUT_MODEL}"
