const unsafeUrl = /^\s*(?:https?:|data:|javascript:|\/\/)/i;
const round = value => String(Math.round(Number(value) * 1000) / 1000);

export function sanitizeSvg(source) {
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('The runtime did not return valid SVG.');
  doc.querySelectorAll('script, foreignObject, metadata').forEach(node => node.remove());
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  const comments = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach(node => node.remove());

  doc.querySelectorAll('*').forEach(node => {
    [...node.attributes].forEach(attribute => {
      const isLink = attribute.name === 'href' || attribute.name.endsWith(':href');
      const externalReference = (isLink && unsafeUrl.test(attribute.value)) ||
        /url\(\s*['"]?(?:https?:|data:|javascript:|\/\/)/i.test(attribute.value);
      if (/^on/i.test(attribute.name) || externalReference) node.removeAttribute(attribute.name);
    });
  });
  return new XMLSerializer().serializeToString(doc.documentElement);
}

export function normalizeSvg(source) {
  const doc = new DOMParser().parseFromString(sanitizeSvg(source), 'image/svg+xml');
  const ids = new Map();
  let index = 0;
  doc.querySelectorAll('[id]').forEach(node => {
    const old = node.id;
    const id = `id${index++}`;
    ids.set(old, id);
    node.id = id;
  });
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
  const svg = normalizeSvg(source);
  const tags = ['path','circle','rect','line','polygon','polyline','text','clipPath'];
  const geometryAttributes = ['d','cx','cy','r','x','y','width','height','x1','y1','x2','y2','points','transform'];
  const marks = [...svg.querySelectorAll('path,circle,rect,line,polygon,polyline')];
  const texts = [...svg.querySelectorAll('text')].map(node => ({
    value: node.textContent.replace(/\s+/g, ' ').trim(),
    position: ['x','y','dx','dy','transform'].map(name => node.getAttribute(name) || '').join('|')
  })).filter(item => item.value);
  return {
    viewBox: svg.getAttribute('viewBox') || '',
    dimensions: [svg.getAttribute('width') || '', svg.getAttribute('height') || ''],
    counts: Object.fromEntries(tags.map(tag => [tag, svg.querySelectorAll(tag).length])),
    geometry: marks.map(node => `${node.localName}|${geometryAttributes.map(name => node.getAttribute(name) || '').join('|')}`).sort(),
    text: texts.map(item => item.value),
    textPlacement: texts.map(item => `${item.value}|${item.position}`).sort(),
    styles: marks.map(node => ['fill','stroke','opacity','fill-opacity','stroke-opacity','stroke-width'].map(name => node.getAttribute(name) || '').join('|')).sort()
  };
}

function countSimilarity(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let difference = 0;
  let total = 0;
  for (const key of keys) {
    difference += Math.abs((a[key] || 0) - (b[key] || 0));
    total += Math.max(a[key] || 0, b[key] || 0);
  }
  return total ? 1 - difference / total : 1;
}

function setOverlap(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  const union = new Set([...left, ...right]);
  return union.size ? [...left].filter(value => right.has(value)).length / union.size : 1;
}

export function compareSvg(target, student) {
  const a = extractFeatures(target), b = extractFeatures(student);
  const geometry = countSimilarity(a.counts, b.counts) * .5 + setOverlap(a.geometry, b.geometry) * .5;
  const text = setOverlap(a.text, b.text) * .7 + setOverlap(a.textPlacement, b.textPlacement) * .3;
  const style = setOverlap(a.styles, b.styles);
  const frame = (a.viewBox === b.viewBox ? .7 : 0) + (a.dimensions.join('|') === b.dimensions.join('|') ? .3 : 0);
  const score = Math.round((geometry * .45 + text * .25 + style * .2 + frame * .1) * 1e6) / 1e6;
  const feedback = [];
  return { score, categories: { geometry, text, style, frame }, feedback };
}
