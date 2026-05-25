# AI Docs Generator

An AI-powered documentation agent that watches GitHub repositories and automatically generates technical documentation whenever a PR is merged. It commits the generated docs back to the repo as a new pull request.

Powered by Claude (Anthropic), it produces API references, changelogs, migration guides, architecture overviews, and more — all derived strictly from your code and PR diffs.

## How It Works

```
GitHub PR merged
      │
      ▼
POST /webhook/github          ← Express server validates HMAC signature
      │
      ▼
Redis Job Queue (BullMQ)      ← Job enqueued, 202 returned immediately
      │
      ▼
BullMQ Worker (separate process)
      │
      ├─ Fetch PR files + details (GitHub API)
      ├─ Parse diffs, detect breaking changes
      ├─ Run generators in parallel (max 3 concurrent):
      │     ├─ changelog.js       → CHANGELOG.md entry
      │     ├─ readmeUpdater.js   → README.md update (if needed)
      │     ├─ apiReference.js    → docs/api/{file}.md (per changed file)
      │     └─ migration.js       → docs/migrations/v{x}-migration.md (if breaking)
      │
      ├─ Convert JSON results → Markdown files
      └─ Commit docs + open PR back to repo
```

## Quick Start

**1. Clone and install**
```bash
git clone https://github.com/your-org/ai-docs-generator.git
cd ai-docs-generator
npm install
```

**2. Configure environment**
```bash
cp .env.example .env
# Edit .env with your tokens (see Environment Variables below)
```

**3. Start Redis**
```bash
docker run -d -p 6379:6379 redis:alpine
```

**4. Start the webhook server** (Terminal 1)
```bash
npm start
```

**5. Start the worker** (Terminal 2)
```bash
npm run worker
```

Verify it's running:
```bash
curl http://localhost:3000/health
# → {"status":"ok","timestamp":"2024-01-15T10:30:00.000Z"}
```

## Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `GITHUB_TOKEN` | ✓ | GitHub Personal Access Token with `repo` scope | `ghp_xxxxxxxxxxxx` |
| `GITHUB_WEBHOOK_SECRET` | ✓ | Secret set in your GitHub webhook settings | `my_webhook_secret` |
| `ANTHROPIC_API_KEY` | ✓ | Anthropic API key for Claude | `sk-ant-api03-...` |
| `REDIS_URL` | ✓ | Redis connection URL | `redis://localhost:6379` |
| `PORT` | — | Webhook server port (default: `3000`) | `3000` |
| `NODE_ENV` | — | Environment (`development` or `production`) | `production` |
| `TARGET_DOCS_BRANCH` | — | Branch to commit docs to when `open_pr=false` | `docs/auto-generated` |
| `OPEN_PR_FOR_DOCS` | — | Override `open_pr` from config (`true`/`false`) | `true` |
| `DOCS_OUTPUT_DIR` | — | Default docs output directory | `docs/` |

## .docsbot.yaml Configuration

Add a `.docsbot.yaml` file to the root of any repository you want DocuBot to watch:

```yaml
enabled: true           # Set to false to disable DocuBot for this repo
docs_output_dir: docs/  # Where to write generated docs
open_pr: true           # Open a PR for docs (false = commit directly)

generators:
  api_reference: true   # Generate API reference for changed source files
  changelog: true       # Generate changelog entry for every merged PR
  readme_update: true   # Update README if PR changes user-facing behavior
  architecture: false   # Generate architecture overview (expensive — run manually)
  docstrings: false     # Add inline docstrings to source files
  migration_guide: true # Generate migration guide when breaking changes detected
  onboarding: false     # Generate Getting Started guide (run manually)
  runbook: false        # Generate ops runbook (run manually)
  stale_detection: false # Scan for outdated docs (run manually or on schedule)

ignore_paths:
  - tests/
  - migrations/
  - "*.test.js"

source_extensions:
  - .js
  - .ts
  - .py
  - .go
  - .java

changelog_file: CHANGELOG.md
```

## What Each Generator Produces

| Generator | Trigger | Output File |
|-----------|---------|-------------|
| `api_reference` | PR merged (per changed source file) | `docs/api/{filename}.md` |
| `changelog` | Every PR merged | Prepended to `CHANGELOG.md` |
| `readme_update` | PR merged (if user-facing changes) | `README.md` (full replacement) |
| `migration_guide` | PR with breaking changes detected | `docs/migrations/v{version}-migration.md` |
| `architecture` | Manual trigger (`--arch`) | `docs/architecture.md` |
| `docstrings` | PR merged (per changed source file) | Source file with docstrings inserted |
| `onboarding` | Manual trigger (`--onboarding`) | `docs/getting-started.md` |
| `runbook` | Manual trigger (`--runbook`) | `docs/runbook.md` |
| `stale_detection` | Manual trigger (`--scan`) | `docs/doc-health-report.md` |

## Manual Trigger

Run documentation generation without a webhook:

```bash
# Generate docs for a specific PR
node scripts/generateDocs.js acme/api 42

# Scan for stale documentation
node scripts/generateDocs.js acme/api --scan

# Generate architecture overview
node scripts/generateDocs.js acme/api --arch
```

## GitHub Webhook Setup

1. Go to your repository → **Settings** → **Webhooks** → **Add webhook**
2. Set **Payload URL** to `https://your-server.com/webhook/github`
3. Set **Content type** to `application/json`
4. Set **Secret** to the same value as `GITHUB_WEBHOOK_SECRET` in your `.env`
5. Select **Individual events** → check **Pull requests** and **Pushes**
6. Click **Add webhook**

## Deploy to Render

Deploy three services from the same repository:

### 1. Web Service (webhook receiver)
- **Build command:** `npm install`
- **Start command:** `node src/index.js`
- **Environment variables:** All from the table above

### 2. Background Worker
- **Build command:** `npm install`
- **Start command:** `node src/worker.js`
- **Environment variables:** Same as web service

### 3. Redis (Key Value)
- Create a **Key Value** service in Render
- Copy the **Internal Redis URL** into `REDIS_URL` for both services above

> ⚠️ Free Redis on Render expires every 90 days — all queued jobs are lost on expiry. Upgrade to a paid plan for production use.

## Architecture

See [docs/architecture.md](docs/architecture.md) for a full architecture overview (generate with `node scripts/generateDocs.js your-org/your-repo --arch`).

## License

MIT
