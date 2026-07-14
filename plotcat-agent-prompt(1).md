# PlotCat Project Prompt

Build a clean Quarto website with a minimal Quarto extension named `plotcat`.

PlotCat turns executable Quarto plotting chunks into SVG copy exercises. An author wraps one target chunk, and optionally one starter chunk, in a `.plotcat` div. During `quarto render`, PlotCat captures the target plot as SVG and replaces the div with an interactive widget. In the browser, students edit code, run it through WebR or Pyodide, produce SVG, and compare their result with the target.

Keep the project small, polished, theme-aware, and native to Quarto.

Use strict red-green-refactor TDD. Write a failing test first. Make the smallest change that passes. Refactor with tests green.

## Author syntax

Only `id` is allowed on the `.plotcat` div.

Do not support `title=` on the div. Plot titles belong in plotting code.

Do not support `starter=` on the div. Starter code belongs in an optional second executable chunk.

### One chunk: target only

````qmd
::: {.plotcat id="penguins-ggplot"}
```{r}
library(ggplot2)
library(palmerpenguins)

ggplot(penguins, aes(bill_length_mm, flipper_length_mm, colour = species)) +
  geom_point(alpha = 0.7) +
  labs(
    title = "Penguin bills and flippers",
    x = "Bill length (mm)",
    y = "Flipper length (mm)",
    colour = "Species"
  ) +
  theme_minimal()
```
:::
````

With one chunk, the editor starts empty.

### Two chunks: target plus starter

````qmd
::: {.plotcat id="penguins-ggplot"}
```{r}
library(ggplot2)
library(palmerpenguins)

ggplot(penguins, aes(bill_length_mm, flipper_length_mm, colour = species)) +
  geom_point(alpha = 0.7) +
  labs(
    title = "Penguin bills and flippers",
    x = "Bill length (mm)",
    y = "Flipper length (mm)",
    colour = "Species"
  ) +
  theme_minimal()
```

```{r}
library(ggplot2)
library(palmerpenguins)

ggplot(penguins, aes()) +
  geom_point()
```
:::
````

Rules:

- one chunk is valid
- two chunks are valid
- zero chunks is invalid
- more than two chunks is invalid
- mixed engines are invalid
- the first chunk is the hidden target answer
- the optional second chunk is starter text only
- the starter chunk must not execute during render
- the target chunk must execute during render
- the rendered HTML must not contain the target source code

## Website

Build a Quarto website with exactly two pages:

- `index.qmd`: home page with installation, syntax, and a short description
- `examples.qmd`: all rendered examples on one page

Do not create separate example pages.

Do not create separate fixture pages.

Test fixtures belong under `tests/fixtures`, not in the website navigation.

The examples page must contain rendered PlotCat examples for:

- R tinyplot
- R ggplot2
- Python matplotlib
- Python plotnine

The examples page should show the rendered widgets. Keep surrounding prose short.

## Required examples

### R tinyplot

````qmd
::: {.plotcat id="cars-tinyplot"}
```{r}
tinyplot::tinyplot(
  dist ~ speed,
  data = cars,
  main = "Stopping distance by speed",
  xlab = "Speed",
  ylab = "Stopping distance"
)
```

```{r}
tinyplot::tinyplot(
  dist ~ speed,
  data = cars
)
```
:::
````

### R ggplot2

````qmd
::: {.plotcat id="penguins-ggplot"}
```{r}
library(ggplot2)
library(palmerpenguins)

ggplot(penguins, aes(bill_length_mm, flipper_length_mm, colour = species)) +
  geom_point(alpha = 0.7) +
  labs(
    title = "Penguin bills and flippers",
    x = "Bill length (mm)",
    y = "Flipper length (mm)",
    colour = "Species"
  ) +
  theme_minimal()
```

```{r}
library(ggplot2)
library(palmerpenguins)

ggplot(penguins, aes()) +
  geom_point()
```
:::
````

### Python matplotlib

````qmd
::: {.plotcat id="iris-matplotlib"}
```{python}
import matplotlib.pyplot as plt
from sklearn.datasets import load_iris

iris = load_iris(as_frame=True)
df = iris.frame

fig, ax = plt.subplots()
ax.scatter(df["sepal length (cm)"], df["petal length (cm)"])
ax.set_title("Iris sepal and petal length")
ax.set_xlabel("Sepal length (cm)")
ax.set_ylabel("Petal length (cm)")
```

```{python}
import matplotlib.pyplot as plt
from sklearn.datasets import load_iris

iris = load_iris(as_frame=True)
df = iris.frame

fig, ax = plt.subplots()
ax.scatter(df["sepal length (cm)"], df["petal length (cm)"])
```
:::
````

### Python plotnine

````qmd
::: {.plotcat id="mtcars-plotnine"}
```{python}
from plotnine import ggplot, aes, geom_point, labs, theme_minimal
from plotnine.data import mtcars

(
  ggplot(mtcars, aes("wt", "mpg", color="factor(cyl)"))
  + geom_point(size=3)
  + labs(
      title="Fuel economy by weight",
      x="Weight",
      y="Miles per gallon",
      color="Cylinders"
    )
  + theme_minimal()
)
```

