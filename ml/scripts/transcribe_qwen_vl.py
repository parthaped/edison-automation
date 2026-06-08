#!/usr/bin/env python3
"""Transcribe Edison archival page images with Qwen2.5-VL-7B-Instruct (4-bit)."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))


def _patch_torch_fp8_compat() -> None:
    """Allow transformers 5.10+ on torch<2.7 until requirements pin is applied."""
    try:
        import torch
    except ImportError:
        return
    if not hasattr(torch, "float8_e8m0fnu"):
        setattr(torch, "float8_e8m0fnu", torch.float32)


def _patch_bitsandbytes_hf_compat() -> None:
    """transformers 5.x + accelerate pass _is_hf_initialized into Params4bit (bnb<0.50)."""
    try:
        import bitsandbytes as bnb
    except ImportError:
        return

    for name in ("Params4bit", "Int8Params"):
        param_cls = getattr(bnb.nn, name, None)
        if param_cls is None:
            continue
        original_new = param_cls.__new__

        def make_patched(original):  # noqa: ANN001
            def patched(cls, *args, **kwargs):  # noqa: ANN001
                kwargs.pop("_is_hf_initialized", None)
                return original(cls, *args, **kwargs)

            return patched

        param_cls.__new__ = make_patched(original_new)


_patch_torch_fp8_compat()

from vision_transcribe import DIPLOMATIC_PROMPT, parse_transcription_lines  # noqa: E402

DEFAULT_MODEL_DIR = Path("ml/models/Qwen2.5-VL-7B-Instruct")
PROMPT_VERSION = "local-qwen-vl-v1"
MODEL_LABEL = "local/qwen2.5-vl-7b-instruct"
LOW_VRAM_GB = 6.0


def gpu_vram_gb() -> float | None:
    try:
        import torch
    except ImportError:
        return None
    if not torch.cuda.is_available():
        return None
    return torch.cuda.get_device_properties(0).total_memory / (1024**3)


def resolve_load_strategy(explicit_cpu_offload: bool | None) -> str:
    """Pick 4-bit load target. Split GPU/CPU offload is unreliable with bnb on 4 GB GPUs."""
    if explicit_cpu_offload is False:
        return "gpu"
    if explicit_cpu_offload is True:
        return "cpu"
    vram = gpu_vram_gb()
    if vram is None or vram <= LOW_VRAM_GB:
        return "cpu"
    return "gpu"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True, help="Page image (JPG/PNG).")
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--max-new-tokens", type=int, default=4096)
    parser.add_argument("--output", type=Path, default=None, help="Optional output text file.")
    parser.add_argument("--json", action="store_true", help="Emit local OCR contract JSON.")
    parser.add_argument(
        "--cpu-offload",
        action="store_true",
        default=None,
        help="Load and run 4-bit model on CPU (default: auto for GPUs <= 6 GB).",
    )
    parser.add_argument(
        "--no-cpu-offload",
        action="store_true",
        help="Load all 4-bit weights on GPU (needs ~6+ GB VRAM).",
    )
    return parser.parse_args()


@dataclass
class QwenVlTranscriber:
    model_dir: Path
    max_new_tokens: int = 4096
    cpu_offload: bool | None = None
    _model: object | None = None
    _processor: object | None = None
    _inference_device: str = "cpu"

    def _load_strategy(self) -> str:
        return resolve_load_strategy(self.cpu_offload)

    def _load(self) -> None:
        if self._model is not None and self._processor is not None:
            return

        try:
            import torch
            _patch_bitsandbytes_hf_compat()
            from qwen_vl_utils import process_vision_info
            from transformers import AutoProcessor, BitsAndBytesConfig, Qwen2_5_VLForConditionalGeneration
        except (ImportError, ModuleNotFoundError, AttributeError) as error:
            raise RuntimeError(
                "Qwen VLM import failed. Run: pip install -r ml/requirements-qwen-vl.txt "
                "(needs transformers>=4.49,<5.10 with torch 2.6+cu124). "
                f"Original error: {error}"
            ) from error

        if not self.model_dir.exists():
            raise RuntimeError(
                f"Model not found at {self.model_dir}. Run: python ml/scripts/download_qwen_vl.py"
            )

        load_strategy = self._load_strategy()
        on_cpu = load_strategy == "cpu"
        compute_dtype = torch.float32 if on_cpu else torch.bfloat16
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=compute_dtype,
        )
        load_kwargs: dict[str, object] = {
            "quantization_config": bnb_config,
            "device_map": "cpu" if on_cpu else "auto",
        }

        if on_cpu:
            vram = gpu_vram_gb()
            label = f"{vram:.1f} GB GPU detected" if vram is not None else "no CUDA"
            print(
                f"Qwen2.5-VL: using CPU inference ({label}). "
                "Load + first page may take several minutes.",
                file=sys.stderr,
            )
            self._inference_device = "cpu"
        else:
            print("Qwen2.5-VL: using GPU inference (4-bit).", file=sys.stderr)
            self._inference_device = "cuda:0" if torch.cuda.is_available() else "cpu"

        self._model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
            str(self.model_dir),
            **load_kwargs,
        )
        max_pixels = 1024 * 28 * 28 if on_cpu else 1280 * 28 * 28
        self._processor = AutoProcessor.from_pretrained(
            str(self.model_dir),
            min_pixels=256 * 28 * 28,
            max_pixels=max_pixels,
        )
        self._torch = torch
        self._process_vision_info = process_vision_info

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
        text = self._processor.apply_chat_template(  # type: ignore[union-attr]
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )
        image_inputs, video_inputs = self._process_vision_info(messages)
        inputs = self._processor(  # type: ignore[union-attr]
            text=[text],
            images=image_inputs,
            videos=video_inputs,
            padding=True,
            return_tensors="pt",
        )
        inputs = inputs.to(self._inference_device)

        with self._torch.no_grad():
            generated_ids = self._model.generate(  # type: ignore[union-attr]
                **inputs,
                max_new_tokens=self.max_new_tokens,
            )
        generated_ids_trimmed = [
            out_ids[len(in_ids) :]
            for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
        ]
        raw = self._processor.batch_decode(  # type: ignore[union-attr]
            generated_ids_trimmed,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False,
        )[0].strip()

        lines = parse_transcription_lines(raw)
        if not lines:
            raise RuntimeError("Qwen2.5-VL returned empty transcription")
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
    cpu_offload: bool | None = None
    if args.no_cpu_offload:
        cpu_offload = False
    elif args.cpu_offload:
        cpu_offload = True
    transcriber = QwenVlTranscriber(
        model_dir=args.model_dir,
        max_new_tokens=args.max_new_tokens,
        cpu_offload=cpu_offload,
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
