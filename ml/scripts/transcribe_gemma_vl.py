#!/usr/bin/env python3
"""Transcribe Edison archival page images with Gemma 4 26B A4B Instruct."""

from __future__ import annotations

import argparse
import gc
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from generation_metrics import GenerationMetrics  # noqa: E402
from scratch_paths import gemma_model_dir  # noqa: E402
from transcription_text import DIPLOMATIC_PROMPT, parse_transcription_lines  # noqa: E402

try:
    import torch
    from transformers import AutoModelForImageTextToText, AutoProcessor
except (ImportError, ModuleNotFoundError, AttributeError) as error:
    torch = None  # type: ignore[assignment]
    AutoModelForImageTextToText = None  # type: ignore[assignment]
    AutoProcessor = None  # type: ignore[assignment]
    GEMMA_IMPORT_ERROR: BaseException | None = error
else:
    GEMMA_IMPORT_ERROR = None

PROMPT_VERSION = "local-gemma-4-26b-a4b-v1"
MODEL_LABEL = "gemma-4-26b-a4b-it"
MODEL_SLUG = "gemma-4-26b"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True, help="Page image (JPG/PNG).")
    parser.add_argument("--model-dir", type=Path, default=None)
    parser.add_argument("--max-new-tokens", type=int, default=4096)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--device-map", default="auto")
    parser.add_argument(
        "--torch-dtype",
        choices=("auto", "bfloat16", "float16", "float32"),
        default="bfloat16",
    )
    parser.add_argument("--attn-implementation", default=None)
    return parser.parse_args()


def resolve_torch_dtype(torch_module: object, dtype_name: str) -> object:
    if dtype_name == "auto":
        return "auto"
    return getattr(torch_module, dtype_name)


@dataclass
class GemmaVlTranscriber:
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
            GEMMA_IMPORT_ERROR is not None
            or torch is None
            or AutoModelForImageTextToText is None
            or AutoProcessor is None
        ):
            raise RuntimeError(
                "Gemma VLM import failed. Run: pip install -r ml/requirements-vl-benchmark.txt "
                f"Original error: {GEMMA_IMPORT_ERROR}"
            ) from GEMMA_IMPORT_ERROR

        if not self.model_dir.exists():
            raise RuntimeError(
                f"Model not found at {self.model_dir}. Run: python ml/scripts/download_gemma_vl.py"
            )

        if self.device_map.lower() != "cpu" and not torch.cuda.is_available():
            raise RuntimeError(
                "CUDA is not available. Run on an Amarel GPU node with 2× L40 GPUs."
            )

        dtype = resolve_torch_dtype(torch, self.torch_dtype)
        load_kwargs: dict[str, object] = {
            "dtype": dtype,
            "device_map": self.device_map,
        }
        if self.attn_implementation:
            load_kwargs["attn_implementation"] = self.attn_implementation

        print(
            f"Gemma-4-26B: loading full bf16 weights "
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

    def unload(self) -> None:
        self._model = None
        self._processor = None
        self._input_device = None
        if torch is not None and torch.cuda.is_available():
            gc.collect()
            torch.cuda.empty_cache()

    def transcribe_page(self, image_path: Path) -> tuple[list[str], str, GenerationMetrics]:
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
        input_len = int(inputs["input_ids"].shape[-1])

        started = time.perf_counter()
        with self._torch.no_grad():
            generated_ids = self._model.generate(  # type: ignore[union-attr]
                **inputs,
                max_new_tokens=self.max_new_tokens,
            )
        elapsed = time.perf_counter() - started

        generated_ids_trimmed = [
            out_ids[len(in_ids) :]
            for in_ids, out_ids in zip(inputs["input_ids"], generated_ids)
        ]
        output_len = int(generated_ids_trimmed[0].shape[-1])
        raw = self._processor.batch_decode(  # type: ignore[union-attr]
            generated_ids_trimmed,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False,
        )[0].strip()

        lines = parse_transcription_lines(raw)
        if not lines:
            raise RuntimeError("Gemma 4 returned empty transcription")

        metrics = GenerationMetrics(
            input_tokens=input_len,
            output_tokens=output_len,
            elapsed_sec=elapsed,
        )
        return lines, raw, metrics


def main() -> int:
    args = parse_args()
    transcriber = GemmaVlTranscriber(
        model_dir=args.model_dir or gemma_model_dir(),
        max_new_tokens=args.max_new_tokens,
        device_map=args.device_map,
        torch_dtype=args.torch_dtype,
        attn_implementation=args.attn_implementation,
    )
    lines, _raw, metrics = transcriber.transcribe_page(args.image)
    text = "\n".join(lines)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
        print(f"Wrote {args.output}", file=sys.stderr)

    if args.json:
        print(
            json.dumps(
                {
                    "model": MODEL_LABEL,
                    "promptVersion": PROMPT_VERSION,
                    "text": text,
                    "metrics": metrics.to_dict(),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(text)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
