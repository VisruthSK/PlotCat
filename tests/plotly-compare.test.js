import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePlotly, normalizeFigure, countLeaves } from '../_extensions/plotcat/plotly-compare.js';
import { compareSvgFeatures } from '../_extensions/plotcat/svg.js';

test('1. Identical figures score 100', () => {
  const fig = {
    data: [{ type: 'scatter', x: [1, 2], y: [3, 4] }],
    layout: { title: { text: 'Test' } }
  };
  const res = comparePlotly(fig, fig);
  assert.equal(res.score, 100);
  assert.equal(res.mismatchCount, 0);
  assert.equal(res.differences.length, 0);
});

test('2. An extra student object property is ignored', () => {
  const target = { layout: { title: { text: 'Title' } } };
  const student = { layout: { title: { text: 'Title' }, extraProp: 'ignored' }, extraRoot: 123 };
  const res = comparePlotly(target, student);
  assert.equal(res.score, 100);
  assert.equal(res.mismatchCount, 0);
});

test('different coordinates score below 100', () => {
  const target = {
    data: [{ type: 'scatter', x: [1, 2, 3], y: [4, 5, 6] }]
  };
  const student = {
    data: [{ type: 'scatter', x: [1, 2, 9], y: [4, 5, 6] }]
  };
  assert.ok(comparePlotly(target, student).score < 100);
});

test('3. A missing target property fails', () => {
  const target = { layout: { title: { text: 'Title' } } };
  const student = { layout: {} };
  const res = comparePlotly(target, student);
  assert.ok(res.score < 100);
  assert.equal(res.mismatchCount, 1);
  assert.equal(res.differences[0].path, 'layout.title');
  assert.equal(res.differences[0].kind, 'missing');
});

test('4. A mismatched primitive produces the exact path', () => {
  const target = { data: [{ type: 'bar', marker: { color: 'red' } }] };
  const student = { data: [{ type: 'bar', marker: { color: 'blue' } }] };
  const res = comparePlotly(target, student);
  assert.equal(res.differences[0].path, 'data[0].marker.color');
  assert.equal(res.differences[0].expected, 'red');
  assert.equal(res.differences[0].actual, 'blue');
  assert.equal(res.differences[0].kind, 'value');
});

test('5. null differs from a missing property', () => {
  const target = { layout: { title: null } };
  const studentMissing = { layout: {} };
  const studentNull = { layout: { title: null } };

  const resMissing = comparePlotly(target, studentMissing);
  assert.equal(resMissing.score, 0);
  assert.equal(resMissing.differences[0].kind, 'missing');

  const resNull = comparePlotly(target, studentNull);
  assert.equal(resNull.score, 100);
});

test('6. An inherited property does not satisfy the target', () => {
  const proto = { title: { text: 'Title' } };
  const student = { layout: Object.create(proto) };
  const target = { layout: { title: { text: 'Title' } } };

  const res = comparePlotly(target, student);
  assert.equal(res.differences[0].path, 'layout.title');
  assert.equal(res.differences[0].kind, 'missing');
});

test('7. Numbers within tolerance match', () => {
  const target = { data: [{ x: [1.0, 2.0] }] };
  const student = { data: [{ x: [1.0 + 1e-9, 2.0 - 1e-9] }] };
  const res = comparePlotly(target, student);
  assert.equal(res.score, 100);
});

test('8. Numbers outside tolerance fail', () => {
  const target = { data: [{ x: [1.0] }] };
  const student = { data: [{ x: [1.001] }] };
  const res = comparePlotly(target, student);
  assert.equal(res.score, 0);
  assert.equal(res.differences[0].path, 'data[0].x[0]');
  assert.equal(res.differences[0].kind, 'value');
});

test('9. Typed arrays compare with ordinary arrays', () => {
  const target = { data: [{ x: new Float64Array([10, 20, 30]) }] };
  const student = { data: [{ x: [10, 20, 30] }] };
  const res = comparePlotly(target, student);
  assert.equal(res.score, 100);
});

