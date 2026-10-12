const PLOTLY_URL = 'https://cdn.plot.ly/plotly-3.6.0.min.js';

let plotlyPromise;

export function loadPlotly() {
  if (window.Plotly) return Promise.resolve(window.Plotly);
  plotlyPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PLOTLY_URL;
    script.onload = () => resolve(window.Plotly);
    script.onerror = () => {
      plotlyPromise = undefined;
      reject(new Error(
        'Could not load Plotly from the CDN. Check your internet connection ' +
        'and any network restrictions. Plotly exercises need access to ' +
        `${PLOTLY_URL}.`
      ));
    };
    document.head.appendChild(script);
  });
  return plotlyPromise;
}

export async function renderPlotly(container, figure) {
  const previous = container.querySelector('.js-plotly-plot');
  if (previous && window.Plotly) window.Plotly.purge(previous);
  container.replaceChildren();
  container.style.height = '280px';
  const div = document.createElement('div');
  div.style.cssText = 'width:100%;height:100%;align-self:stretch;flex-grow:1';
  container.appendChild(div);

  const layout = structuredClone(figure.layout || {});
  delete layout.width;
  delete layout.height;
  layout.autosize = true;
  layout.margin = { l: 40, r: 10, t: 30, b: 40, ...layout.margin };

  const config = { ...(figure.config || {}), responsive: true, displayModeBar: false };
  await window.Plotly.newPlot(div, figure.data || [], layout, config);
  if (Array.isArray(figure.frames) && figure.frames.length > 0) {
    await window.Plotly.addFrames(div, figure.frames);
  }
  return div;
}
