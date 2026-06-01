#!/usr/bin/env bash
set -euo pipefail

PAGE_XML_DIR="${PAGE_XML_DIR:-ml/data/pagexml}"
OUTPUT_MODEL="${OUTPUT_MODEL:-ml/models/edison-htr.mlmodel}"
COMPILED_DATA="${COMPILED_DATA:-ml/data/manifests/edison_recognition.arrow}"
BASE_MODEL="${BASE_MODEL:-}"

if ! command -v ketos >/dev/null 2>&1; then
  echo "Kraken ketos CLI was not found. Install kraken in your Python ML environment." >&2
  exit 1
fi

mapfile -t XML_FILES < <(python - "$PAGE_XML_DIR" <<'PY'
from pathlib import Path
import sys
for path in sorted(Path(sys.argv[1]).glob("*.xml")):
    print(path)
PY
)

if [ "${#XML_FILES[@]}" -eq 0 ]; then
  echo "No PAGE XML files found in ${PAGE_XML_DIR}" >&2
  exit 1
fi

mkdir -p "$(dirname "$COMPILED_DATA")" "$(dirname "$OUTPUT_MODEL")"

ketos compile -f page -o "$COMPILED_DATA" "${XML_FILES[@]}"

if [ -n "$BASE_MODEL" ]; then
  ketos train -f binary -i "$BASE_MODEL" -o "$OUTPUT_MODEL" "$COMPILED_DATA"
else
  ketos train -f binary -o "$OUTPUT_MODEL" "$COMPILED_DATA"
fi