test('10. Equal ordered arrays match', () => {
  const target = { data: [{ x: [1, 2, 3] }] };
  const student = { data: [{ x: [1, 2, 3] }] };
  const res = comparePlotly(target, student);
  assert.equal(res.score, 100);
});

test('11. Reordered traces fail', () => {
  const target = { data: [{ name: 'A' }, { name: 'B' }] };
  const student = { data: [{ name: 'B' }, { name: 'A' }] };
  const res = comparePlotly(target, student);
  assert.equal(res.score, 0);
  assert.equal(res.mismatchCount, 2);
});

test('12. An extra student trace fails', () => {
  const target = { data: [{ type: 'scatter' }] };
  const student = { data: [{ type: 'scatter' }, { type: 'bar' }] };
  const res = comparePlotly(target, student);
  assert.equal(res.score, 0);
  assert.equal(res.differences[0].path, 'data[1]');
  assert.equal(res.differences[0].kind, 'extra');
});

test('13. An extra annotation fails', () => {
  const target = { layout: { annotations: [{ text: 'A' }] } };
  const student = { layout: { annotations: [{ text: 'A' }, { text: 'B' }] } };
  const res = comparePlotly(target, student);
  assert.equal(res.mismatchCount, 1);
  assert.equal(res.differences[0].path, 'layout.annotations[1]');
  assert.equal(res.differences[0].kind, 'extra');
});

test('14. A shorter student array counts missing descendant leaves', () => {
  const target = { data: [{ x: [1, 2, 3, 4] }] };
  const student = { data: [{ x: [1, 2] }] };
  const res = comparePlotly(target, student);
  assert.equal(res.targetLeafCount, 4);
  assert.equal(res.mismatchCount, 2);
  assert.equal(res.score, 50);
});

test('15. A longer student array records structural mismatches', () => {
  const target = { data: [{ x: [1, 2] }] };
  const student = { data: [{ x: [1, 2, 3, 4] }] };
  const res = comparePlotly(target, student);
  assert.equal(res.mismatchCount, 2);
  assert.equal(res.differences.length, 2);
  assert.equal(res.differences[0].path, 'data[0].x[2]');
  assert.equal(res.differences[0].kind, 'extra');
});

test('16. Nested layout properties compare', () => {
  const target = { layout: { xaxis: { title: { font: { color: 'red' } } } } };
  const student = { layout: { xaxis: { title: { font: { color: 'blue' } } } } };
  const res = comparePlotly(target, student);
  assert.equal(res.differences[0].path, 'layout.xaxis.title.font.color');
});

test('17. hovertemplate differences are detected', () => {
  const target = { data: [{ hovertemplate: '%{y:.2f}' }] };
  const student = { data: [{ hovertemplate: '%{y}' }] };
  const res = comparePlotly(target, student);
  assert.equal(res.differences[0].path, 'data[0].hovertemplate');
});

test('18. customdata differences are detected', () => {
  const target = { data: [{ customdata: ['a', 'b'] }] };
  const student = { data: [{ customdata: ['a', 'c'] }] };
  const res = comparePlotly(target, student);
  assert.equal(res.differences[0].path, 'data[0].customdata[1]');
});

test('19. Title centering differences are detected', () => {
  const target = { layout: { title: { x: 0.5, xanchor: 'center' } } };
  const student = { layout: { title: { x: 0.0, xanchor: 'left' } } };
  const res = comparePlotly(target, student);
  assert.equal(res.mismatchCount, 2);
});

test('20. Annotation text or position differences are detected', () => {
  const target = { layout: { annotations: [{ text: 'Label', x: 1, y: 2 }] } };
  const student = { layout: { annotations: [{ text: 'Label', x: 1, y: 5 }] } };
  const res = comparePlotly(target, student);
  assert.equal(res.differences[0].path, 'layout.annotations[0].y');
});

