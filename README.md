# stayforlong-qa

End-to-end test suite for [Stayforlong](https://www.stayforlong.com), powered by AI-assisted test generation from **Jira issues** and **Datadog Synthetics**, compiled to **Playwright**.

---

## How it works

```
Jira Issue (WEB-666)          Datadog Synthetics JSON
        ↓  jira2md                     ↓  dd2md
        └──────────── md-specs/*.md ───┘
                           ↓  md2spec  (Claude AI + Playwright browser)
               playwright/specs/*.spec.ts
                           ↓  Playwright
                   Smoke tests · Regression suite · CI/CD
```

1. **`jira2md`** — reads a Jira issue via API, extracts the QA section, and writes a Markdown spec
2. **`dd2md`** — converts Datadog Synthetics JSON exports to Markdown specs
3. **`md-specs/`** — human-readable Markdown test specs, the single source of truth
4. **`md2spec`** — Claude AI navigates a real browser following each step, finds selectors, and writes the Playwright spec
5. **`playwright/specs/`** — final `.spec.ts` files; once generated, run with zero AI cost

---

## Repository structure

```
stayforlong-qa/
├── tools/
│   ├── dd2md/          # CLI: Datadog JSON → Markdown spec
│   ├── jira2md/        # CLI: Jira issue → Markdown spec
│   └── md2spec/        # CLI: Markdown spec → Playwright .spec.ts
│
├── datadog-exports/    # Original Datadog Synthetics JSON exports
├── md-specs/           # Human-readable Markdown test specs
│
├── playwright/
│   ├── playwright.config.ts
│   ├── global-setup.ts          # Handles cookie consent once for all tests
│   ├── helpers/
│   │   └── autoqa-env.ts        # Env var helpers (BASE_URL, loadEnvFiles)
│   └── specs/                   # Generated Playwright specs
│
├── md2spec.config.json          # Site-specific config for md2spec
└── .gitignore
```

---

## Prerequisites

- **Node.js** ≥ 20 (via [nvm](https://github.com/nvm-sh/nvm))
- **ANTHROPIC_API_KEY** — set in `~/.zshrc` or `~/.bash_profile`
- **VPN** — required to access `es.stayforlong.com` from some locations
- **Jira API token** *(for `jira2md` only)* — [generate at Atlassian](https://id.atlassian.com/manage-profile/security/api-tokens)

```bash
# Add to ~/.zshrc or ~/.bash_profile
export ANTHROPIC_API_KEY=sk-ant-...
export JIRA_BASE_URL=https://stayforlong.atlassian.net
export JIRA_EMAIL=you@stayforlong.com
export JIRA_API_TOKEN=your-token
```

---

## Running Playwright tests

```bash
cd playwright
npm install
npx playwright install chromium   # first time only

# Run all specs
AUTOQA_BASE_URL=https://es.stayforlong.com npx playwright test

# Run a specific spec
AUTOQA_BASE_URL=https://es.stayforlong.com npx playwright test specs/home-mapa.spec.ts

# Run with visible browser
AUTOQA_BASE_URL=https://es.stayforlong.com npx playwright test --headed

# HTML report
npx playwright show-report --port 9324
```

---

## Generating Playwright specs with md2spec

`md2spec` reads a Markdown spec, opens a browser, executes each step using Claude AI to find selectors, and writes the Playwright `.spec.ts`.

```bash
cd /path/to/stayforlong-qa

# Build first (once)
cd tools/md2spec && npm install && npm run build && cd ../..

# Generate a single spec
CLAUDE_CODE_SKIP_OAUTH=1 node tools/md2spec/dist/cli.js \
  md-specs/home-mapa.md \
  -o playwright/specs --headed

# Generate all specs
CLAUDE_CODE_SKIP_OAUTH=1 node tools/md2spec/dist/cli.js \
  'md-specs/*.md' \
  -o playwright/specs --headed

# Generate and immediately run Playwright
CLAUDE_CODE_SKIP_OAUTH=1 node tools/md2spec/dist/cli.js \
  md-specs/home-mapa.md \
  -o playwright/specs --headed --run

# Preview without writing files
CLAUDE_CODE_SKIP_OAUTH=1 node tools/md2spec/dist/cli.js \
  md-specs/home-mapa.md --dry-run

# Overwrite existing spec
CLAUDE_CODE_SKIP_OAUTH=1 node tools/md2spec/dist/cli.js \
  md-specs/home-mapa.md \
  -o playwright/specs --headed --force
```

### md2spec options

| Flag | Default | Description |
|---|---|---|
| `-o, --output <dir>` | `./playwright/specs` | Output directory |
| `--model <model>` | `claude-haiku-4-5` | Claude model |
| `--headed` | off | Show browser during generation |
| `--run` | off | Run Playwright on the generated spec immediately |
| `--force` | off | Overwrite existing `.spec.ts` |
| `--dry-run` | off | Print spec to stdout, do not write |
| `--viewport <WxH>` | from md or desktop | Override viewport (e.g. `390x844`) |

### Claude models for md2spec

| Model | Cost | When to use |
|---|---|---|
| `claude-haiku-4-5` | ~$0.002–0.01/spec | Default — most tests |
| `claude-sonnet-4-6` | ~$0.05–0.15/spec | Complex interactions, calendar, dropdowns |

### Viewport in Markdown

Add a viewport comment to the `.md` file to force mobile or tablet emulation:

```markdown
# Banner SERP (Movil)
<!-- Source: abc-123.json -->
<!-- viewport: mobile -->
```

Supported values: `mobile` (390×844), `tablet` (768×1024), `desktop` (1280×800, default).

Files with `movil` or `mobile` in their name get `<!-- viewport: mobile -->` automatically.

---

## Writing Markdown specs

Specs live in `md-specs/`. Each file follows this format:

```markdown
# Test Title

<!-- Generated by dd2md from Datadog Synthetics -->
<!-- Source: abc-123.json -->
<!-- viewport: mobile -->   ← optional

## Preconditions
- Browser is open and ready

## Steps
1. Navigate to https://es.stayforlong.com/es/city/madrid
2. Enter "madrid" in the search field
3. Select "Madrid, Comunidad de Madrid, España" from dropdown
4. Click the search button
5. Promotional banner is displayed at the top of results
```

### Step writing guidelines

- **Navigation**: `Navigate to <url>` — always as step 1
- **Clicks**: describe what the element IS, not its HTML tag. `Click search button` not `Click on span "Buscar"`
- **Inputs**: `Enter "value" in <field description>`
- **Assertions**: `<Element> is displayed` or `<Element> is visible` — md2spec generates `expect(...).toBeVisible()`
- **Optional steps**: add "if present" or "if appear" → wrapped in `try/catch`
- **Do NOT add consent step** — md2spec handles cookie consent automatically after navigation
- **Do NOT add popup close step** — the subscription popup is also handled automatically

---

## Generating Markdown specs

### From Jira issues

```bash
cd tools/jira2md && npm install && npm run build && cd ../..

# Single issue
node tools/jira2md/dist/cli.js WEB-666 \
  -o md-specs --base-url https://es.stayforlong.com

# Multiple issues
node tools/jira2md/dist/cli.js WEB-666 WEB-667 WEB-668 -o md-specs

# Preview
node tools/jira2md/dist/cli.js WEB-666 --dry-run --verbose
```

**The Jira issue must have a section with one of these headings:**
`QA Requirements`, `Acceptance Criteria`, `Test Cases`, `Definition of Done`, `Success Criteria`, `How to Test`, `Verification Steps`

### From Datadog Synthetics

```bash
cd tools/dd2md && npm install && npm run build && cd ../..

# Convert all exports
node tools/dd2md/dist/cli.js 'datadog-exports/*.json' -o md-specs

# With AI-enhanced descriptions (recommended)
node tools/dd2md/dist/cli.js 'datadog-exports/*.json' -o md-specs --ai-enhance

# With a specific model
node tools/dd2md/dist/cli.js 'datadog-exports/*.json' -o md-specs \
  --ai-enhance --model claude-sonnet-4-6

# Preview
node tools/dd2md/dist/cli.js 'datadog-exports/*.json' --dry-run --verbose
```

### `--ai-enhance` flag

Without it, dd2md uses the raw Datadog step name (often includes HTML tags like "Click on span '1'").
With it, Claude reads the element's HTML (`targetOuterHTML`) and rewrites the step as a human-readable description.

| Without | With |
|---|---|
| `Click on span "1"` | `Click on 1-star filter` |
| `Click on svg "Ofertas exclusivas"` | `Close the exclusive offers popup` |
| `Click on path "Servicios"` | `Click on Services tab` |

---

## Downloading Datadog exports

```bash
curl "https://api.datadoghq.eu/api/v1/synthetics/tests?type=browser" \
  -H "DD-API-KEY: <key>" -H "DD-APPLICATION-KEY: <app-key>" \
  | python3 -c "
import sys, json
tests = json.load(sys.stdin)['tests']
for t in tests: print(t['public_id'])
" | while read ID; do
  curl -s "https://api.datadoghq.eu/api/v1/synthetics/tests/browser/$ID" \
    -H "DD-API-KEY: <key>" -H "DD-APPLICATION-KEY: <app-key>" \
    > "datadog-exports/$ID.json"
done
```

---

## What is versioned

| Path | Versioned | Reason |
|---|---|---|
| `tools/*/src/` | ✅ | Tool source code |
| `datadog-exports/*.json` | ✅ | Original Datadog test definitions |
| `md-specs/*.md` | ✅ | Human-readable test specs |
| `playwright/specs/*.spec.ts` | ✅ | Generated Playwright tests |
| `playwright/helpers/` | ✅ | Shared test utilities |
| `md2spec.config.json` | ✅ | Site-specific md2spec configuration |
| `tools/*/node_modules/` | 🚫 | Install locally |
| `tools/*/dist/` | 🚫 | Build output |
| `playwright/node_modules/` | 🚫 | Install locally |
| `playwright/playwright-report/` | 🚫 | Generated HTML reports |
| `playwright/test-results/` | 🚫 | Test run artifacts |
| `playwright/.auth/` | 🚫 | Browser consent state |

---

## Tech stack

- **[Playwright](https://playwright.dev)** — Browser automation and test runner
- **[Anthropic Claude](https://anthropic.com)** — AI model powering md2spec and dd2md AI enhancement
- **[md2spec](tools/md2spec/)** — Custom CLI: Markdown spec → Playwright `.spec.ts` via AI browser agent
- **[jira2md](tools/jira2md/)** — Custom CLI: Jira issues → Markdown spec
- **[dd2md](tools/dd2md/)** — Custom CLI: Datadog Synthetics JSON → Markdown spec
- **[Jira REST API v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)** — Issue data source for `jira2md`
