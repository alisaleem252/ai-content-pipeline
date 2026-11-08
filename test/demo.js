// Offline demo: runs the real CLI against a fake RapidTextAI API (sample data, no key, no units).
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const article = { title: 'Project Management Software: How Small Teams Should Choose', slug: 'project-management-software-small-teams', meta_description: 'A practical guide.', body_html: '<p>Sample article body.</p><h2>Features that matter</h2><p>More sample text.</p>', body_markdown: 'Sample article body.\n\n## Features that matter\n\nMore sample text.', word_count: 2380, quality: { score: 94 }, faq: [{ q: 'Is free software enough?', a: 'Often, for very small teams.' }], sources: [{ title: 'Example', url: 'https://example.com' }], warnings: [] };
const R = {
  'competitor-gap': { target_words: 2400, missing: ['Migration plan', 'Total cost of ownership', 'Onboarding time'], outline: { sections: ['What it does', 'Features that matter', 'Pricing and real cost', 'Migrating from spreadsheets', 'A scorecard for choosing'] } },
  'fact-check': { summary: { checked: 6, supported: 4, partly: 1, contradicted: 0, unverified: 1, score: 75 }, claims: [{ claim: 'Cloud tools cost 30% less.', verdict: 'partly', evidence: 'Savings ranged from 10% to 25%.', source_url: 'https://example.com/costs' }] },
  originality: { checked: 8, matched: 0, score: 100, matches: [] },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let facts = 0;
const api = createServer(async (req, res) => {
  const seo = req.url.match(/\/v2\/seo\/([a-z-]+)/)?.[1];
  const isArticle = req.url.includes('/v2/article/generate');
  if (!seo && !isArticle) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  send({ type: 'progress', stage: 'working', detail: isArticle ? 'drafting sections' : 'reading sources' });
  await sleep(Number(process.env.MOCK_DELAY ?? 400));
  let data = isArticle ? article : R[seo];
  if (seo === 'fact-check' && process.env.DEMO_FAIL && facts++ === 0) data = { summary: { checked: 6, supported: 2, partly: 1, contradicted: 2, unverified: 1, score: 42 }, claims: [] };
  send({ type: 'result', data });
  res.end('data: [DONE]\n\n');
}).listen(0, '127.0.0.1', () => {
  const env = { ...process.env, RAPIDTEXTAI_API_KEY: 'demo-key', RAPIDTEXTAI_BASE_URL: `http://127.0.0.1:${api.address().port}/openai` };
  console.error('DEMO MODE: fake API, sample data. No key or units needed.\n');
  const args = process.argv.slice(2);
  spawn(process.execPath, ['bin/cli.js', ...(args.length ? args : ['project management software', '-o', 'output/demo'])], { env, stdio: 'inherit' })
    .on('exit', (c) => { api.close(); process.exit(c); });
});