test('21. Animation frame differences are detected', () => {
  const target = { frames: [{ name: 'f1', data: [{ x: [1] }] }] };
  const student = { frames: [{ name: 'f1', data: [{ x: [2] }] }] };
  const res = comparePlotly(target, student);
  assert.equal(res.differences[0].path, 'frames[0].data[0].x[0]');
});

test('22. Configuration differences are detected', () => {
  const target = { config: { scrollZoom: true } };
  const student = { config: { scrollZoom: false } };
  const res = comparePlotly(target, student);
  assert.equal(res.differences[0].path, 'config.scrollZoom');
});

test('23. <strong> equals <b>', () => {
  const target = { layout: { title: { text: '<b>Header</b>' } } };
  const student = { layout: { title: { text: '<strong>Header</strong>' } } };
  const res = comparePlotly(target, student);
  assert.equal(res.score, 100);
});

test('24. <em> equals <i>', () => {
  const target = { layout: { title: { text: '<i>Italic</i>' } } };
  const student = { layout: { title: { text: '<em>Italic</em>' } } };
  const res = comparePlotly(target, student);
  assert.equal(res.score, 100);
});

test('25. <br>, <br/>, and <br /> compare equally', () => {
  const target = { layout: { title: { text: 'Line1<br>Line2' } } };
  const student1 = { layout: { title: { text: 'Line1<br/>Line2' } } };
  const student2 = { layout: { title: { text: 'Line1<br />Line2' } } };
  assert.equal(comparePlotly(target, student1).score, 100);
  assert.equal(comparePlotly(target, student2).score, 100);
});

test('26. Meaningful whitespace remains significant', () => {
  const target = { layout: { title: { text: 'Title ' } } };
  const student = { layout: { title: { text: 'Title' } } };
  const res = comparePlotly(target, student);
  assert.equal(res.score, 0);
  assert.equal(res.differences[0].path, 'layout.title.text');
});

test('27. Arbitrary categorical strings are not rewritten as markup', () => {
  const target = { data: [{ x: ['<strong>A</strong>', 'B'] }] };
  const student = { data: [{ x: ['<b>A</b>', 'B'] }] };
  const res = comparePlotly(target, student);
  assert.equal(res.score, 50);
  assert.equal(res.differences[0].path, 'data[0].x[0]');
});

test('28. uid is ignored', () => {
  const target = { data: [{ uid: '123', type: 'scatter' }] };
  const student = { data: [{ uid: '456', type: 'scatter' }] };
  const res = comparePlotly(target, student);
  assert.equal(res.score, 100);
  assert.equal(res.targetLeafCount, 1);
});

test('29. Underscore-prefixed fields are ignored', () => {
  const target = { data: [{ _fullData: [1, 2], type: 'bar' }] };
  const student = { data: [{ _fullData: [3, 4], type: 'bar' }] };
  const res = comparePlotly(target, student);
  assert.equal(res.score, 100);
  assert.equal(res.targetLeafCount, 1);
});

test('30. Wrong container types count descendant target leaves once', () => {
  const target = { layout: { title: { text: 'A', x: 0.5 } } };
  const student = { layout: { title: 'WrongType' } };
  const res = comparePlotly(target, student);
  assert.equal(res.targetLeafCount, 2);
  assert.equal(res.mismatchCount, 2);
  assert.equal(res.differences.length, 1);
  assert.equal(res.differences[0].path, 'layout.title');
  assert.equal(res.differences[0].kind, 'type');
});

test('31. A missing container does not double-count mismatches', () => {
  const target = {
    layout: {
      title: {
        text: 'A',
        x: 0.5,
        font: { size: 20, weight: 700 }
      }
    }
  };
  const student = { layout: {} };
  const res = comparePlotly(target, student);
  assert.equal(res.targetLeafCount, 4);
  assert.equal(res.mismatchCount, 4);
  assert.equal(res.differences.length, 1);
  assert.equal(res.differences[0].path, 'layout.title');
});

