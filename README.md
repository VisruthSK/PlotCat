

# `PlotCat`

`PlotCat` is a Quarto extension for plot-recreation exercises. Authors
provide a target plot and optional starter code. Students write R or
Python in the browser, render their plot with WebR or Pyodide, and
compare it with the target.

`PlotCat` compares SVG structure and plot text for static plots. It also
supports a focused comparison of Plotly traces and layout. Plotly
exercises support side-by-side comparison only; overlay and wipe apply
to SVG plots. `PlotCa`t obfuscates the target source in the rendered
HTML, which prevents casual inspection but does not protect the source.

## Requirements

`PlotCat` publishes interactive HTML only. Its browser runtimes need
network access on first use and package availability in WebR or Pyodide.
The included examples cover base R, `ggplot2`, `tinyplot`, `lattice`,
`matplotlib`, `plotnine`, `seaborn`, and `Plotly`.

## Installation

Add Quarto Live, then `PlotCat`:

``` bash
quarto add r-wasm/quarto-live
quarto add VisruthSK/PlotCat
```

Then enable the filter in a document or project config:

``` yaml
format:
  live-html:
    webr:
      packages:
        - svglite
        - ggplot2

    pyodide:
      packages:
        - matplotlib

filters:
  - plotcat 
```

R pages using `PlotCat` must declare `svglite`. Authors must declare
every non-base R or Python package used by target or starter code.
`PlotCat` does not infer or install runtime packages. Package
configuration belongs to Quarto Live.

For a single document, Quarto Live also accepts `webr` and `pyodide`
options in document front matter. For project configuration, nesting
them under `live-html` avoids metadata-merging problems.

`live-html` provides the native WebR and Pyodide editors. Set
`#| eval: false` on each `PlotCat` chunk so Quarto leaves it for the
browser runtime.

## Example

Write the target plot as the first chunk inside a `.plotcat` Div. Set
`#| eval: false`: `PlotCat` renders both the target and a student’s
submission in the browser. This must be set on each `PlotCat` chunk
because Quarto decides whether to execute it before `PlotCat`’s filter
runs.

```` markdown
::: {.plotcat}

::: {.cell}

```{.r .cell-code}
tinyplot::tinyplot(
  dist ~ speed,
  data = cars,
  main = "Stopping distance by speed",
  xlab = "Speed",
  ylab = "Stopping distance"
)
```
:::

:::
````

Add a second chunk to give students starter code. Also set
`#| eval: false` on the starter chunk.

```` markdown
::: {.plotcat}

::: {.cell}

```{.r .cell-code}
tinyplot::tinyplot(
  dist ~ speed,
  data = cars,
  main = "Stopping distance by speed",
  xlab = "Speed",
  ylab = "Stopping distance"
)
```
:::



::: {.cell}

```{.r .cell-code}
tinyplot::tinyplot(
  dist ~ speed,
  data = cars
)
```
:::

:::
````

The first chunk becomes the browser-rendered target, and its source is
obfuscated in the rendered HTML. The second chunk appears in the editor.

`PlotCat` accepts R and Python chunks. Both chunks in an exercise must
use the same language.

Use either `{r}` or `{webr}` for R, and either `{python}` or `{pyodide}`
for Python. `PlotCat` turns the student editor into Quarto Live’s native
`webr` or `pyodide` cell.

## Limitations

- **Font and text styling**: SVG comparison checks text content, but
  ignores font families, font sizes, font weights, and text positioning.
- **Coarse geometry matching**: Coordinates are rounded to ~1% relative
  precision and matched as unordered marks. Minor position shifts or
  point jittering may still yield high scores.
- **No code inspection**: `PlotCat` evaluates rendered plot output (SVG
  or Plotly JSON), not R or Python code structure. It cannot check for
  specific function calls or idioms.
- **Plotly support**: Plotly exercises only support side-by-side
  comparison and evaluate a subset of trace data, mark attributes, and
  titles.
- **Runtime sandbox**: WebR and Pyodide run in the browser WebAssembly
  sandbox, so code cannot access files on the local filesystem (e.g.,
  `read.csv("C:/data.csv")`). However, remote data files can be fetched
  directly using standard functions like `read.csv("https://...")` in R
  or `pd.read_csv("https://...")` in Python. Required packages must be
  available in WebAssembly.

## Design Inspiration

`PlotCat` was inspired by [ggplot2
Battles](https://github.com/MikeLydeamore/ggplot2-battles), brought to
my attention by [Emily Robinson](https://www.emilyarobinson.com/).
