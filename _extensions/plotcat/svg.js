const unsafeUrl = /^\s*(?:https?:|data:|javascript:|\/\/)/i;
const unsafeUrlFunction = /url\(\s*['"]?(?:https?:|data:|javascript:|\/\/)/i;
const numberPattern = /-?\d*\.\d+(?:e[-+]?\d+)?/gi;
const whitespaceRun = /\s+/g;
const round = value => String(Math.round(Number(value) * 1000) / 1000);
const geometryAttributes = ['d','cx','cy','r','x','y','width','height','x1','y1','x2','y2','points','transform'];
const styleAttributes = ['fill','stroke','opacity','fill-opacity','stroke-opacity','stroke-width'];
const tagSelector = 'path,circle,rect,line,polygon,polyline,text,clipPath';
const fragmentUrl = /url\(\s*(['"]?)#([^)'"]+)\1\s*\)/g;
const genericFontFamily = /^sans$|^sans-serif$|^serif$|^monospace$/i;

function parseSvgDoc(source) {
  return new DOMParser().parseFromString(source, 'image/svg+xml');
}

function serializeSvgElement(element) {
  return new XMLSerializer().serializeToString(element);
}

export function rewriteSvgIdReferences(value, ids) {
  return value
    .replace(fragmentUrl, (_, _quote, id) => `url(#${ids.get(id) || id})`)
    .replace(/^#(.+)$/, (_, id) => `#${ids.get(id) || id}`);
}

function sanitizeDoc(doc) {
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg')
    throw new Error('The runtime did not return valid SVG.');
  doc.querySelectorAll('script, foreignObject, metadata').forEach(node => node.remove());
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  const comments = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach(node => node.remove());
}

function unsafeAttribute({ name, value }) {
  const isLink = name === 'href' || name.endsWith(':href');
  return /^on/i.test(name) || (isLink && unsafeUrl.test(value)) || unsafeUrlFunction.test(value);
}

function scopeIds(doc, prefix) {
  const ids = new Map();
  let index = 0;
  doc.querySelectorAll('[id]').forEach(node => {
    const scoped = `${prefix}-id${index++}`;
    ids.set(node.id, scoped);
    node.id = scoped;
  });
  return ids;
}

function normalizeValue(value, name, ids) {
  if (value.includes('#')) value = rewriteSvgIdReferences(value, ids);
  if (value.includes('.')) value = value.replace(numberPattern, round);
  if (/\s/.test(value)) value = value.replace(whitespaceRun, ' ').trim();
  if (name === 'style') value = value.split(';').filter(Boolean).map(x => x.trim()).sort().join(';');
  return value;
}

function normalizeDoc(doc, ids) {
  doc.querySelectorAll('*').forEach(node => {
    for (let i = node.attributes.length - 1; i >= 0; i--) {
      const attr = node.attributes[i];
      if (unsafeAttribute(attr)) {
        node.removeAttribute(attr.name);
        continue;
      }
      const value = normalizeValue(attr.value, attr.name, ids);
      if (value !== attr.value) attr.value = value;
    }
  });
  doc.querySelectorAll('text').forEach(node => {
    const family = node.getAttribute('font-family');
    if (!family || genericFontFamily.test(family.trim())) {
      node.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
    }
  });
}

function extractFeaturesFromDoc(doc) {
  const root = doc.documentElement || doc;
  const all = [...root.querySelectorAll(tagSelector)];
  const counts = {};
  const geometry = [];
  const styles = [];
  const texts = [];
  for (const el of all) {
    counts[el.localName] = (counts[el.localName] || 0) + 1;
    if (el.localName === 'text') {
      const value = el.textContent.replace(/\s+/g, ' ').trim();
      if (value) texts.push(value);
    } else if (el.localName !== 'clipPath') {
      geometry.push(el.localName + '|' + geometryAttributes.map(name => el.getAttribute(name) || '').join('|'));
      styles.push(styleAttributes.map(name => el.getAttribute(name) || '').join('|'));
    }
  }
  geometry.sort();
  styles.sort();

  const viewBoxStr = root.getAttribute('viewBox') || '';
  const vbValues = viewBoxStr ? viewBoxStr.split(/\s+/).map(Number) : [];
  const aspect = vbValues.length === 4 && vbValues[3] > 0 ? vbValues[2] / vbValues[3] : null;
  const scale = vbValues.length === 4 && Math.max(vbValues[2], vbValues[3]) > 0 ? Math.max(vbValues[2], vbValues[3]) : 100;

  return {
    viewBox: viewBoxStr,
    dimensions: [root.getAttribute('width') || '', root.getAttribute('height') || ''],
    aspect,
    scale,
    counts,
    geometry,
    text: texts,
    styles
  };
}

export function prepareSvg(source, prefix) {
  const doc = parseSvgDoc(source);
  sanitizeDoc(doc);
  const ids = scopeIds(doc, prefix);
  normalizeDoc(doc, ids);
  const element = doc.documentElement;
  return {
    element,
    get svg() { return serializeSvgElement(element); },
    features: extractFeaturesFromDoc(doc)
  };
}

export function displaySvg(container, source, prefix) {
  const prepared = prepareSvg(source, prefix);
  container.replaceChildren(document.adoptNode(prepared.element));
  return prepared.features;
}

function bagOverlap(a, b) {
  const counts = values => values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map());
  const left = counts(a), right = counts(b);
  const keys = new Set([...left.keys(), ...right.keys()]);
  let shared = 0, total = 0;
  for (const key of keys) {
    shared += Math.min(left.get(key) || 0, right.get(key) || 0);
    total += Math.max(left.get(key) || 0, right.get(key) || 0);
  }
  return total ? shared / total : 1;
}

const coarseCache = new WeakMap();

function coarseGeometry(features) {
  if (coarseCache.has(features)) return coarseCache.get(features);
  const scale = features.scale || 100;
  const coarse = features.geometry.map(value => value.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, number => {
    const normalized = Math.round((Number(number) / scale) * 1000) / 1000;
    return String(Object.is(normalized, -0) ? 0 : normalized);
  }));
  coarseCache.set(features, coarse);
  return coarse;
}

function frameSimilarity(aAspect, bAspect, dimA, dimB) {
  if (aAspect === null || bAspect === null) return dimA.join('|') === dimB.join('|') ? 1 : 0;
  return Math.abs(aAspect - bAspect) / Math.max(aAspect, bAspect) <= 0.01 ? 1 : 0;
}

export function compareSvgFeatures(target, student, weights) {
  const coarse = bagOverlap(coarseGeometry(target), coarseGeometry(student));
  const text = bagOverlap(target.text, student.text);
  const style = bagOverlap(target.styles, student.styles);
  const frame = frameSimilarity(target.aspect, student.aspect, target.dimensions, student.dimensions);
  const rawScore = coarse * weights.geometry + text * weights.text + style * weights.style + frame * weights.frame;
  return Math.round(rawScore * 1e6) / 1e6;
}
