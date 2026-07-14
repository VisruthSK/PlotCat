const unsafeUrl = /^\s*(?:https?:|data:|javascript:|\/\/)/i;
const round = value => String(Math.round(Number(value) * 1000) / 1000);

export function sanitizeSvg(source) {
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('The runtime did not return valid SVG.');
  doc.querySelectorAll('script, foreignObject, metadata').forEach(node => node.remove());
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT); const comments = [];
  while (walker.nextNode()) comments.push(walker.currentNode); comments.forEach(node => node.remove());
  doc.querySelectorAll('*').forEach(node => [...node.attributes].forEach(attr => {
    const externalReference = ((attr.name === 'href' || attr.name.endsWith(':href')) && unsafeUrl.test(attr.value)) || /url\(\s*['"]?(?:https?:|data:|javascript:|\/\/)/i.test(attr.value);
    if (/^on/i.test(attr.name) || externalReference) node.removeAttribute(attr.name);
  }));
  return new XMLSerializer().serializeToString(doc.documentElement);
}

export function normalizeSvg(source) {
  const doc = new DOMParser().parseFromString(sanitizeSvg(source), 'image/svg+xml');
  const ids = new Map(); let index = 0;
  doc.querySelectorAll('[id]').forEach(node => { const old = node.id; const id = `id${index++}`; ids.set(old, id); node.id = id; });
  doc.querySelectorAll('*').forEach(node => {
    [...node.attributes].forEach(attr => {
      let value = attr.value.replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${ids.get(id) || id})`);
      value = value.replace(/-?\d*\.\d+(?:e[-+]?\d+)?/gi, round).replace(/\s+/g, ' ').trim();
      if (attr.name === 'style') value = value.split(';').filter(Boolean).map(x => x.trim()).sort().join(';');
      attr.value = value;
    });
  });
  return doc.documentElement;
}

export function extractFeatures(source) {
  const svg = normalizeSvg(source); const tags = ['path','circle','rect','line','polygon','polyline','text'];
  return { viewBox: svg.getAttribute('viewBox') || '', dimensions: [svg.getAttribute('width') || '', svg.getAttribute('height') || ''], counts: Object.fromEntries(tags.map(t => [t, svg.querySelectorAll(t).length])), text: [...svg.querySelectorAll('text')].map(n => n.textContent.trim()).filter(Boolean), styles: [...svg.querySelectorAll('[fill],[stroke]')].map(n => `${n.getAttribute('fill') || ''}|${n.getAttribute('stroke') || ''}`).sort() };
}

const similarity = (a, b) => { const keys = new Set([...Object.keys(a), ...Object.keys(b)]); let delta = 0, total = 0; keys.forEach(k => { delta += Math.abs((a[k] || 0) - (b[k] || 0)); total += Math.max(a[k] || 0, b[k] || 0); }); return total ? 1 - delta / total : 1; };
const overlap = (a, b) => { const x = new Set(a), y = new Set(b); const union = new Set([...x, ...y]); return union.size ? [...x].filter(v => y.has(v)).length / union.size : 1; };
export function compareSvg(target, student) {
  const a = extractFeatures(target), b = extractFeatures(student);
  const geometry = similarity(a.counts, b.counts), text = overlap(a.text, b.text), style = overlap(a.styles, b.styles), frame = a.viewBox === b.viewBox ? 1 : .5;
  const score = geometry * .45 + text * .25 + style * .2 + frame * .1;
  const feedback = [geometry > .8 ? 'Marks and geometry are close.' : 'Check the marks and geometry.', text > .8 ? 'Text matches well.' : 'Check labels and titles.', style > .8 ? 'Styles are close.' : 'Check fills and strokes.'];
  return { score, categories: { geometry, text, style, frame }, feedback };
}
