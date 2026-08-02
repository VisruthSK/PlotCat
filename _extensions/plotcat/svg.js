import { parseSvgDoc, serializeSvgDoc, resolveTitle } from './utils.js';

const unsafeUrl = /^\s*(?:https?:|data:|javascript:|\/\/)/i;
const round = value => String(Math.round(Number(value) * 1000) / 1000);
const geometryAttributes = ['d','cx','cy','r','x','y','width','height','x1','y1','x2','y2','points','transform'];
const styleAttributes = ['fill','stroke','opacity','fill-opacity','stroke-opacity','stroke-width'];
const tagSelector = 'path,circle,rect,line,polygon,polyline,text,clipPath';
const fragmentUrl = /url\(\s*(['"]?)#([^)'"]+)\1\s*\)/g;

export function rewriteSvgIdReferences(value, ids) {
  return value
    .replace(fragmentUrl, (_, _quote, id) => `url(#${ids.get(id) || id})`)
    .replace(/^#(.+)$/, (_, id) => `#${ids.get(id) || id}`);
}

function rewriteDocIdReferences(doc, ids) {
  doc.querySelectorAll('*').forEach(node => {
    for (const attr of [...node.attributes]) {
      attr.value = rewriteSvgIdReferences(attr.value, ids);
    }
  });
}

function sanitizeDoc(doc) {
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg')
    throw new Error('The runtime did not return valid SVG.');
  doc.querySelectorAll('script, foreignObject, metadata').forEach(node => node.remove());
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  const comments = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach(node => node.remove());
  doc.querySelectorAll('*').forEach(node => {
    for (const attr of [...node.attributes]) {
      const isLink = attr.name === 'href' || attr.name.endsWith(':href');
      if (/^on/i.test(attr.name) || (isLink && unsafeUrl.test(attr.value)) ||
          /url\(\s*['"]?(?:https?:|data:|javascript:|\/\/)/i.test(attr.value)) {
        node.removeAttribute(attr.name);
      }
    }
  });
}

function normalizeDoc(doc) {
  const ids = new Map();
  let index = 0;
  doc.querySelectorAll('[id]').forEach(node => {
    const old = node.id;
    const id = `id${index++}`;
    ids.set(old, id);
    node.id = id;
  });
  rewriteDocIdReferences(doc, ids);
  doc.querySelectorAll('*').forEach(node => {
    for (const attr of [...node.attributes]) {
      let value = attr.value.replace(/-?\d*\.\d+(?:e[-+]?\d+)?/gi, round).replace(/\s+/g, ' ').trim();
      if (attr.name === 'style') value = value.split(';').filter(Boolean).map(x => x.trim()).sort().join(';');
      attr.value = value;
    }
  });
  doc.querySelectorAll('text').forEach(node => {
    const family = node.getAttribute('font-family');
    if (!family || /^sans$|^sans-serif$|^serif$|^monospace$/i.test(family.trim())) {
      node.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
    }
  });
}

function scopeDocIds(doc, prefix) {
  const ids = new Map();
  doc.querySelectorAll('[id]').forEach(node => {
    const original = node.id;
    const scoped = `${prefix}-${original}`;
    ids.set(original, scoped);
    node.id = scoped;
  });
  rewriteDocIdReferences(doc, ids);
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
  normalizeDoc(doc);
  scopeDocIds(doc, prefix);
  return { svg: serializeSvgDoc(doc), features: extractFeaturesFromDoc(doc) };
}

export function sanitizeSvg(source) {
  const doc = parseSvgDoc(source);
  sanitizeDoc(doc);
  return serializeSvgDoc(doc);
}

export function scopeSvgIds(source, prefix) {
  const doc = parseSvgDoc(source);
  scopeDocIds(doc, prefix);
  return serializeSvgDoc(doc);
}

export function normalizeSvg(source) {
  const doc = parseSvgDoc(source);
  normalizeDoc(doc);
  return doc.documentElement;
}

export function extractFeatures(source) {
  return extractFeaturesFromDoc(normalizeSvg(source));
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

function coarseGeometry(features) {
  const scale = features.scale || 100;
  return features.geometry.map(value => value.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, number => {
    const normalized = Math.round((Number(number) / scale) * 1000) / 1000;
    return String(Object.is(normalized, -0) ? 0 : normalized);
  }));
}

function frameSimilarity(aAspect, bAspect, dimA, dimB) {
  if (aAspect === null || bAspect === null) return dimA.join('|') === dimB.join('|') ? 1 : 0;
  return Math.abs(aAspect - bAspect) / Math.max(aAspect, bAspect) <= 0.01 ? 1 : 0;
}

export function compareSvgFeatures(target, student, weights = {}) {
  const w = {
    geometry: weights.geometry ?? 0.6,
    text: weights.text ?? 0.15,
    style: weights.style ?? 0.1,
    frame: weights.frame ?? 0.15,
  };
  const coarse = bagOverlap(coarseGeometry(target), coarseGeometry(student));
  const text = bagOverlap(target.text, student.text);
  const style = bagOverlap(target.styles, student.styles);
  const frame = frameSimilarity(target.aspect, student.aspect, target.dimensions, student.dimensions);
  const rawScore = coarse * w.geometry + text * w.text + style * w.style + frame * w.frame;
  const score = Math.round(rawScore * 1e6) / 1e6;
  return { score, categories: { geometry: coarse, text, style, frame } };
}

export function compareSvg(target, student, weights) {
  return compareSvgFeatures(
    typeof target === 'object' && target !== null && target.counts ? target : extractFeatures(target),
    typeof student === 'object' && student !== null && student.counts ? student : extractFeatures(student),
    weights
  );
}

export { comparePlotly } from './plotly-compare.js';

