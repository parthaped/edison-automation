# Amarel VL benchmark (2× NVIDIA L40)

GPU transcription for Qwen3-VL-30B-A3B and Gemma-4-26B-A4B-it at full bf16. All artifacts live on scratch. Text comparison runs on the **login node** (no GPU).

## Scratch layout

```
/scratch/$USER/edison-automation/
  repo/                          # git clone
  models/qwen3-vl-30b-a3b/      # Qwen weights
  models/gemma-4-26b-a4b-it/    # Gemma weights
  hf-cache/                      # Hugging Face cache
  repo/ml/data/sources-with-transcript/  # benchmark corpus (from git)
  runs/$SLURM_JOB_ID/            # GPU outputs
  logs/                          # SLURM stdout/stderr
  .venv-vl-bench/                # GPU Python venv
  .venv-compare/                 # login-node venv (no torch)
```

## One-time setup

```bash
export SCRATCH=/scratch/$USER/edison-automation
mkdir -p "$SCRATCH"
git clone <repo-url> "$SCRATCH/repo"
cd "$SCRATCH/repo"

python -m venv "$SCRATCH/.venv-vl-bench"
source "$SCRATCH/.venv-vl-bench/bin/activate"
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install -r ml/requirements-vl-benchmark.txt
huggingface-cli login   # accept Gemma license on huggingface.co

python -m venv "$SCRATCH/.venv-compare"
source "$SCRATCH/.venv-compare/bin/activate"
pip install -r ml/requirements-compare.txt
```

## Benchmark corpus (in git)

Paired page images and reference transcripts live in the repo at:

```
ml/data/sources-with-transcript/
```

After `git clone` or `git pull` on Amarel, the SLURM job reads that path automatically
(`EDISON_DATA_DIR=$SCRATCH/repo/ml/data/sources-with-transcript`). No separate rsync from
Windows is required.

## Verify L40 nodes

```bash
sinfo -Nel -p gpu
sinfo -o "%25N %50f %G"
```

Update `#SBATCH --constraint=...` in `ml/slurm/benchmark_vl_models.sbatch` if the L40 feature string differs (e.g. `l40`, `L40S`).

## Step 1: GPU transcribe

```bash
cd /scratch/$USER/edison-automation/repo
sbatch ml/slurm/benchmark_vl_models.sbatch
squeue -u $USER
# note JOB_ID
```

The GPU job writes:

- `/scratch/$USER/edison-automation/runs/$JOB_ID/generations.jsonl`
- Raw `.txt` per page under `runs/$JOB_ID/<document>/<model>/page-N.raw.txt`
- SLURM logs under `/scratch/$USER/edison-automation/logs/`

## Step 2: Login-node compare (after GPU job finishes)

```bash
export EDISON_SCRATCH_ROOT=/scratch/$USER/edison-automation
source $EDISON_SCRATCH_ROOT/.venv-compare/bin/activate
cd $EDISON_SCRATCH_ROOT/repo

python ml/scripts/compare_run_results.py \
  --run-dir $EDISON_SCRATCH_ROOT/runs/<JOB_ID> \
  --data-dir $EDISON_SCRATCH_ROOT/repo/ml/data/sources-with-transcript \
  --log-file $EDISON_SCRATCH_ROOT/runs/<JOB_ID>/compare.log \
  --slurm-log $EDISON_SCRATCH_ROOT/logs/edison-vl-bench-<JOB_ID>.out
```

Outputs on scratch:

- `compare_results.jsonl` — generation metrics + accuracy
- `compare_summary.json` — per-model averages
- `compare.log` — human-readable scores
- `page-N.formatted.txt` and `page-N.compare.json` per page

## Manual smoke test (single page)

```bash
source /scratch/$USER/edison-automation/.venv-vl-bench/bin/activate
cd /scratch/$USER/edison-automation/repo
export EDISON_SCRATCH_ROOT=/scratch/$USER/edison-automation
export EDISON_RUN_DIR=$EDISON_SCRATCH_ROOT/runs/manual-smoke

python ml/scripts/benchmark_documents.py --models qwen --limit 1 --skip-download
```

## Hardware notes

- **2× L40 / L40S (48 GB each)** required at full bf16
- Models run **sequentially** (Qwen pass, then Gemma pass), each sharded across both GPUs via `device_map=auto`
- No quantization
