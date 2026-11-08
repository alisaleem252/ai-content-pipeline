import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPipeline, gate, estimateUnits } from '../src/pipeline.js';
import { saveRun, reportMarkdown } from '../src/report.js';

const article = { title: 'Hello World', slug: 'hello-world', body_html: '<p>x</p>', body_markdown: 'x', word_count: 1200, quality: { score: 92 }, faq: [], sources: [] };
const gapRes = { target_words: 2000, missing: ['a'], outline: { sections: ['One', { heading: 'Two' }, 'Three'] } };
const fc = (score, contradicted = 0) => ({ summary: { score, supported: 3, partly: 0, contradicted, unverified: 0, checked: 3 }, claims: [] });
const orig = (score) => ({ score, checked: 8, matched: 1, matches: [] });

function fakeClient({ facts = [90], origs = [95] } = {}) {
  const calls = [];
  let a = 0;
  return {
    calls,
    async seo(tool, body) {
      calls.push([tool, body]);
      if (tool === 'competitor-gap') return gapRes;
      if (tool === 'fact-check') return fc(facts[Math.min(a - 1, facts.length - 1)]);
      if (tool === 'originality') return orig(origs[Math.min(a - 1, origs.length - 1)]);
    },
    async article(params) { a++; calls.push(['article', params]); return article; },
  };
}

test('chains gap into the article request', async () => {
  const c = fakeClient();
  const r = await runPipeline(c, 'topic', {});
  assert.equal(r.status, 'passed');
  assert.deepEqual(c.calls.map((x) => x[0]), ['competitor-gap', 'article', 'fact-check', 'originality']);
  const art = c.calls[1][1];
  assert.deepEqual(art.outline_hint, ['One', 'Two', 'Three']);
  assert.equal(art.word_count, 2000);
  assert.equal(r.units, 20);
});

test('explicit word count wins over the gap target; checks get the article html', async () => {
  const c = fakeClient();
  await runPipeline(c, 't', { article: { word_count: 900 } });
  assert.equal(c.calls[1][1].word_count, 900);
  assert.deepEqual(c.calls[2][1], { html: '<p>x</p>' });
});

test('gate fails on low scores and contradicted claims', () => {
  const o = { minFact: 70, minOriginality: 80 };
  assert.deepEqual(gate({ factCheck: fc(90), originality: orig(90) }, o), []);
  assert.equal(gate({ factCheck: fc(60), originality: orig(90) }, o).length, 1);
  assert.equal(gate({ factCheck: fc(90, 1), originality: orig(70) }, o).length, 2);
  assert.deepEqual(gate({ factCheck: fc(90, 1), originality: orig(90) }, { ...o, allowContradicted: true }), []);
});

test('retries regenerate until the gate passes', async () => {
  const c = fakeClient({ facts: [50, 85], origs: [90, 90] });
  const r = await runPipeline(c, 't', { retries: 2 });
  assert.equal(r.status, 'passed');
  assert.equal(r.attempts, 2);
  assert.equal(c.calls.filter((x) => x[0] === 'article').length, 2);
  assert.equal(c.calls.filter((x) => x[0] === 'competitor-gap').length, 1, 'gap is not repeated');
  assert.equal(r.units, 5 + 2 * 15);
});

test('fails after retries are exhausted and still returns the draft', async () => {
  const r = await runPipeline(fakeClient({ facts: [10] }), 't', { retries: 1 });
  assert.equal(r.status, 'failed');
  assert.equal(r.attempts, 2);
  assert.ok(r.article.title);
});

test('stages can be skipped and estimates follow', async () => {
  const c = fakeClient();
  const r = await runPipeline(c, 't', { gap: false, factCheck: false, originality: false });
  assert.deepEqual(c.calls.map((x) => x[0]), ['article']);
  assert.equal(r.status, 'passed');
  assert.equal(estimateUnits({ gap: false, factCheck: false, originality: false }), 6);
  assert.equal(estimateUnits({ retries: 1 }), 5 + 2 * 15);
});

test('saveRun writes article, report and status files', async () => {
  const r = await runPipeline(fakeClient({ facts: [10] }), 'a topic', {});
  const dir = await mkdtemp(join(tmpdir(), 'pipe-'));
  const { files } = await saveRun(r, dir);
  assert.equal(files.length, 5);
  const status = JSON.parse(await readFile(join(dir, 'hello-world', 'status.json'), 'utf8'));
  assert.equal(status.status, 'failed');
  assert.match(reportMarkdown(r), /FAILED[\s\S]*Why it failed/);
});