```{python}
from plotnine import ggplot, aes, geom_point
from plotnine.data import mtcars

ggplot(mtcars, aes("wt", "mpg")) + geom_point()
```
:::
````

R and Python must run interactively in the browser.

Use WebR for R.

Use Pyodide for Python.

## HTML output

For HTML, replace each `.plotcat` div with a widget containing:

- target SVG
- student SVG region
- source editor
- run button
- status region
- score region
- category feedback
- side-by-side mode
- overlay mode
- wipe slider
- target/student toggle

For non-HTML output, emit a static fallback with the target plot and a short note that the interactive PlotCat widget is available in HTML.

## SVG rule

Use SVG for target plots, student plots, display, overlay, wipe, and comparison.

Do not use PNG.

Do not use canvas.

Do not use Resemble.js.

Do not create image data URLs.

Do not rasterize as a fallback.

Compare normalized SVG structure, not raw SVG strings.

Pipeline:

```text
target SVG
student SVG
sanitize both
normalize both
extract generic SVG features
compare feature similarity
show score and feedback
```

Sanitize:

- remove `script`
- remove `foreignObject`
- remove event handler attributes
- remove external references
- remove comments
- remove unsafe metadata

Normalize:

- generated IDs
- `url(#id)` references
- numeric precision
- whitespace
- style declaration ordering
- attribute ordering where practical

Compare generic SVG features:

- viewBox
- dimensions
- primitive counts
- paths
- circles
- rects
- lines
- polygons
- text content
- approximate text placement
- fill
- stroke
- opacity
- stroke width
- clipping regions
- axis-like text and tick structures
- legend-like structures
- panel-like rectangles

Do not rely on ggplot-specific group names, Matplotlib-generated IDs, exact group order, exact whitespace, or raw SVG equality.

## Runtime adapters

Use one lazy runtime manager per page.

Do not load a language runtime until the student clicks Run for an exercise using that engine.

Adapters expose this interface:

```ts
interface PlotCatRuntimeAdapter {
  init(manifest: PlotCatManifest): Promise<void>;
  renderSvg(code: string, options: PlotCatRenderOptions): Promise<string>;
}
```

The UI and SVG comparison code must not know whether the SVG came from R or Python.

### R adapter

Use WebR.

Support R plots that can be captured as SVG. Support the tinyplot and ggplot2 examples.

The adapter must:

- load declared packages
- run student code in an isolated environment
- capture SVG output
- return an SVG string
- show clean errors for parse errors, package errors, runtime errors, and no-plot errors

### Python adapter

Use Pyodide.

Support the matplotlib and plotnine examples.

The adapter must:

- load declared packages
- run student code in an isolated namespace
- capture SVG output
- return an SVG string
- show clean errors for import errors, runtime errors, and no-plot errors

## UI

Use native HTML controls first.

Use a plain textarea editor for the first version.

Do not add React, Vue, Tailwind, Monaco, CodeMirror, or a bundled UI framework.

The widget must inherit from Quarto themes and also expose stable classes for custom styling.

Use low-specificity CSS.

Use CSS custom properties.

Inherit Quarto theme variables for:

- text
- background
- border
- accent
- code font
- body font
- muted text
- focus states

Expose these classes:

```text
.plotcat
.plotcat__header
.plotcat__body
.plotcat__target
.plotcat__student
.plotcat__plot
.plotcat__editor
.plotcat__textarea
.plotcat__actions
.plotcat__button
.plotcat__status
.plotcat__score
.plotcat__feedback
.plotcat__compare
.plotcat__controls
.plotcat__slider
.plotcat--running
.plotcat--error
.plotcat--complete
.plotcat--side-by-side
.plotcat--overlay
.plotcat--wipe
```

Class names are styling hooks. Do not require custom CSS for the default design to work.

The widget should be quiet, precise, responsive, and readable in light and dark themes.

Avoid noisy game styling, bright custom palettes, oversized controls, large animations, and layout shifts.

## Accessibility

Implement:

- keyboard-accessible controls
- visible focus states
- semantic buttons
- labels for editor and controls
- `aria-live` status region
- keyboard-operable wipe slider
- color-independent feedback
- reduced-motion compatibility

## Privacy

Everything runs locally in the browser.

Do not transmit:

- student code
- student SVGs
- scores
- logs
- identifiers
- document metadata

Do not add telemetry.

Do not expose target source code.

## Red-green-refactor TDD

Use strict red-green-refactor TDD.

For each behavior:

1. Write a failing test.
2. Implement the smallest change that passes.
3. Refactor with tests green.

Do not implement behavior without a failing test.

Do not add abstractions until tests force them.

Do not add dependencies until tests prove they are needed.

## Quarto transform tests

Test:

