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

export function scopeSvgIds(source, prefix) {
  const doc = typeof source === 'string' ? new DOMParser().parseFromString(source, 'image/svg+xml') : source;
  const ids = new Map();
  doc.querySelectorAll('[id]').forEach(node => {
    const original = node.id;
    const scoped = `${prefix}-${original}`;
    ids.set(original, scoped);
    node.id = scoped;
  });
  doc.querySelectorAll('*').forEach(node => {
    [...node.attributes].forEach(attribute => {
      attribute.value = attribute.value
        .replace(/url\(#([^)]+)\)/g, (match, id) => `url(#${ids.get(id) || id})`)
        .replace(/^#(.+)$/, (match, id) => `#${ids.get(id) || id}`);
    });
  });
  return new XMLSerializer().serializeToString(doc.documentElement);
}

export function normalizeSvg(source) {
  const doc = typeof source === 'string' ? new DOMParser().parseFromString(source, 'image/svg+xml') : source;
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
    value: node.textContent.replace(/\s+/g, ' ').trim()
  })).filter(item => item.value);
  return {
    viewBox: svg.getAttribute('viewBox') || '',
    dimensions: [svg.getAttribute('width') || '', svg.getAttribute('height') || ''],
    counts: Object.fromEntries(tags.map(tag => [tag, svg.querySelectorAll(tag).length])),
    geometry: marks.map(node => `${node.localName}|${geometryAttributes.map(name => node.getAttribute(name) || '').join('|')}`).sort(),
    text: texts.map(item => item.value),
    styles: marks.map(node => ['fill','stroke','opacity','fill-opacity','stroke-opacity','stroke-width'].map(name => node.getAttribute(name) || '').join('|')).sort()
  };
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
  const viewBox = features.viewBox.split(/\s+/).map(Number);
  const scale = viewBox.length === 4 && Math.max(viewBox[2], viewBox[3]) > 0 ? Math.max(viewBox[2], viewBox[3]) : 100;
  return features.geometry.map(value => value.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, number => {
    const normalized = Math.round((Number(number) / scale) * 1000) / 1000;
    return String(Object.is(normalized, -0) ? 0 : normalized);
  }));
}

function frameSimilarity(a, b) {
  const aspect = features => {
    const values = features.viewBox.split(/\s+/).map(Number);
    return values.length === 4 && values[3] > 0 ? values[2] / values[3] : null;
  };
  const left = aspect(a), right = aspect(b);
  if (left === null || right === null) return a.dimensions.join('|') === b.dimensions.join('|') ? 1 : 0;
  return Math.abs(left - right) / Math.max(left, right) <= 0.01 ? 1 : 0;
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
  const frame = frameSimilarity(target, student);
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

export function comparePlotly(target, student, weights = {}) {
  const w = {
    trace: weights.trace ?? 0.3,
    data: weights.data ?? 0.4,
    style: weights.style ?? 0.2,
    layout: weights.layout ?? 0.1,
  };
  const a = typeof target === 'string' ? JSON.parse(target) : target;
  const b = typeof student === 'string' ? JSON.parse(student) : student;

  const tTraces = a.data || [];
  const sTraces = b.data || [];

  let traceScore = 1.0;
  if (tTraces.length !== sTraces.length) {
    traceScore = Math.max(0, 1 - Math.abs(tTraces.length - sTraces.length) / Math.max(tTraces.length, sTraces.length));
  }

  let dataScore = 1.0;
  let styleScore = 1.0;
  const minTraces = Math.min(tTraces.length, sTraces.length);

  if (minTraces > 0) {
    let typeMatches = 0;
    let traceDataSum = 0;
    let traceStyleSum = 0;
    for (let i = 0; i < minTraces; i++) {
      const t = tTraces[i];
      const s = sTraces[i];

      if (t.type === s.type) {
        typeMatches++;
      }

      let dataDiff = 0;
      let dataCount = 0;
      ['x', 'y', 'z', 'values', 'labels'].forEach(key => {
        if (t[key] || s[key]) {
          dataCount++;
          const tArr = Array.isArray(t[key]) ? t[key] : [];
          const sArr = Array.isArray(s[key]) ? s[key] : [];
          if (tArr.length !== sArr.length) {
            dataDiff += 1.0;
          } else {
            let itemDiff = 0;
            for (let j = 0; j < tArr.length; j++) {
              if (String(tArr[j]) !== String(sArr[j])) {
                itemDiff++;
              }
            }
            if (itemDiff > 0) {
              dataDiff += tArr.length ? itemDiff / tArr.length : 0;
            }
          }
        }
      });
      traceDataSum += dataCount ? 1 - dataDiff / dataCount : 1;

      let styleDiff = 0;
      let styleCount = 0;
      if (t.mode || s.mode) {
        styleCount++;
        if (t.mode !== s.mode) {
          styleDiff++;
        }
      }
      const tMarker = t.marker || {};
      const sMarker = s.marker || {};
      ['color', 'size', 'symbol'].forEach(prop => {
        if (tMarker[prop] || sMarker[prop]) {
          styleCount++;
          if (String(tMarker[prop]) !== String(sMarker[prop])) {
            styleDiff++;
          }
        }
      });
      const tLine = t.line || {};
      const sLine = s.line || {};
      ['color', 'width'].forEach(prop => {
        if (tLine[prop] || sLine[prop]) {
          styleCount++;
          if (String(tLine[prop]) !== String(sLine[prop])) {
            styleDiff++;
          }
        }
      });
      traceStyleSum += styleCount ? 1 - styleDiff / styleCount : 1;
    }

    traceScore = traceScore * 0.4 + (typeMatches / minTraces) * 0.6;
    dataScore = traceDataSum / minTraces;
    styleScore = traceStyleSum / minTraces;
  } else {
    traceScore = 0;
    dataScore = 0;
    styleScore = 0;
  }

  const tLayout = a.layout || {};
  const sLayout = b.layout || {};
  let layoutScore = 1.0;
  let layoutCount = 0;
  let layoutDiff = 0;

  const getTitleText = l => {
    if (!l.title) return '';
    return typeof l.title === 'string' ? l.title : (l.title.text || '');
  };
  const tTitle = getTitleText(tLayout).trim();
  const sTitle = getTitleText(sLayout).trim();
  if (tTitle || sTitle) {
    layoutCount++;
    if (tTitle !== sTitle) {
      layoutDiff++;
    }
  }

  ['xaxis', 'yaxis'].forEach(axis => {
    const getAxisTitle = l => {
      const ax = l[axis] || {};
      if (!ax.title) return '';
      return typeof ax.title === 'string' ? ax.title : (ax.title.text || '');
    };
    const tAxisTitle = getAxisTitle(tLayout).trim();
    const sAxisTitle = getAxisTitle(sLayout).trim();
    if (tAxisTitle || sAxisTitle) {
      layoutCount++;
      if (tAxisTitle !== sAxisTitle) {
        layoutDiff++;
      }
    }
  });

  if (layoutCount > 0) {
    layoutScore = 1 - layoutDiff / layoutCount;
  }

  const rawScore = traceScore * w.trace + dataScore * w.data + styleScore * w.style + layoutScore * w.layout;
  const score = Math.round(rawScore * 100) / 100;

  return {
    score,
    categories: { traceScore, dataScore, styleScore, layoutScore }
  };
}

