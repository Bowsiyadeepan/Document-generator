import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import { enqueueDocsJob, docsQueue } from './queue/docsQueue.js';

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

// Use raw body for HMAC verification -- must come before any JSON parsing
app.use('/webhook/github', express.raw({ type: 'application/json' }));
app.use(express.json());

// Simple Dashboard
app.get('/', async (req, res) => {
  try {
    const jobs = await docsQueue.getJobs(['active', 'waiting', 'completed', 'failed']);
    const recentJobs = jobs.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>DocuBot Dashboard</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 1000px; margin: 0 auto; padding: 2rem; background: #f4f7f6; }
          h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 0.5rem; }
          .card { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 2rem; }
          .status { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.875rem; font-weight: bold; }
          .status-completed { background: #d4edda; color: #155724; }
          .status-active { background: #cce5ff; color: #004085; }
          .status-failed { background: #f8d7da; color: #721c24; }
          .status-waiting { background: #fff3cd; color: #856404; }
          table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
          th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #eee; }
          th { background: #f8f9fa; }
          code { background: #f0f0f0; padding: 0.2rem 0.4rem; border-radius: 4px; font-family: monospace; }
        </style>
      </head>
      <body>
        <h1>DocuBot Dashboard</h1>
        
        <div class="card">
          <h2>System Status</h2>
          <p><strong>Status:</strong> <span class="status status-completed">Online</span></p>
          <p><strong>Environment:</strong> <code>${process.env.NODE_ENV || 'development'}</code></p>
          <p><strong>Queue:</strong> <code>docs-generation</code></p>
        </div>

        <div class="card">
          <h2>Recent Jobs</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Repo</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              ${recentJobs.length > 0 ? recentJobs.map(job => `
                <tr>
                  <td><code>${job.id}</code></td>
                  <td>${job.name}</td>
                  <td>${job.data.owner}/${job.data.repoName}</td>
                  <td><span class="status status-${job.getState ? 'active' : 'completed'}">${job.id.includes('docs-') ? 'Ready' : 'Unknown'}</span></td>
                  <td>${new Date(job.timestamp).toLocaleString()}</td>
                </tr>
              `).join('') : '<tr><td colspan="5">No jobs found in queue.</td></tr>'}
            </tbody>
          </table>
        </div>

        <div class="card">
          <h2>Configuration</h2>
          <ul>
            <li><strong>Webhook Endpoint:</strong> <code>/webhook/github</code></li>
            <li><strong>Output Directory:</strong> <code>${process.env.DOCS_OUTPUT_DIR || 'docs/'}</code></li>
            <li><strong>Target Branch:</strong> <code>${process.env.TARGET_DOCS_BRANCH || 'main'}</code></li>
            <li><strong>Open PRs:</strong> <code>${process.env.OPEN_PR_FOR_DOCS || 'true'}</code></li>
          </ul>
        </div>
      </body>
      </html>
    `;
    res.send(html);
  } catch (err) {
    res.status(500).send(`Error loading dashboard: ${err.message}`);
  }
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GitHub webhook
app.post('/webhook/github', async (req, res) => {
  // 1. Verify HMAC signature
  if (WEBHOOK_SECRET) {
    const signature = req.headers['x-hub-signature-256'];
    if (!signature) {
      console.warn('[webhook] Missing X-Hub-Signature-256 header');
      return res.status(401).json({ error: 'Missing signature' });
    }

    const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
    hmac.update(req.body);
    const expected = `sha256=${hmac.digest('hex')}`;

    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      console.warn('[webhook] Invalid HMAC signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // 2. Parse body (raw buffer -> JSON)
  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  const event = req.headers['x-github-event'];
  console.log(`[webhook] Received event: ${event}`);

  // 3. Respond 202 immediately -- never block on heavy work
  res.status(202).json({ status: 'accepted' });

  // 4. Dispatch to queue asynchronously
  try {
    await handleGitHubEvent(event, payload);
  } catch (err) {
    console.error('[webhook] Failed to enqueue job:', err.message);
  }
});

async function handleGitHubEvent(event, payload) {
  if (event === 'pull_request') {
    const { action, pull_request: pr, repository } = payload;

    // Only process merged PRs
    if (action !== 'closed' || !pr.merged) return;

    const [owner, repoName] = repository.full_name.split('/');

    await enqueueDocsJob('docs-pr', {
      owner,
      repoName,
      prNumber: pr.number,
      prTitle: pr.title,
      prDescription: pr.body || '',
      headSha: pr.merge_commit_sha || pr.head.sha,
      baseSha: pr.base.sha,
      baseRef: pr.base.ref,
      headRef: pr.head.ref,
      author: pr.user.login,
      triggeredAt: new Date().toISOString(),
    });

    console.log(`[webhook] Enqueued docs-pr job for PR #${pr.number} in ${repository.full_name}`);
    return;
  }

  if (event === 'push') {
    const { ref, repository, after, before, commits } = payload;

    const defaultBranch = repository.default_branch;
    if (ref !== `refs/heads/${defaultBranch}`) return;
    if (!commits || commits.length === 0) return;

    const [owner, repoName] = repository.full_name.split('/');

    await enqueueDocsJob('docs-push', {
      owner,
      repoName,
      headSha: after,
      baseSha: before,
      baseRef: defaultBranch,
      triggeredAt: new Date().toISOString(),
    });

    console.log(`[webhook] Enqueued docs-push job for push to ${ref} in ${repository.full_name}`);
    return;
  }

  console.log(`[webhook] Ignoring unhandled event: ${event}`);
}

app.listen(PORT, () => {
  console.log(`[server] DocuBot webhook server running on port ${PORT}`);
  console.log(`[server] POST /webhook/github -- GitHub webhook receiver`);
  console.log(`[server] GET  /health         -- Health check`);
});

export default app;
