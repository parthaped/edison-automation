#!/usr/bin/env python3
"""Transcribe Edison archival page images with full Qwen3-VL-8B-Instruct."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))


from transcription_text import DIPLOMATIC_PROMPT, parse_transcription_lines  # noqa: E402

try:
    import torch
    from transformers import AutoModelForImageTextToText, AutoProcessor
except (ImportError, ModuleNotFoundError, AttributeError) as error:
    torch = None  # type: ignore[assignment]
    AutoModelForImageTextToText = None  # type: ignore[assignment]
    AutoProcessor = None  # type: ignore[assignment]
    QWEN_IMPORT_ERROR: BaseException | None = error
else:
    QWEN_IMPORT_ERROR = None

DEFAULT_MODEL_DIR = Path("ml/models/Qwen3-VL-8B-Instruct")
PROMPT_VERSION = "local-qwen3-vl-v1"
MODEL_LABEL = "local/qwen3-vl-8b-instruct"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True, help="Page image (JPG/PNG).")
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--max-new-tokens", type=int, default=4096)
    parser.add_argument("--output", type=Path, default=None, help="Optional output text file.")
    parser.add_argument("--json", action="store_true", help="Emit local OCR contract JSON.")
    parser.add_argument(
        "--device-map",
        default="auto",
        help='Transformers device_map for the full model. Defaults to "auto" for Amarel GPU nodes.',
    )
    parser.add_argument(
        "--torch-dtype",
        choices=("auto", "bfloat16", "float16", "float32"),
        default="bfloat16",
        help="Torch dtype for unquantized weights.",
    )
    parser.add_argument(
        "--attn-implementation",
        default=None,
        help='Optional Transformers attention implementation, e.g. "flash_attention_2".',
    )
    return parser.parse_args()


def resolve_torch_dtype(torch_module: object, dtype_name: str) -> object:
    if dtype_name == "auto":
        return "auto"
    return getattr(torch_module, dtype_name)


@dataclass
class QwenVlTranscriber:
    model_dir: Path
    max_new_tokens: int = 4096
    device_map: str = "auto"
    torch_dtype: str = "bfloat16"
    attn_implementation: str | None = None
    _model: object | None = None
    _processor: object | None = None
    _input_device: object | None = None

    def _load(self) -> None:
        if self._model is not None and self._processor is not None:
            return

        if (
            QWEN_IMPORT_ERROR is not None
            or torch is None
            or AutoModelForImageTextToText is None
            or AutoProcessor is None
        ):
            raise RuntimeError(
                "Qwen VLM import failed. Run: pip install -r ml/requirements-qwen-vl.txt "
                "(needs transformers>=4.57 with torch 2.6+cu124). "
                f"Original error: {QWEN_IMPORT_ERROR}"
            ) from QWEN_IMPORT_ERROR

        if not self.model_dir.exists():
            raise RuntimeError(
                f"Model not found at {self.model_dir}. Run: python ml/scripts/download_qwen_vl.py"
            )

        device_map_lower = self.device_map.lower()
        if device_map_lower != "cpu" and not torch.cuda.is_available():
            raise RuntimeError(
                "CUDA is not available. Run on an Amarel GPU node or pass "
                '--device-map cpu --torch-dtype float32 for a slow local smoke test.'
            )

        dtype = resolve_torch_dtype(torch, self.torch_dtype)
        load_kwargs: dict[str, object] = {
            "dtype": dtype,
            "device_map": self.device_map,
        }
        if self.attn_implementation:
            load_kwargs["attn_implementation"] = self.attn_implementation

        print(
            f"Qwen3-VL: loading full unquantized weights "
            f"(dtype={self.torch_dtype}, device_map={self.device_map}).",
            file=sys.stderr,
        )
        self._model = AutoModelForImageTextToText.from_pretrained(
            str(self.model_dir),
            **load_kwargs,
        )
        self._processor = AutoProcessor.from_pretrained(str(self.model_dir))
        self._input_device = getattr(self._model, "device", None)
        if self._input_device is None:
            self._input_device = next(self._model.parameters()).device  # type: ignore[union-attr]
        self._torch = torch

    def transcribe_page(self, image_path: Path) -> tuple[list[str], str]:
        """Return (lines, raw_text) for one page image."""
        self._load()
        image_path = image_path.resolve()
        if not image_path.exists():
            raise RuntimeError(f"Image not found: {image_path}")

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": str(image_path)},
                    {"type": "text", "text": DIPLOMATIC_PROMPT},
                ],
            }
        ]
        inputs = self._processor.apply_chat_template(  # type: ignore[union-attr]
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_dict=True,
            return_tensors="pt",
        )
        inputs = inputs.to(self._input_device)

        with self._torch.no_grad():
            generated_ids = self._model.generate(  # type: ignore[union-attr]
                **inputs,
                max_new_tokens=self.max_new_tokens,
            )
        generated_ids_trimmed = [
            out_ids[len(in_ids) :]
            for in_ids, out_ids in zip(inputs["input_ids"], generated_ids)
        ]
        raw = self._processor.batch_decode(  # type: ignore[union-attr]
            generated_ids_trimmed,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False,
        )[0].strip()

        lines = parse_transcription_lines(raw)
        if not lines:
            raise RuntimeError("Qwen3-VL returned empty transcription")
        return lines, raw

    def to_contract(self, lines: list[str]) -> dict[str, object]:
        text = "\n".join(lines)
        return {
            "ocrText": text,
            "model": MODEL_LABEL,
            "promptVersion": PROMPT_VERSION,
            "uncertainReadings": [],
            "pages": [
                {
                    "pageIndex": 0,
                    "text": text,
                    "lines": [{"lineIndex": index, "text": line} for index, line in enumerate(lines)],
                }
            ],
        }


def main() -> int:
    args = parse_args()
    transcriber = QwenVlTranscriber(
        model_dir=args.model_dir,
        max_new_tokens=args.max_new_tokens,
        device_map=args.device_map,
        torch_dtype=args.torch_dtype,
        attn_implementation=args.attn_implementation,
    )
    lines, raw = transcriber.transcribe_page(args.image)
    text = "\n".join(lines)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
        print(f"Wrote {args.output}", file=sys.stderr)

    if args.json:
        print(json.dumps(transcriber.to_contract(lines), ensure_ascii=False, indent=2))
    else:
        print(text)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
