const TEXT_KEYS = new Set(['text', 'title', 'hovertext', 'hovertemplate', 'texttemplate', 'name']);

const STYLE_KEYS = new Set([
  'color', 'colorscale', 'fill', 'fillcolor', 'hoverlabel', 'insidetextfont', 'line', 'marker',
  'mode', 'opacity', 'outsidetextfont', 'selected', 'textfont', 'unselected'
]);

const MAX_DIFFERENCES = 10;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !ArrayBuffer.isView(value);
}

function isContainer(value) {
  return Array.isArray(value) || isPlainObject(value);
}

function normalizeText(text) {
  return text
    .replace(/<strong>/g, '<b>')
    .replace(/<\/strong>/g, '</b>')
    .replace(/<em>/g, '<i>')
    .replace(/<\/em>/g, '</i>')
    .replace(/<br\s*\/?>/g, '<br>');
}

function normalize(value, key = '') {
  if (value === null || value === undefined) return value;
  if (ArrayBuffer.isView(value)) return Array.from(value);
  if (Array.isArray(value)) return value.map(item => normalize(item, key));
  if (isPlainObject(value)) {
    const result = {};
    for (const name of Object.keys(value)) {
      if (name === 'uid' || name.startsWith('_')) continue;
      result[name] = normalize(value[name], name);
    }
    return result;
  }
  if (typeof value === 'string' && TEXT_KEYS.has(key)) return normalizeText(value);
  return value;
}

function countLeaves(value) {
  if (!isContainer(value)) return 1;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countLeaves(item), 0);
  return Object.keys(value)
    .filter(name => name !== 'uid' && !name.startsWith('_'))
    .reduce((sum, name) => sum + countLeaves(value[name]), 0);
}

function closeNumber(a, b) {
  if (Object.is(a, b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
}

function formatPath(path) {
  return path.reduce((text, segment) => {
    if (typeof segment === 'number') return `${text}[${segment}]`;
    return text ? `${text}.${segment}` : String(segment);
  }, '');
}

function weightedCategory(path) {
  const root = path[0];
  if (root === 'layout' || root === 'frames' || root === 'config') return 'layout';
  if (root !== 'data') return 'data';
  if (path.length === 2 || path[2] === 'type') return 'trace';
  if (path.slice(2).some(segment => STYLE_KEYS.has(segment))) return 'style';
  return 'data';
}

function record(state, path, expected, actual, kind) {
  if (state.differences.length < MAX_DIFFERENCES) {
    state.differences.push({ path: formatPath(path), expected, actual, kind });
  }
}

function mismatch(state, path, expected, actual, kind) {
  const count = countLeaves(kind === 'extra' ? actual : expected);
  const category = state.categories[weightedCategory(path)];
  category.total += count;
  category.mismatches += count;
  record(state, path, expected, actual, kind);
}

function leafKind(expected, actual) {
  if (actual === undefined) return 'missing';
  if (expected === null) return actual === null ? null : 'type';
  if (typeof actual !== typeof expected) return 'type';
  if (typeof expected === 'number') return closeNumber(expected, actual) ? null : 'value';
  return expected === actual ? null : 'value';
}

function compareLeaf(expected, actual, path, state) {
  const category = state.categories[weightedCategory(path)];
  category.total++;
  const kind = leafKind(expected, actual);
  if (kind) {
    category.mismatches++;
    record(state, path, expected, actual, kind);
  }
}

function compareValue(expected, actual, path, state) {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const shared = Math.min(expected.length, actual.length);
    for (let i = 0; i < shared; i++) compareValue(expected[i], actual[i], [...path, i], state);
    for (let i = shared; i < expected.length; i++) mismatch(state, [...path, i], expected[i], undefined, 'missing');
    for (let i = shared; i < actual.length; i++) mismatch(state, [...path, i], undefined, actual[i], 'extra');
  } else if (isPlainObject(expected) && isPlainObject(actual)) {
    for (const key of Object.keys(expected)) {
      if (Object.hasOwn(actual, key)) {
        compareValue(expected[key], actual[key], [...path, key], state);
      } else {
        mismatch(state, [...path, key], expected[key], undefined, 'missing');
      }
    }
  } else if (isContainer(expected)) {
    mismatch(state, path, expected, actual, actual === undefined ? 'missing' : 'type');
  } else {
    compareLeaf(expected, actual, path, state);
  }
}

export function comparePlotly(target, student, weights) {
  const state = {
    categories: {
      trace: { total: 0, mismatches: 0 },
      data: { total: 0, mismatches: 0 },
      style: { total: 0, mismatches: 0 },
      layout: { total: 0, mismatches: 0 }
    },
    differences: []
  };
  compareValue(normalizeFigure(target), normalizeFigure(student), [], state);

  const categories = Object.fromEntries(Object.entries(state.categories).map(([name, { total, mismatches }]) => [
    name,
    total ? Math.max(0, 1 - mismatches / total) : 1
  ]));
  const score = Math.round((categories.trace * weights.trace + categories.data * weights.data +
    categories.style * weights.style + categories.layout * weights.layout) * 100) / 100;
  return {
    score: score * 100,
    categories,
    differences: state.differences,
    mismatchCount: Object.values(state.categories).reduce((sum, category) => sum + category.mismatches, 0),
    targetLeafCount: Object.values(state.categories).reduce((sum, category) => sum + category.total, 0)
  };
}

function normalizeFigure(figure) {
  const normalized = normalize(figure ?? {});
  return {
    data: normalized.data ?? [],
    layout: normalized.layout ?? {},
    frames: normalized.frames ?? [],
    config: normalized.config ?? {}
  };
}
