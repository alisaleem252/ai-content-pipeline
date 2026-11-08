import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'article';

export function articleMarkdown(a) {
  const out = [`# ${a.title}`, '', a.body_markdown || ''];
  if (a.faq?.length) { out.push('', '## FAQ', ''); for (const f of a.faq) out.push(`### ${f.q}`, '', f.a, ''); }
  if (a.sources?.length) { out.push('', '## Sources', ''); for (const s of a.sources) out.push(`- [${s.title || s.url}](${s.url})`); }
  return out.join('\n') + '\n';
}

export function articleHtml(a) {
  const faq = a.faq?.length ? `<h2>FAQ</h2>\n${a.faq.map((f) => `<h3>${esc(f.q)}</h3>\n<p>${esc(f.a)}</p>`).join('\n')}\n` : '';
  const src = a.sources?.length ? `<h2>Sources</h2>\n<ul>\n${a.sources.map((s) => `<li><a href="${esc(s.url)}" rel="noopener">${esc(s.title || s.url)}</a></li>`).join('\n')}\n</ul>\n` : '';
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(a.title)}</title>\n<meta name="description" content="${esc(a.meta_description || '')}"></head><body>\n<h1>${esc(a.title)}</h1>\n${a.body_html || ''}\n${faq}${src}</body></html>\n`;
}

export function reportMarkdown(r) {
  const f = r.factCheck?.summary, o = r.originality;
  const lines = [
    `# Pipeline report: ${r.topic}`, '',
    `**Result: ${r.status === 'passed' ? '✅ PASSED' : '❌ FAILED'}** after ${r.attempts} attempt(s), ${r.units} request units used.`, '',
  ];
  if (r.reasons.length) lines.push('## Why it failed', ...r.reasons.map((x) => `- ${x}`), '');
  lines.push('## Scores', '');
  lines.push(`- Article: ${r.article.word_count ?? '?'} words, quality ${r.article.quality?.score ?? 'n/a'}`);
  if (f) lines.push(`- Fact check: ${f.score}/100 (${f.supported} supported, ${f.partly} partly, ${f.contradicted} contradicted, ${f.unverified} unverified)`);
  if (o) lines.push(`- Originality: ${o.score}/100 (${o.matched} of ${o.checked} sampled sentences matched existing pages)`);
  if (r.gap) lines.push(`- Competitor gap: target ${r.gap.target_words} words, ${(r.gap.missing || []).length} gaps found`);
  const bad = (r.factCheck?.claims || []).filter((c) => c.verdict === 'contradicted' || c.verdict === 'partly');
  if (bad.length) { lines.push('', '## Claims to review'); for (const c of bad) lines.push(`- **${c.verdict}**: ${c.claim}${c.evidence ? `\n  > ${c.evidence}` : ''}${c.source_url ? `\n  ${c.source_url}` : ''}`); }
  if (o?.matches?.length) { lines.push('', '## Overlapping text'); for (const m of o.matches) lines.push(`- "${m.sentence}" (${m.run_words} words shared with ${m.url})`); }
  if ((r.article.warnings || []).length) lines.push('', '## Generator warnings', ...r.article.warnings.map((w) => `- ${typeof w === 'string' ? w : JSON.stringify(w)}`));
  return lines.join('\n') + '\n';
}

/** Write everything for one run into <out>/<slug>/ (rejected drafts are kept, marked by status.json). */
export async function saveRun(r, outDir) {
  const dir = join(outDir, slugify(r.article.slug || r.topic));
  await mkdir(dir, { recursive: true });
  const files = {
    'article.md': articleMarkdown(r.article), 'article.html': articleHtml(r.article), 'report.md': reportMarkdown(r),
    'result.json': JSON.stringify(r, null, 2), 'status.json': JSON.stringify({ status: r.status, reasons: r.reasons, units: r.units }, null, 2),
  };
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return { dir, files: Object.keys(files).map((n) => join(dir, n)) };
}
