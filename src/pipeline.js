// gap -> article -> fact-check -> originality -> quality gate (with optional regeneration).
export const UNITS = { gap: 5, article: 6, factCheck: 6, originality: 3 };

const headingOf = (s) => (typeof s === 'string' ? s : s?.heading || s?.title || '');

/** Estimate request units for one topic. */
export function estimateUnits(o) {
  const attempts = 1 + (o.retries || 0);
  return (o.gap === false ? 0 : UNITS.gap)
    + attempts * (UNITS.article + (o.factCheck === false ? 0 : UNITS.factCheck) + (o.originality === false ? 0 : UNITS.originality));
}

/** Decide pass/fail from the check results. Returns the list of reasons it failed (empty = pass). */
export function gate({ factCheck, originality }, o) {
  const reasons = [];
  if (factCheck) {
    const s = factCheck.summary || {};
    if ((s.score ?? 0) < o.minFact) reasons.push(`fact-check score ${s.score ?? 0} is below ${o.minFact}`);
    if (!o.allowContradicted && (s.contradicted ?? 0) > 0) reasons.push(`${s.contradicted} claim(s) were contradicted by sources`);
  }
  if (originality && (originality.score ?? 0) < o.minOriginality) {
    reasons.push(`originality score ${originality.score ?? 0} is below ${o.minOriginality}`);
  }
  return reasons;
}

/**
 * Run the whole pipeline for one topic. `client` needs article() and seo() (see src/api.js).
 * onStep({step, status, detail}) is called as it goes. One RapidTextAI job runs at a time, so steps are sequential.
 */
export async function runPipeline(client, topic, o = {}, { onStep = () => {}, signal } = {}) {
  const opts = { minFact: 70, minOriginality: 80, retries: 0, ...o };
  const units = { used: 0 };
  const step = async (name, units_, fn) => {
    onStep({ step: name, status: 'start' });
    const r = await fn();
    units.used += units_;
    onStep({ step: name, status: 'done' });
    return r;
  };
  const ev = (name) => (e) => e.type === 'progress' && onStep({ step: name, status: 'progress', detail: e.detail || e.stage });

  // 1. Competitor gap -> outline + target length
  let gap = null;
  if (opts.gap !== false) {
    gap = await step('gap', UNITS.gap, () => client.seo('competitor-gap', { keyword: opts.keyword || topic }, { onEvent: ev('gap'), signal }));
  }
  const outlineHint = gap ? (gap.outline?.sections || []).map(headingOf).filter(Boolean).slice(0, 12) : [];
  const params = { topic, keyword: opts.keyword || topic, ...(opts.article || {}) };
  if (outlineHint.length) params.outline_hint = outlineHint;
  if (!params.word_count && gap?.target_words) params.word_count = Math.min(4000, Math.max(300, gap.target_words));

  // 2-4. Draft, then check; regenerate up to `retries` times if the gate fails.
  let attempt = 0, article, factCheck = null, originality = null, reasons = [];
  const history = [];
  for (;;) {
    attempt++;
    article = await step(`article${attempt > 1 ? ` (attempt ${attempt})` : ''}`, UNITS.article, () => client.article(params, { onEvent: ev('article'), signal }));
    const html = article.body_html || '';
    factCheck = originality = null;
    if (opts.factCheck !== false) factCheck = await step('fact-check', UNITS.factCheck, () => client.seo('fact-check', { html }, { onEvent: ev('fact-check'), signal }));
    if (opts.originality !== false) originality = await step('originality', UNITS.originality, () => client.seo('originality', { html }, { onEvent: ev('originality'), signal }));
    reasons = gate({ factCheck, originality }, opts);
    history.push({ attempt, passed: !reasons.length, reasons });
    if (!reasons.length || attempt > opts.retries) break;
  }

  return { topic, status: reasons.length ? 'failed' : 'passed', reasons, attempts: attempt, history, units: units.used, params, gap, article, factCheck, originality };
}
