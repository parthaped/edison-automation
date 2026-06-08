#!/usr/bin/env python3
"""Kraken segmentation, OCR, and optional forced alignment."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from kraken_gt.line_match import SegmentedLine, bbox_from_points


@dataclass
class KrakenRuntime:
    device: str = "cpu"
    batch_size: int = 8
    precision: str = "32-true"
    recognition_model: Path | None = None
    _segmentation: Any = None
    _recognition: Any = None
    _alignment: Any = None

    def _resolve_device(self) -> str:
        try:
            import torch
        except ImportError:
            return "cpu"
        if self.device.startswith("cuda") and not torch.cuda.is_available():
            return "cpu"
        return self.device

    @property
    def segmentation(self) -> Any:
        if self._segmentation is None:
            from kraken.configs import SegmentationInferenceConfig
            from kraken.tasks import SegmentationTaskModel

            self._segmentation = (
                SegmentationTaskModel.load_model(),
                SegmentationInferenceConfig(),
            )
        return self._segmentation

    def _inference_config(self, batch_size: int | None = None) -> Any:
        from kraken.configs import RecognitionInferenceConfig
        from kraken.ketos.util import to_ptl_device

        device = self._resolve_device()
        precision = self.precision
        if device == "cpu" and precision.startswith("bf16"):
            precision = "32-true"
        accelerator, ptl_device = to_ptl_device(device)
        return RecognitionInferenceConfig(
            batch_size=batch_size or self.batch_size,
            precision=precision,
            accelerator=accelerator,
            device=ptl_device,
        )

    @property
    def recognition(self) -> Any:
        if self._recognition is None:
            from kraken.tasks import RecognitionTaskModel

            if not self.recognition_model or not self.recognition_model.exists():
                raise RuntimeError(
                    f"Kraken recognition model not found: {self.recognition_model}. "
                    "Download en_best.mlmodel into ml/models/."
                )
            self._recognition = (
                RecognitionTaskModel.load_model(str(self.recognition_model)),
                self._inference_config(),
            )
        return self._recognition

    @property
    def alignment(self) -> Any:
        if self._alignment is None:
            from kraken.tasks import ForcedAlignmentTaskModel

            if not self.recognition_model or not self.recognition_model.exists():
                raise RuntimeError(f"Kraken recognition model not found: {self.recognition_model}")
            self._alignment = (
                ForcedAlignmentTaskModel.load_model(str(self.recognition_model)),
                self._inference_config(batch_size=1),
            )
        return self._alignment

    def segment_page(self, image_path: Path) -> tuple[Any, tuple[int, int]]:
        from PIL import Image

        model, config = self.segmentation
        image = Image.open(image_path).convert("RGB")
        segmentation = model.predict(image, config)
        return segmentation, image.size

    def segmented_lines_with_ocr(self, image_path: Path) -> tuple[list[SegmentedLine], tuple[int, int]]:
        from kraken.containers import BaselineLine
        from PIL import Image

        seg_model, seg_config = self.segmentation
        rec_model, rec_config = self.recognition
        image = Image.open(image_path).convert("RGB")
        size = image.size
        segmentation = seg_model.predict(image, seg_config)

        ocr_records = list(rec_model.predict(image, segmentation, rec_config))
        lines = segmentation.lines or []
        if len(ocr_records) != len(lines):
            # Keep the shorter aligned prefix; mismatches are handled downstream.
            count = min(len(ocr_records), len(lines))
            lines = lines[:count]
            ocr_records = ocr_records[:count]

        segmented: list[SegmentedLine] = []
        for index, (line, record) in enumerate(zip(lines, ocr_records, strict=False)):
            baseline = getattr(line, "baseline", None) or []
            boundary = getattr(line, "boundary", None) or []
            if not boundary and baseline:
                boundary = baseline
            if not baseline and boundary:
                baseline = boundary[:2] if len(boundary) >= 2 else boundary
            if not boundary:
                if isinstance(line, BaselineLine):
                    bbox_line = line.to_bbox()
                    boundary = [
                        (bbox_line.bbox[0], bbox_line.bbox[1]),
                        (bbox_line.bbox[2], bbox_line.bbox[1]),
                        (bbox_line.bbox[2], bbox_line.bbox[3]),
                        (bbox_line.bbox[0], bbox_line.bbox[3]),
                    ]
                    baseline = [(bbox_line.bbox[0], bbox_line.bbox[3]), (bbox_line.bbox[2], bbox_line.bbox[3])]
                else:
                    continue

            bbox = bbox_from_points(boundary)
            segmented.append(
                SegmentedLine(
                    index=index,
                    ocr_text=str(getattr(record, "prediction", "") or "").strip(),
                    baseline=[(int(x), int(y)) for x, y in baseline],
                    boundary=[(int(x), int(y)) for x, y in boundary],
                    bbox=bbox,
                    center_x=(bbox[0] + bbox[2]) / 2,
                    center_y=(bbox[1] + bbox[3]) / 2,
                )
            )
        return segmented, size

    def validate_forced_alignment(
        self,
        image_path: Path,
        reference_text: str,
        segment: SegmentedLine,
    ) -> bool:
        """Return True when forced alignment succeeds for a single line."""
        from kraken.containers import BaselineLine, Segmentation
        from PIL import Image

        if not reference_text.strip():
            return False

        try:
            align_model, align_config = self.alignment
        except RuntimeError:
            return True

        image = Image.open(image_path).convert("RGB")
        line = BaselineLine(
            id=f"line_{segment.index:04d}",
            baseline=segment.baseline,
            boundary=segment.boundary,
            text=reference_text,
        )
        seg = Segmentation(
            type="baselines",
            lines=[line],
            imagename=str(image_path),
            text_direction="horizontal-lr",
            script_detection=False,
        )
        try:
            aligned = align_model.predict(image, seg, align_config)
        except Exception:
            return False
        aligned_lines = aligned.lines or []
        if not aligned_lines:
            return False
        aligned_line = aligned_lines[0]
        prediction = str(getattr(aligned_line, "prediction", "") or getattr(aligned_line, "text", "") or "")
        return bool(prediction.strip())
