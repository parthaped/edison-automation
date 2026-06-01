#!/usr/bin/env python3
"""Fine-tune TrOCR on Edison line-crop JSONL."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lines", type=Path, default=Path("ml/data/manifests/line_crops.jsonl"))
    parser.add_argument("--model", default="microsoft/trocr-small-handwritten")
    parser.add_argument("--output-dir", type=Path, default=Path("ml/models/trocr-edison"))
    parser.add_argument("--epochs", type=float, default=5)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--max-target-length", type=int, default=256)
    return parser.parse_args()


def load_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def main() -> int:
    args = parse_args()

    try:
        import evaluate
        import numpy as np
        from datasets import Dataset, DatasetDict
        from PIL import Image
        from transformers import (
            Seq2SeqTrainer,
            Seq2SeqTrainingArguments,
            TrOCRProcessor,
            VisionEncoderDecoderModel,
            default_data_collator,
        )
    except ImportError as error:
        raise RuntimeError(
            "TrOCR training requires ml/requirements.txt dependencies in a Python ML environment."
        ) from error

    rows = load_rows(args.lines)
    if not rows:
        raise RuntimeError(f"No line rows found in {args.lines}")

    by_split: dict[str, list[dict[str, Any]]] = {"train": [], "validation": [], "test": []}
    for row in rows:
        by_split.setdefault(row.get("split", "train"), []).append(row)
    if not by_split["train"]:
        raise RuntimeError("No train rows found in line-crop manifest")
    if not by_split["validation"]:
        by_split["validation"] = by_split["train"][: max(1, len(by_split["train"]) // 10)]

    dataset = DatasetDict(
        {
            split: Dataset.from_list(split_rows)
            for split, split_rows in by_split.items()
            if split_rows
        }
    )

    processor = TrOCRProcessor.from_pretrained(args.model)
    model = VisionEncoderDecoderModel.from_pretrained(args.model)
    model.config.decoder_start_token_id = processor.tokenizer.cls_token_id
    model.config.pad_token_id = processor.tokenizer.pad_token_id
    model.config.vocab_size = model.config.decoder.vocab_size
    model.config.eos_token_id = processor.tokenizer.sep_token_id
    model.config.max_length = args.max_target_length
    model.config.early_stopping = True
    model.config.no_repeat_ngram_size = 3
    model.config.length_penalty = 2.0
    model.config.num_beams = 4

    def preprocess(batch: dict[str, Any]) -> dict[str, Any]:
        image = Image.open(batch["image_path"]).convert("RGB")
        batch["pixel_values"] = processor(image, return_tensors="pt").pixel_values[0]
        labels = processor.tokenizer(
            batch["text"],
            padding="max_length",
            max_length=args.max_target_length,
            truncation=True,
        ).input_ids
        batch["labels"] = [label if label != processor.tokenizer.pad_token_id else -100 for label in labels]
        return batch

    encoded = dataset.map(preprocess, remove_columns=dataset["train"].column_names)
    cer_metric = evaluate.load("cer")
    wer_metric = evaluate.load("wer")

    def compute_metrics(pred: Any) -> dict[str, float]:
        labels_ids = pred.label_ids
        pred_ids = pred.predictions
        pred_str = processor.batch_decode(pred_ids, skip_special_tokens=True)
        labels_ids[labels_ids == -100] = processor.tokenizer.pad_token_id
        label_str = processor.batch_decode(labels_ids, skip_special_tokens=True)
        return {
            "cer": float(cer_metric.compute(predictions=pred_str, references=label_str)),
            "wer": float(wer_metric.compute(predictions=pred_str, references=label_str)),
        }

    training_args = Seq2SeqTrainingArguments(
        output_dir=str(args.output_dir),
        predict_with_generate=True,
        evaluation_strategy="epoch",
        save_strategy="epoch",
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        num_train_epochs=args.epochs,
        logging_steps=25,
        load_best_model_at_end=True,
        metric_for_best_model="cer",
        greater_is_better=False,
        fp16=False,
        report_to=[],
    )

    trainer = Seq2SeqTrainer(
        model=model,
        tokenizer=processor,
        args=training_args,
        train_dataset=encoded["train"],
        eval_dataset=encoded["validation"],
        data_collator=default_data_collator,
        compute_metrics=compute_metrics,
    )
    trainer.train()
    trainer.save_model(str(args.output_dir))
    processor.save_pretrained(str(args.output_dir))
    print(f"Saved TrOCR model to {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