- detects `.plotcat`
- accepts one executable chunk
- accepts two executable chunks
- rejects zero chunks
- rejects more than two chunks
- rejects mixed-engine chunks
- infers `r`
- infers `python`
- rejects unsupported engines
- rejects unsupported div attributes except `id`
- preserves ordinary non-PlotCat chunks
- prevents starter chunk execution
- executes target chunk for SVG capture
- emits HTML widget shell
- emits non-HTML fallback
- embeds target SVG
- embeds starter code when a second chunk exists
- uses empty starter when only one chunk exists
- does not embed target source code
- includes assets once per page
- produces deterministic PlotCat DOM IDs
- reports useful author-time errors

## Snapshot tests

Create thorough snapshot tests for rendered output.

Snapshot:

- minimal one-chunk R exercise
- two-chunk R tinyplot exercise
- two-chunk R ggplot2 exercise
- two-chunk Python matplotlib exercise
- two-chunk Python plotnine exercise
- multiple exercises on one page
- unsupported engine error
- mixed-engine error
- too-many-chunks error
- zero-chunk error
- invalid div attribute error
- non-HTML fallback
- light theme fixture
- dark theme fixture
- accessibility fixture
- deterministic minimal SVG fixture
- output with no starter chunk
- output with starter chunk
- rendered `index.qmd`
- rendered `examples.qmd`

Normalize snapshots to remove volatile paths, timestamps, generated IDs, and dependency-specific noise.

Prefer focused snapshots over giant page dumps, but cover the full rendered contract.

## SVG unit tests

Test:

- sanitizer removes unsafe nodes
- sanitizer removes event attributes
- sanitizer removes external references
- sanitizer removes comments
- ID canonicalization preserves internal `url(#id)` references
- numeric values round consistently
- styles normalize consistently
- equivalent SVGs normalize to equivalent features
- different SVGs score lower
- text mismatches affect text feedback
- geometry mismatches affect geometry feedback
- color mismatches affect style feedback
- primitive count mismatches affect mark feedback
- comparison never calls canvas APIs
- comparison never creates PNG data URLs
- comparison never rasterizes

## Runtime manager tests

Use mocks.

Test:

- no runtime loads on page load
- R exercise loads WebR only
- Python exercise loads Pyodide only
- runtimes are reused
- concurrent runs are queued safely
- adapter errors appear in the widget
- UI returns to a usable state after errors

## Browser integration tests

Use Playwright or an equivalent browser runner.

Test:

- website loads
- examples page contains all required rendered examples
- target SVGs are visible
- starter code appears only in the editor
- target source code is absent from page source
- valid R code renders inline SVG
- valid Python code renders inline SVG
- invalid R code shows a useful error
- invalid Python code shows a useful error
- side-by-side mode works
- overlay mode works with inline SVG
- wipe mode clips inline SVG
- wipe slider works by keyboard
- target/student toggle works
- dark theme remains readable
- custom class hooks are present
- no student-data transmission exists
- no PNG comparison exists
- no canvas comparison exists

## Build order

Follow this order.

1. Write transform tests for valid and invalid `.plotcat` divs.
2. Implement the smallest Lua filter that passes those tests.
3. Add snapshot tests for placeholder widgets.
4. Add second-chunk starter parsing tests.
5. Implement optional second chunk as starter source.
6. Add tests proving starter chunks do not execute.
7. Add target SVG capture tests.
8. Implement render-time target SVG capture.
9. Add tests proving target source is absent from HTML.
10. Implement safe widget payload serialization.
11. Add SVG sanitizer tests.
12. Implement sanitizer.
13. Add SVG normalizer tests.
14. Implement normalizer.
15. Add SVG feature comparison tests.
16. Implement scoring and feedback.
17. Add UI mode tests.
18. Implement side-by-side, overlay, wipe, and toggle modes.
19. Add runtime manager mock tests.
20. Implement lazy runtime manager.
21. Add WebR adapter tests.
22. Implement R adapter.
23. Add Pyodide adapter tests.
24. Implement Python adapter.
25. Build the two-page Quarto website.
26. Add browser integration tests.
27. Refactor for simplicity.
28. Verify no forbidden dependency or forbidden comparison path exists.

## MVP acceptance

The MVP is complete when:

- the project is a clean two-page Quarto website using the `plotcat` extension
- `.plotcat` accepts one target chunk
- `.plotcat` accepts an optional second starter chunk
- only `id` is allowed on the `.plotcat` div
- target titles are defined in plotting code
- target SVG is generated at render time
- target source code is absent from rendered HTML
- starter source appears only in the editor
- all examples live on `examples.qmd`
- R tinyplot example works
- R ggplot2 example works
- Python matplotlib example works
- Python plotnine example works
- WebR is used for R
- Pyodide is used for Python
- student output renders as inline SVG
- SVG-only comparison produces score and category feedback
- side-by-side mode works
- overlay mode works
- wipe mode works
- theme inheritance works in light and dark modes
- custom class hooks exist for user styling
- accessibility tests pass
- transform tests pass
- snapshot tests are thorough and stable
- SVG tests pass
- runtime manager tests pass
- browser integration tests pass
- no PNG comparison exists
- no canvas comparison exists
- no telemetry exists
- no student-data transmission exists

Keep the implementation minimal. Make the small version excellent.
