import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const output = resolve('.test-output');
rmSync(output, { recursive: true, force: true });

function render(file) {
  let source = readFileSync(resolve('tests/fixtures', file), 'utf8')
    .replace('../../_extensions/plotcat/plotcat.lua', 'plotcat');
  if (file !== 'wrong-format.qmd') {
    source = source
      .replace('format: html', 'format:\n  html:\n    fig-format: svg')
      .replace('format: gfm', 'format:\n  gfm:\n    fig-format: svg');
  }
  writeFileSync(resolve(output, file), source);
  const windows = process.platform === 'win32';
  return spawnSync(windows ? process.env.ComSpec : 'quarto', windows ? ['/d', '/s', '/c', `quarto render ${file}`] : ['render', file], {
    encoding: 'utf8',
    cwd: output
  });
}

try {
  mkdirSync(output, { recursive: true });
  cpSync(resolve('_extensions'), resolve(output, '_extensions'), { recursive: true });
  const valid = render('minimal.qmd');
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  const html = readFileSync(resolve(output, 'minimal.html'), 'utf8');
  assert.match(html, /class="plotcat plotcat--side-by-side"/);
  assert.match(html, /data-plotcat-target=""><!--\?xml[\s\S]*?<svg/);
  assert.doesNotMatch(html, /plot\(cars\)/);
  assert.match(html, /type="module"/);

  const generated = render('missing-id.qmd');
  assert.equal(generated.status, 0, generated.stdout + generated.stderr);
  const generatedHtml = readFileSync(resolve(output, 'missing-id.html'), 'utf8');
  assert.match(generatedHtml, /id="plotcat-exercise-1"/);

  const two = render('two-chunks.qmd');
  assert.equal(two.status, 0, two.stdout + two.stderr);
  const twoHtml = readFileSync(resolve(output, 'two-chunks.html'), 'utf8');
  assert.match(twoHtml, /id="plotcat-two-r"/);
  assert.match(twoHtml, /<textarea[^>]*>plot\(cars\)<\/textarea>/);
  assert.doesNotMatch(twoHtml, /main = "Target title"/);

  const multiple = render('multiple.qmd');
  assert.equal(multiple.status, 0, multiple.stdout + multiple.stderr);
  const multipleHtml = readFileSync(resolve(output, 'multiple.html'), 'utf8');
  assert.equal((multipleHtml.match(/class="plotcat plotcat--side-by-side"/g) || []).length, 2);
  assert.equal((multipleHtml.match(/plotcat\.js" type="module"/g) || []).length, 1);

  const nonHtml = render('non-html.qmd');
  assert.equal(nonHtml.status, 0, nonHtml.stdout + nonHtml.stderr);
  const markdown = readFileSync(resolve(output, 'non-html.md'), 'utf8');
  assert.match(markdown, /interactive PlotCat exercise is available in HTML/);
  assert.match(markdown, /!\[\]\(non-html_files\/figure-[^)]+\.svg\)/);
  assert.doesNotMatch(markdown, /plot\(cars\)/);

  for (const [fixture, message] of [
    ['zero-chunks.qmd', 'needs one target chunk'],
    ['too-many.qmd', 'more than two executable chunks'],
    ['mixed.qmd', 'mixes engines'],
    ['invalid-attribute.qmd', "attribute 'title' is not supported"],
    ['executed-starter.qmd', 'starter chunk executed'],
    ['duplicate-id.qmd', "duplicate id 'same'"],
    ['unsupported-engine.qmd', "unsupported engine 'bash'"],
    ['no-svg.qmd', 'target chunk did not produce an SVG plot'],
    ['wrong-format.qmd', 'target rendered as PNG; set format.html.fig-format: svg']
  ]) {
    const result = render(fixture);
    assert.notEqual(result.status, 0, `${fixture} unexpectedly rendered`);
    assert.match(result.stdout + result.stderr, new RegExp(message));
  }
} finally {
  rmSync(output, { recursive: true, force: true });
}