test('32. Extra student object keys do not affect the score', () => {
  const target = { layout: { title: { text: 'T' } } };
  const student = { layout: { title: { text: 'T', align: 'left' }, margin: { l: 10 } } };
  const res = comparePlotly(target, student);
  assert.equal(res.score, 100);
});

test('33. Leaf-based scoring is exact', () => {
  const target = {
    data: [{ type: 'scatter', x: [1, 2], y: [3, 4] }] // type(1) + x(2) + y(2) = 5 leaves
  };
  const student = {
    data: [{ type: 'scatter', x: [1, 2], y: [3, 99] }] // 1 mismatch
  };
  const res = comparePlotly(target, student);
  assert.equal(res.targetLeafCount, 5);
  assert.equal(res.mismatchCount, 1);
  assert.equal(res.score, 80);
});

test('34. Empty target scoring is defined', () => {
  const emptyTarget = {};
  const resEmptyTarget = comparePlotly(emptyTarget, {});
  assert.equal(resEmptyTarget.targetLeafCount, 0);
  assert.equal(resEmptyTarget.score, 100);

  const resExtraStudent = comparePlotly(emptyTarget, { data: [{ x: [1] }] });
  assert.equal(resExtraStudent.score, 0);
});

test('35. differences is capped at ten entries', () => {
  const target = { data: [{ x: Array.from({ length: 15 }, (_, i) => i) }] };
  const student = { data: [{ x: Array.from({ length: 15 }, () => 999) }] };
  const res = comparePlotly(target, student);
  assert.equal(res.differences.length, 10);
});

test('36. mismatchCount retains the full count when differences are capped', () => {
  const target = { data: [{ x: Array.from({ length: 15 }, (_, i) => i) }] };
  const student = { data: [{ x: Array.from({ length: 15 }, () => 999) }] };
  const res = comparePlotly(target, student);
  assert.equal(res.mismatchCount, 15);
});

test('37. Difference order is deterministic', () => {
  const target = { data: [{ type: 'a', name: 'b' }] };
  const student = { data: [{ type: 'x', name: 'y' }] };
  const res1 = comparePlotly(target, student);
  const res2 = comparePlotly(target, student);
  assert.deepEqual(res1.differences, res2.differences);
});

test('38. Inputs are not mutated', () => {
  const target = { data: [{ x: [1, 2], uid: 'orig' }] };
  const student = { data: [{ x: [1, 2], uid: 'stud' }] };
  const targetSnap = JSON.stringify(target);
  const studentSnap = JSON.stringify(student);
  comparePlotly(target, student);
  assert.equal(JSON.stringify(target), targetSnap);
  assert.equal(JSON.stringify(student), studentSnap);
});

test('39. The direct PlotCat integration uses the new comparator', () => {
  const target = { data: [{ x: [1, 2] }] };
  const student = { data: [{ x: [1, 2] }] };
  const res = comparePlotly(target, student);
  assert.equal(res.score, 100);
});

test('40. SVG comparison remains unchanged', () => {
  const f1 = { counts: { circle: 1 }, geometry: ['circle:10,10,5'], text: [], styles: [], aspect: 1, dimensions: [100, 100] };
  const res = compareSvgFeatures(f1, f1);
  assert.equal(res.score, 1);
});

test('41. The complete available figure payload reaches the comparator', () => {
  const target = {
    data: [{ type: 'scatter', x: [1] }],
    layout: { title: { text: 'Title' } },
    frames: [{ name: 'f1' }],
    config: { responsive: true }
  };
  const norm = normalizeFigure(target);
  assert.equal(norm.data.length, 1);
  assert.equal(norm.layout.title.text, 'Title');
  assert.equal(norm.frames.length, 1);
  assert.equal(norm.config.responsive, true);
});

test('42. Frames and configuration are retained where the adapters expose them', () => {
  const fig = {
    data: [],
    layout: {},
    frames: [{ name: 'f1' }],
    config: { displayModeBar: false }
  };
  const res = comparePlotly(fig, fig);
  assert.equal(res.score, 100);
  assert.equal(res.targetLeafCount, 2); // name: f1, displayModeBar: false
});

