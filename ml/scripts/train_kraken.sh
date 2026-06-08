#!/usr/bin/env bash
set -euo pipefail

PAGE_XML_DIR="${PAGE_XML_DIR:-ml/data/pagexml}"
PAGE_LIST="${PAGE_LIST:-}"
OUTPUT_MODEL="${OUTPUT_MODEL:-ml/models/edison-htr.mlmodel}"
COMPILED_DATA="${COMPILED_DATA:-ml/data/manifests/edison_recognition.arrow}"
BASE_MODEL="${BASE_MODEL:-}"
BATCH_SIZE="${BATCH_SIZE:-0}"
AUGMENT="${AUGMENT:-0}"
RESIZE="${RESIZE:-}"
MAX_EPOCHS="${MAX_EPOCHS:-0}"
TRAIN_ARGS=(${TRAIN_ARGS:-})

if ! command -v ketos >/dev/null 2>&1; then
  echo "Kraken ketos CLI was not found. Install kraken in your Python ML environment." >&2
  exit 1
fi

if [ -n "$PAGE_LIST" ]; then
  mapfile -t XML_FILES < "$PAGE_LIST"
else
  mapfile -t XML_FILES < <(find "$PAGE_XML_DIR" -maxdepth 1 -name '*.xml' | sort)
fi

if [ "${#XML_FILES[@]}" -eq 0 ]; then
  echo "No PAGE XML files found in ${PAGE_XML_DIR}" >&2
  exit 1
fi

mkdir -p "$(dirname "$COMPILED_DATA")" "$(dirname "$OUTPUT_MODEL")"

if command -v python >/dev/null 2>&1; then
  if [ -n "$PAGE_LIST" ]; then
    python ml/scripts/compile_kraken_dataset.py --page-list "$PAGE_LIST" --output "$COMPILED_DATA" --num-workers 0
  else
    python ml/scripts/compile_kraken_dataset.py --pagexml-dir "$PAGE_XML_DIR" --output "$COMPILED_DATA" --num-workers 0
  fi
else
  ketos compile -f page -o "$COMPILED_DATA" "${XML_FILES[@]}"
fi

extra_args=()
if [ "$BATCH_SIZE" -gt 0 ]; then
  extra_args+=(-B "$BATCH_SIZE")
fi
if [ "$AUGMENT" = "1" ]; then
  extra_args+=(--augment)
fi
if [ -n "$RESIZE" ]; then
  extra_args+=(--resize "$RESIZE")
fi
if [ "$MAX_EPOCHS" -gt 0 ]; then
  extra_args+=(-N "$MAX_EPOCHS")
fi
if [ "${#TRAIN_ARGS[@]}" -gt 0 ]; then
  extra_args+=("${TRAIN_ARGS[@]}")
fi

export PYTHONUTF8=1
if [ -n "$BASE_MODEL" ]; then
  ketos --workers 0 train -f binary -i "$BASE_MODEL" -o "$OUTPUT_MODEL" "${extra_args[@]}" "$COMPILED_DATA"
else
  ketos --workers 0 train -f binary -o "$OUTPUT_MODEL" "${extra_args[@]}" "$COMPILED_DATA"
fi
