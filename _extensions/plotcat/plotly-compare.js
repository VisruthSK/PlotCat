import { resolveTitle } from './utils.js';

const TEXT_KEYS = new Set([
  'text',
  'title',
  'hovertext',
  'hovertemplate',
  'texttemplate',
  'name'
]);

export function normalizeFigure(value) {
  let fig = value ?? {};
  if (typeof value === 'string') {
    try {
      fig = JSON.parse(value);
    } catch {
      fig = {};
    }
  }
  return {
    data: fig.data ?? [],
    layout: fig.layout ?? {},
    frames: fig.frames ?? [],
    config: fig.config ?? {}
  };
}

function isPlainObject(val) {
  return typeof val === 'object' && val !== null && !Array.isArray(val) && !ArrayBuffer.isView(val);
}

function normalizeText(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/<strong>/g, '<b>')
    .replace(/<\/strong>/g, '</b>')
    .replace(/<em>/g, '<i>')
    .replace(/<\/em>/g, '</i>')
    .replace(/<br\s*\/?>/g, '<br>');
}

function normalize(value, key = '') {
  if (value === null || value === undefined) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    value = Array.from(value);
  }
  if (Array.isArray(value)) {
    return value.map(item => normalize(item, key));
  }
  if (isPlainObject(value)) {
    const res = {};
    for (const k of Object.keys(value)) {
      if (k === 'uid' || k.startsWith('_')) {
        continue;
      }
      res[k] = normalize(value[k], k);
    }
    return res;
  }
  if (typeof value === 'string' && TEXT_KEYS.has(key)) {
    return normalizeText(value);
  }
  return value;
}

export function countLeaves(val) {
  if (val === null || val === undefined) {
    return 1;
  }
  if (Array.isArray(val)) {
    return val.reduce((sum, item) => sum + countLeaves(item), 0);
  }
  if (isPlainObject(val)) {
    let sum = 0;
    for (const k of Object.keys(val)) {
      if (k === 'uid' || k.startsWith('_')) continue;
      sum += countLeaves(val[k]);
    }
    return sum;
  }
  return 1;
}

function closeNumber(a, b) {
  if (Object.is(a, b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
}

function formatPath(path) {
  return path.reduce((acc, seg) => {
    if (typeof seg === 'number') {
      return `${acc}[${seg}]`;
    }
    return acc ? `${acc}.${seg}` : String(seg);
  }, '');
}

function recordMismatch(state, path, expected, actual, kind, count = 1) {
  state.mismatchCount += count;
  if (state.differences.length < 10) {
    state.differences.push({
      path: formatPath(path),
      expected,
      actual,
      kind
    });
  }
}

function compareValue(expected, actual, path, state) {
  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) {
      const leaves = countLeaves(expected);
      const kind = actual === undefined ? 'missing' : 'type';
      recordMismatch(state, path, expected, actual, kind, leaves);
      return;
    }
    for (const key of Object.keys(expected)) {
      if (!Object.hasOwn(actual, key)) {
        const expVal = expected[key];
        const leaves = countLeaves(expVal);
        recordMismatch(state, [...path, key], expVal, undefined, 'missing', leaves);
      } else {
        compareValue(expected[key], actual[key], [...path, key], state);
      }
    }
    return;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      const leaves = countLeaves(expected);
      const kind = actual === undefined ? 'missing' : 'type';
      recordMismatch(state, path, expected, actual, kind, leaves);
      return;
    }
    const eLen = expected.length;
    const aLen = actual.length;
    const minLen = Math.min(eLen, aLen);
    for (let i = 0; i < minLen; i++) {
      compareValue(expected[i], actual[i], [...path, i], state);
    }
    if (aLen < eLen) {
      for (let i = minLen; i < eLen; i++) {
        const expItem = expected[i];
        const leaves = countLeaves(expItem);
        recordMismatch(state, [...path, i], expItem, undefined, 'missing', leaves);
      }
    } else if (aLen > eLen) {
      for (let i = eLen; i < aLen; i++) {
        recordMismatch(state, [...path, i], undefined, actual[i], 'extra', 1);
      }
    }
    return;
  }

  // Primitive or null
  if (actual === undefined) {
    recordMismatch(state, path, expected, actual, 'missing', 1);
    return;
  }

  if (expected === null) {
    if (actual !== null) {
      const kind = typeof actual !== typeof expected ? 'type' : 'value';
      recordMismatch(state, path, expected, actual, kind, 1);
    }
    return;
  }

  if (typeof expected === 'number') {
    if (typeof actual !== 'number') {
      recordMismatch(state, path, expected, actual, 'type', 1);
    } else if (!closeNumber(expected, actual)) {
      recordMismatch(state, path, expected, actual, 'value', 1);
    }
    return;
  }

  if (typeof actual !== typeof expected) {
    recordMismatch(state, path, expected, actual, 'type', 1);
  } else if (expected !== actual) {
    recordMismatch(state, path, expected, actual, 'value', 1);
  }
}