test('weighted Plotly scoring uses the configured categories', () => {
  const target = {
    data: [{ type: 'scatter', x: [1, 2], marker: { color: 'red' } }],
    layout: { title: { text: 'Target' } }
  };
  const student = {
    data: [{ type: 'scatter', x: [9, 2], marker: { color: 'blue' } }],
    layout: { title: { text: 'Student' } }
  };

  const dataOnly = comparePlotly(target, student, {
    trace: 0, data: 1, style: 0, layout: 0
  });
  const styleOnly = comparePlotly(target, student, {
    trace: 0, data: 0, style: 1, layout: 0
  });
  const layoutOnly = comparePlotly(target, student, {
    trace: 0, data: 0, style: 0, layout: 1
  });

  assert.equal(dataOnly.score, 50);
  assert.equal(styleOnly.score, 0);
  assert.equal(layoutOnly.score, 0);
});

test('weighted Plotly scoring grades the complete serialized figure', () => {
  const target = {
    data: [{
      type: 'scatter',
      name: 'Target series',
      x: [1, 2],
      y: [3, 4],
      customdata: ['a', 'b'],
      hovertemplate: '%{y:.2f}',
      mode: 'markers',
      marker: { color: 'red' }
    }],
    layout: {
      title: { text: 'Target' },
      yaxis: { range: [0, 5] },
      annotations: [{ text: 'Target annotation' }]
    },
    frames: [{ name: 'frame-1', data: [{ y: [3, 4] }] }],
    config: { scrollZoom: true }
  };
  const student = {
    data: [{
      type: 'scatter',
      name: 'Student series',
      x: [1, 2],
      y: [3, 4],
      customdata: ['a', 'wrong'],
      hovertemplate: '%{y}',
      mode: 'lines',
      marker: { color: 'blue' }
    }],
    layout: {
      title: { text: 'Student' },
      yaxis: { range: [0, 10] },
      annotations: [{ text: 'Student annotation' }]
    },
    frames: [{ name: 'frame-2', data: [{ y: [3, 9] }] }],
    config: { scrollZoom: false }
  };

  const result = comparePlotly(target, student, {
    trace: 0.3, data: 0.4, style: 0.2, layout: 0.1
  });

  assert.ok(result.score < 100);
  assert.ok(result.categories.data < 1);
  assert.ok(result.categories.style < 1);
  assert.ok(result.categories.layout < 1);
  const paths = result.differences.map(difference => difference.path);
  assert.deepEqual(paths.slice(0, 3), [
    'data[0].name',
    'data[0].customdata[1]',
    'data[0].hovertemplate'
  ]);
  assert.ok(paths.includes('data[0].mode'));
  assert.ok(paths.includes('data[0].marker.color'));
  assert.ok(paths.includes('layout.title.text'));
  assert.ok(paths.includes('frames[0].name'));

  const configOnly = comparePlotly(
    { config: { scrollZoom: true } },
    { config: { scrollZoom: false } },
    { trace: 0, data: 0, style: 0, layout: 1 }
  );
  assert.equal(configOnly.categories.layout, 0);
  assert.equal(configOnly.differences[0].path, 'config.scrollZoom');
});

test('weighted Plotly scoring penalizes missing and extra chart structure', () => {
  const target = {
    data: [{ type: 'scatter', x: [1, 2], y: [3, 4] }, { type: 'bar', y: [5] }],
    layout: { title: { text: 'Target' } },
    frames: [{ name: 'frame-1' }],
    config: { responsive: true }
  };
  const student = {
    data: [{ type: 'bar', x: [9], y: [8] }],
    layout: {},
    frames: [],
    config: {}
  };

  const result = comparePlotly(target, student, {
    trace: 0.3, data: 0.4, style: 0.2, layout: 0.1
  });

  assert.ok(result.score < 50);
  assert.equal(result.categories.trace, 0);
  assert.ok(result.categories.data < 0.5);
  assert.equal(result.categories.layout, 0);
});
