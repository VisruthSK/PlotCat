

# PlotCat

`plotcat` is a Quarto extension for plot recreation exercises. Authors
provide a target plot and optional starter code. Students write R or
Python in the browser, render a plot with WebR or Pyodide, and compare
it with the target.

Both the target plot and the student plot are rendered dynamically
inside the user’s browser, eliminating system-specific font metric
differences and ensuring highly accurate visual matching. The target
code is automatically encrypted/obfuscated during rendering to prevent
students from cheating by inspecting the HTML source code.

## Supported Packages & Frameworks

PlotCat supports all major visualization libraries in both R and Python:

- **R (via WebR)**:
  - `ggplot2`
  - `tinyplot`
  - Base R `graphics` (e.g., `plot()`, `points()`, `hist()`)
  - `lattice` (trellis graphics)
  - `plotly` (including `ggplotly()` conversions)
- **Python (via Pyodide)**:
  - `matplotlib`
  - `seaborn`
  - `plotnine` (ggplot2 port for Python)
  - `pandas` plotting APIs
  - `plotly` (graph objects and plotly express)

## How It Works

- **SVG Comparison**: Static plots (ggplot2, tinyplot, matplotlib,
  seaborn, etc.) are compiled to SVG strings and compared using a
  visual/pixel-based similarity scoring engine.
- **Plotly Widget Comparison**: Plotly charts in both R and Python are
  compared directly as **structured widget objects**. This allows
  PlotCat to verify trace types, coordinate arrays, styling (marker
  size/colors, line styles), and interactive layout variables (such as
  margins, legends, hovermodes, and axis titles).

## Installation

Add the extension to a Quarto project:

``` bash
quarto add VisruthSK/PlotCat
```

Then enable the filter in a document or project config:

``` yaml
filters:
  - plotcat
```

## Example

Write the target plot as the first chunk inside a `.plotcat` Div. Set
`#| eval: false` on it so Quarto does not execute it during compile time
(all execution happens client-side).

```` markdown
::: {.plotcat}
```{r}
#| eval: false
tinyplot::tinyplot(
  dist ~ speed,
  data = cars,
  main = "Stopping distance by speed",
  xlab = "Speed",
  ylab = "Stopping distance"
)
```
:::
````

Add a second chunk to give students starter code. Also set
`#| eval: false` on the starter chunk.

```` markdown
::: {.plotcat}
```{r}
#| eval: false
tinyplot::tinyplot(
  dist ~ speed,
  data = cars,
  main = "Stopping distance by speed",
  xlab = "Speed",
  ylab = "Stopping distance"
)
```

```{r}
#| eval: false
tinyplot::tinyplot(
  dist ~ speed,
  data = cars
)
```
:::
````

The first chunk is obfuscated during `quarto render` and compiles in the
browser as the target. Its source code is omitted from the rendered
HTML. The second chunk appears in the editor.

PlotCat accepts R and Python chunks. Both chunks in an exercise must use
the same language.

## Design Inspiration

PlotCat was inspired by [ggplot2
Battles](https://github.com/MikeLydeamore/ggplot2-battles).
