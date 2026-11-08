# AI Content Pipeline

![Node 18+](https://img.shields.io/badge/node-%3E%3D18-brightgreen) ![Dependencies](https://img.shields.io/badge/dependencies-0-blue) ![Powered by RapidTextAI](https://img.shields.io/badge/powered%20by-RapidTextAI-4f46e5)

One command that researches, writes and **quality-checks** an article before you ever see it. It chains the RapidTextAI competitor gap, article, fact-check and originality tools, and only calls the result "passed" if it clears your thresholds.

```
keyword ─▶ Competitor Gap ─▶ Article ─▶ Fact Check ─▶ Originality ─▶ Quality gate ─▶ saved
           (outline +        (writes to    (claims vs      (copied text?)   (pass / fail,
            target length)    that outline) live sources)                    optional retry)
```

## Why use it

- **Every stage feeds the next.** The competitor outline and target length drive the article, so it covers what ranks and what competitors miss, instead of a generic draft.
- **Nothing unchecked ships.** Each article is fact-checked against live sources and spot-checked for copied text, then gated on scores you set.
- **Automatic second chance.** `--retries 2` regenerates the article if the gate fails, reusing the competitor analysis so you don't pay for it twice.
- **Bulk friendly.** Give it a file of topics and walk away. Failed drafts are kept, clearly marked, so nothing is lost.
- **CI friendly.** Exit code `3` means "an article failed the gate", so you can wire it into scripts and schedules.
- **Zero dependencies.** Plain Node.js. Output is Markdown, HTML and JSON, ready for your CMS.

## Requirements

- [Node.js](https://nodejs.org) 18 or newer
- A RapidTextAI account and API key (<https://app.rapidtextai.com>)

## Install

```bash
git clone https://github.com/alisaleem252/ai-content-pipeline.git
cd ai-content-pipeline
cp .env.example .env        # then paste your key into .env
```

## Use it

```bash
node bin/cli.js "project management software"

# Tune the gate and allow one regeneration
node bin/cli.js "remote team onboarding" -k "employee onboarding" --min-fact 80 --min-originality 90 --retries 1

# Many topics, one per line (lines starting with # are ignored)
node bin/cli.js --file topics.txt -o ./articles

# Cheaper run: skip the competitor analysis
node bin/cli.js "history of coffee" --no-gap
```

Example output (from `npm run demo`, which uses a fake API, so scores are sample values):

```
[1/1] project management software
  • gap...
  • article...
  • fact-check...
  • originality...
  ✅ passed in 0s (20 units): "Project Management Software: How Small Teams Should Choose"
  saved to output/demo/project-management-software-small-teams
```

Each topic gets its own folder:

| File | Contents |
|---|---|
| `article.md`, `article.html` | The article with FAQ and sources |
| `report.md` | Pass/fail, scores, claims to review, overlapping text |
| `result.json` | Everything, including the raw gap and check results |
| `status.json` | `{status, reasons, units}` for scripts |

### Options

| Option | Description |
|---|---|
| `-k, --keyword` | Primary keyword (default: the topic) |
| `-w, --words` | Target length (default: from the competitor gap) |
| `-t`, `-l`, `-a`, `--type`, `-m`, `--cta`, `--site-url`, `--brand-id` | Article style, model, call to action, brand |
| `--min-fact` | Minimum fact-check score (default 70) |
| `--min-originality` | Minimum originality score (default 80) |
| `--allow-contradicted` | Don't fail on claims contradicted by sources |
| `--retries <n>` | Regenerate up to n times if the gate fails (max 3) |
| `--no-gap`, `--no-fact-check`, `--no-originality` | Skip a stage to save units |
| `-o, --out` | Output folder (default `./output`) |

### Use it as a library

```js
import { RapidTextAI } from './src/api.js';
import { runPipeline } from './src/pipeline.js';

const client = new RapidTextAI({ apiKey: process.env.RAPIDTEXTAI_API_KEY });
const result = await runPipeline(client, 'project management software', { minFact: 80, retries: 1 });
console.log(result.status, result.reasons, result.article.title);
```

## What it costs

| Stage | Units |
|---|---|
| Competitor gap | 5 |
| Article | 6 |
| Fact check | 6 |
| Originality | 3 |
| **One attempt, all stages** | **20** |

Each retry adds 15 units (article, fact check, originality). The estimate is printed before every run. The API refunds units for requests that fail outright, but a draft that merely fails your gate still used its units.

## Good to know

- **One job at a time.** RapidTextAI runs one generation or SEO tool per account at once, so stages and topics run sequentially. Expect a few minutes per article.
- **Checks are spot checks.** Fact Check examines up to 10 claims and Originality samples distinctive sentences. Review before publishing.
- **Needs web search on the server.** If it isn't configured, the SEO stages return 503.

## Try it without a key

```bash
npm run demo                       # passing run
DEMO_FAIL=1 node test/demo.js "my topic" --retries 1   # first draft fails the gate, second passes
```

## Development

```bash
npm test      # offline unit tests, no key needed
```

Layout: `src/pipeline.js` (stages, gate, retries), `src/api.js` (API client), `src/report.js` (output files), `bin/cli.js`.

## License

No license has been chosen yet; add one before accepting contributions.
