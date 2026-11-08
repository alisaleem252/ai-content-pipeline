#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { loadEnv } from '../src/env.js';
import { RapidTextAI } from '../src/api.js';
import { runPipeline, estimateUnits } from '../src/pipeline.js';
import { saveRun } from '../src/report.js';

loadEnv();

const HELP = `Usage: ai-content-pipeline "<topic>" [options]
       ai-content-pipeline --file topics.txt [options]

Runs: competitor gap -> article -> fact check -> originality -> quality gate.
Each stage feeds the next: the gap outline shapes the article, and the article is checked before you see it.

Options:
  -k, --keyword <text>       Primary keyword (default: the topic)
  -w, --words <n>            Target length (default: taken from the competitor gap)
  -t, --tone <text>   -l, --language <text>   -a, --audience <text>
      --type <type>          guide|how-to|listicle|comparison|review|pillar|news
  -m, --model <id>           Model for drafting
      --brand-id <id>        Use a brand saved in your RapidTextAI account
      --cta <text>           Call to action
      --site-url <url>       Your site (excluded from research, used for links)
      --min-fact <n>         Minimum fact-check score, 0-100 (default 70)
      --min-originality <n>  Minimum originality score, 0-100 (default 80)
      --allow-contradicted   Do not fail when a claim is contradicted by sources
      --retries <n>          Regenerate up to n times if the gate fails (default 0)
      --no-gap               Skip competitor gap (saves 5 units)
      --no-fact-check        Skip fact check (saves 6 units)
      --no-originality       Skip originality (saves 3 units)
  -o, --out <dir>            Output folder (default ./output)
      --key <api-key>        Override RAPIDTEXTAI_API_KEY
  -q, --quiet   -h, --help

Cost with all stages: 20 request units per attempt (5 + 6 + 6 + 3).
Exit codes: 0 all passed, 1 error, 3 at least one article failed the gate.`;

let v, pos;
try {
  ({ values: v, positionals: pos } = parseArgs({
    allowPositionals: true,
    options: {
      keyword: { type: 'string', short: 'k' }, words: { type: 'string', short: 'w' }, tone: { type: 'string', short: 't' },
      language: { type: 'string', short: 'l' }, audience: { type: 'string', short: 'a' }, type: { type: 'string' },
      model: { type: 'string', short: 'm' }, 'brand-id': { type: 'string' }, cta: { type: 'string' }, 'site-url': { type: 'string' },
      'min-fact': { type: 'string' }, 'min-originality': { type: 'string' }, 'allow-contradicted': { type: 'boolean' },
      retries: { type: 'string' }, 'no-gap': { type: 'boolean' }, 'no-fact-check': { type: 'boolean' }, 'no-originality': { type: 'boolean' },
      out: { type: 'string', short: 'o', default: 'output' }, key: { type: 'string' }, file: { type: 'string', short: 'f' },
      quiet: { type: 'boolean', short: 'q' }, help: { type: 'boolean', short: 'h' },
    },
  }));
} catch (e) { console.error(e.message + '\n\n' + HELP); process.exit(2); }

if (v.help || (!pos.length && !v.file)) { console.log(HELP); process.exit(v.help ? 0 : 2); }
const log = (...a) => { if (!v.quiet) console.error(...a); };
const num = (x, d, name, lo, hi) => {
  if (x === undefined) return d;
  const n = Number(x);
  if (!Number.isFinite(n) || n < lo || n > hi) { console.error(`--${name} must be a number from ${lo} to ${hi}.`); process.exit(2); }
  return n;
};

const article = {};
if (v.words) article.word_count = num(v.words, 0, 'words', 300, 4000);
for (const [flag, key] of [['tone', 'tone'], ['language', 'language'], ['audience', 'audience'], ['type', 'article_type'], ['model', 'model'], ['cta', 'cta'], ['site-url', 'site_url']]) if (v[flag]) article[key] = v[flag];
if (v['brand-id']) article.brand_id = Number(v['brand-id']);

const opts = {
  keyword: v.keyword, article,
  minFact: num(v['min-fact'], 70, 'min-fact', 0, 100), minOriginality: num(v['min-originality'], 80, 'min-originality', 0, 100),
  allowContradicted: v['allow-contradicted'], retries: num(v.retries, 0, 'retries', 0, 3),
  gap: !v['no-gap'], factCheck: !v['no-fact-check'], originality: !v['no-originality'],
};

const ac = new AbortController();
process.on('SIGINT', () => { ac.abort(); console.error('\nCancelled.'); process.exit(130); });

try {
  const client = new RapidTextAI({ apiKey: v.key });
  const topics = [...pos];
  if (v.file) topics.push(...(await readFile(v.file, 'utf8')).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
  const perTopic = estimateUnits(opts);
  log(`${topics.length} topic(s), up to ${perTopic} units each (${perTopic * topics.length} total).`);

  let failed = 0, errors = 0;
  for (const [i, topic] of topics.entries()) {
    log(`\n[${i + 1}/${topics.length}] ${topic}`);
    try {
      const t0 = Date.now();
      const r = await runPipeline(client, topic, opts, {
        signal: ac.signal,
        onStep: (s) => { if (s.status === 'start') log(`  • ${s.step}...`); else if (s.status === 'progress' && s.detail) log(`      ${s.detail}`); },
      });
      const { dir } = await saveRun(r, v.out);
      log(`  ${r.status === 'passed' ? '✅ passed' : '❌ failed'} in ${Math.round((Date.now() - t0) / 1000)}s (${r.units} units): "${r.article.title}"`);
      for (const reason of r.reasons) log(`     - ${reason}`);
      log(`  saved to ${dir}`);
      if (r.status !== 'passed') failed++;
    } catch (e) {
      errors++; console.error(`  Failed "${topic}": ${e.message}`);
      if (e.status === 401) process.exit(1);
    }
  }
  process.exit(errors ? 1 : failed ? 3 : 0);
} catch (e) { console.error(e.message); process.exit(1); }
