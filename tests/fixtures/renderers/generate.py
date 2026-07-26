"""Regenerate the renderer SVG fixtures used by browser-check.mjs."""

from io import StringIO
from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns
from plotnine import aes, geom_point, ggplot, labs, theme_minimal
from sklearn.datasets import load_iris

OUTPUT = Path(__file__).parent
mpl.rcParams["svg.hashsalt"] = "plotcat-renderer-fixtures"


def save_svg(figure, filename):
    buffer = StringIO()
    figure.savefig(buffer, format="svg", metadata={"Date": None})
    svg = "\n".join(line.rstrip() for line in buffer.getvalue().splitlines()) + "\n"
    (OUTPUT / filename).write_text(svg, encoding="utf-8")
    plt.close(figure)


# Keep this example identical to the reported matplotlib failure.
iris = load_iris()
data = iris.data
fig, ax = plt.subplots()
ax.scatter(data[:, 0], data[:, 2])
save_svg(fig, "matplotlib-scatter.svg")

# Local data avoids a network dependency in seaborn.load_dataset().
penguins = pd.DataFrame(
    {
        "bill_length_mm": [39.1, 39.5, 40.3, 46.5, 50.0, 51.3, 46.1, 49.8, 48.7],
        "bill_depth_mm": [18.7, 17.4, 18.0, 17.9, 15.3, 14.2, 13.2, 16.8, 14.1],
        "species": ["Adelie"] * 3 + ["Chinstrap"] * 3 + ["Gentoo"] * 3,
    }
)
fig, ax = plt.subplots()
sns.scatterplot(
    data=penguins,
    x="bill_length_mm",
    y="bill_depth_mm",
    hue="species",
    ax=ax,
)
ax.set_title("Penguin bills")
save_svg(fig, "seaborn-scatter.svg")

frame = pd.DataFrame(
    {
        "x": [1, 2, 3, 4],
        "y": [1, 4, 2, 5],
        "group": ["A", "A", "B", "B"],
    }
)
plot = (
    ggplot(frame, aes("x", "y", color="group"))
    + geom_point(size=4)
    + labs(
        title="Plotnine labels",
        x="Horizontal label",
        y="Vertical label",
    )
    + theme_minimal()
)
save_svg(plot.draw(), "plotnine-scatter.svg")
