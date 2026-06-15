#!/bin/bash
#SBATCH --job-name=edison-vl-bench
#SBATCH --partition=gpu
#SBATCH --gres=gpu:2
#SBATCH --cpus-per-task=16
#SBATCH --mem=128G
#SBATCH --time=08:00:00
#SBATCH --output=/scratch/%u/edison-automation/logs/%x-%j.out
#SBATCH --error=/scratch/%u/edison-automation/logs/%x-%j.err
#SBATCH --constraint=l40s

set -euo pipefail

export EDISON_SCRATCH_ROOT="/scratch/${USER}/edison-automation"
export HF_HOME="${EDISON_SCRATCH_ROOT}/hf-cache"
export TRANSFORMERS_CACHE="${HF_HOME}"
export EDISON_MODEL_ROOT="${EDISON_SCRATCH_ROOT}/models"
export EDISON_DATA_DIR="${EDISON_SCRATCH_ROOT}/data/sources-with-transcript"
export EDISON_RUN_DIR="${EDISON_SCRATCH_ROOT}/runs/${SLURM_JOB_ID}"

mkdir -p "${EDISON_RUN_DIR}" "${EDISON_SCRATCH_ROOT}/logs" "${HF_HOME}"

echo "=== Edison VL benchmark (GPU transcribe only) ==="
echo "EDISON_SCRATCH_ROOT=${EDISON_SCRATCH_ROOT}"
echo "EDISON_RUN_DIR=${EDISON_RUN_DIR}"

module load cuda || true

source "${EDISON_SCRATCH_ROOT}/.venv-vl-bench/bin/activate"
cd "${EDISON_SCRATCH_ROOT}/repo"

echo "=== GPU pre-flight ==="
nvidia-smi

python ml/scripts/download_qwen_vl.py
python ml/scripts/download_gemma_vl.py

python ml/scripts/benchmark_documents.py \
  --transcribe-only \
  --data-dir "${EDISON_DATA_DIR}" \
  --run-dir "${EDISON_RUN_DIR}"

echo "=== GPU job complete ==="
echo "Run compare on login node:"
echo "  python ml/scripts/compare_run_results.py --run-dir ${EDISON_RUN_DIR} --data-dir ${EDISON_DATA_DIR}"
