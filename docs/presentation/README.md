# Edison Automation - 5-minute Beamer deck

Self-contained LaTeX Beamer slides for the Edison Automation project. Designed
for a single presenter, ~5 minutes total (6 slides).

## Compile

```bash
pdflatex edison-presentation.tex
```

Run it once. If the deck is ever extended with a TOC or cross-references, run
`pdflatex` twice in a row.

## Theme

The deck prefers the `metropolis` theme and falls back to the default `Madrid`
theme if `metropolis` is not installed, so a stock TeX Live / MiKTeX install is
enough to compile.

## Slides

1. Title.
2. **Who I am** (with photo placeholder -- see below).
3. The Thomas A. Edison Papers (two site images).
4. Overall goal.
5. Architecture (`architecture-diagram.png`).
6. One-week MVP pipeline (`pipeline-flow.png`).

## Adding a photo of the presenter

The "Who I am" slide renders a grey placeholder by default. To use a real
photo, drop one of these files into [`images/`](images/):

- `images/partha.jpg` (preferred), or
- `images/partha.png`

The deck picks it up automatically via `\IfFileExists` -- no LaTeX edits
needed.

## Images

All visual assets live in [`images/`](images/):

- `site-edison.png` -- stylized snippet of `edison.rutgers.edu`.
- `site-edisondigital.png` -- stylized snippet of `edisondigital.rutgers.edu`.
- `architecture-diagram.png` -- platform architecture overview.
- `pipeline-flow.png` -- 5-step "page image to searchable research platform"
  pipeline.

### Optional: regenerate a live screenshot of `edison.rutgers.edu`

The Beamer deck now uses the curated `site-edison.png` snippet rather than a
live screenshot. If you ever want a fresh live capture (e.g. for documentation
elsewhere), the helper script is still available:

```bash
npx playwright install chromium
node scripts/capture-edison-home.mjs
```