function comparePlotlyWeighted(target, student, weights) {
  const w = {
    trace: weights.trace ?? 0.3,
    data: weights.data ?? 0.4,
    style: weights.style ?? 0.2,
    layout: weights.layout ?? 0.1
  };
  const a = normalizeFigure(target);
  const b = normalizeFigure(student);
  const tTraces = a.data;
  const sTraces = b.data;

  let traceScore = 1;
  if (tTraces.length !== sTraces.length) {
    traceScore = Math.max(0, 1 - Math.abs(tTraces.length - sTraces.length) /
      Math.max(tTraces.length, sTraces.length));
  }

  let dataScore = 1;
  let styleScore = 1;
  const minTraces = Math.min(tTraces.length, sTraces.length);

  if (minTraces > 0) {
    let typeMatches = 0;
    let traceDataSum = 0;
    let traceStyleSum = 0;

    for (let i = 0; i < minTraces; i++) {
      const t = tTraces[i] || {};
      const s = sTraces[i] || {};
      if (t.type === s.type) typeMatches++;

      let dataDiff = 0;
      let dataCount = 0;
      for (const key of ['x', 'y', 'z', 'values', 'labels']) {
        if (t[key] !== undefined || s[key] !== undefined) {
          dataCount++;
          const tArr = Array.isArray(t[key]) ? t[key] : [];
          const sArr = Array.isArray(s[key]) ? s[key] : [];
          if (tArr.length !== sArr.length) {
            dataDiff++;
          } else {
            let itemDiff = 0;
            for (let j = 0; j < tArr.length; j++) {
              if (String(tArr[j]) !== String(sArr[j])) itemDiff++;
            }
            if (itemDiff > 0 && tArr.length > 0) dataDiff += itemDiff / tArr.length;
          }
        }
      }
      traceDataSum += dataCount ? 1 - dataDiff / dataCount : 1;

      let styleDiff = 0;
      let styleCount = 0;
      if (t.mode !== undefined || s.mode !== undefined) {
        styleCount++;
        if (t.mode !== s.mode) styleDiff++;
      }
      const tMarker = t.marker || {};
      const sMarker = s.marker || {};
      for (const prop of ['color', 'size', 'symbol']) {
        if (tMarker[prop] !== undefined || sMarker[prop] !== undefined) {
          styleCount++;
          if (String(tMarker[prop]) !== String(sMarker[prop])) styleDiff++;
        }
      }
      const tLine = t.line || {};
      const sLine = s.line || {};
      for (const prop of ['color', 'width']) {
        if (tLine[prop] !== undefined || sLine[prop] !== undefined) {
          styleCount++;
          if (String(tLine[prop]) !== String(sLine[prop])) styleDiff++;
        }
      }
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

  const tLayout = a.layout;
  const sLayout = b.layout;
  let layoutScore = 1;
  let layoutCount = 0;
  let layoutDiff = 0;
  const tTitle = resolveTitle(tLayout).trim();
  const sTitle = resolveTitle(sLayout).trim();
  if (tTitle || sTitle) {
    layoutCount++;
    if (tTitle !== sTitle) layoutDiff++;
  }
  for (const axis of ['xaxis', 'yaxis']) {
    const tAxisTitle = resolveTitle(tLayout, axis).trim();
    const sAxisTitle = resolveTitle(sLayout, axis).trim();
    if (tAxisTitle || sAxisTitle) {
      layoutCount++;
      if (tAxisTitle !== sAxisTitle) layoutDiff++;
    }
  }
  if (layoutCount > 0) layoutScore = 1 - layoutDiff / layoutCount;

  const score = Math.round((traceScore * w.trace + dataScore * w.data +
    styleScore * w.style + layoutScore * w.layout) * 100) / 100;
  return {
    score: score * 100,
    categories: { trace: traceScore, data: dataScore, style: styleScore, layout: layoutScore },
    differences: []
  };
}

function comparePlotlyExact(target, student) {
  const normTarget = normalize(normalizeFigure(target));
  const normStudent = normalize(normalizeFigure(student));

  const targetLeafCount = countLeaves(normTarget);
  const state = {
    mismatchCount: 0,
    differences: []
  };

  compareValue(normTarget, normStudent, [], state);

  let score;
  if (targetLeafCount === 0) {
    score = state.mismatchCount === 0 ? 100 : 0;
  } else {
    const raw = 100 * (1 - state.mismatchCount / targetLeafCount);
    score = Math.max(0, Math.min(100, Math.round(raw)));
  }

  return {
    score,
    differences: state.differences,
    mismatchCount: state.mismatchCount,
    targetLeafCount
  };
}

export function comparePlotly(target, student, weights) {
  return weights ? comparePlotlyWeighted(target, student, weights) : comparePlotlyExact(target, student);
}
