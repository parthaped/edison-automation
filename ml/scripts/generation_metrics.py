#!/usr/bin/env python3
"""Shared generation timing/token metrics for VL transcribers."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class GenerationMetrics:
    input_tokens: int
    output_tokens: int
    elapsed_sec: float

    @property
    def tokens_per_min(self) -> float:
        if self.elapsed_sec <= 0:
            return 0.0
        return self.output_tokens / self.elapsed_sec * 60.0

    def to_dict(self) -> dict[str, float | int]:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "elapsed_sec": round(self.elapsed_sec, 4),
            "tokens_per_min": round(self.tokens_per_min, 2),
        }
