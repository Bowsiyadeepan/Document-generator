#!/usr/bin/env node
/**
 * Manual trigger CLI for DocuBot.
 *
 * Usage:
 *   node scripts/generateDocs.js <owner/repo> <pr-number>
 *   node scripts/generateDocs.js <owner/repo> --scan     (stale detection)
 *   node scripts/generateDocs.js <owner/repo> --arch     (architecture overview)
 */

import 'dotenv/config';
import { getPRDetails, getDefaultBranch, getRepoTree, getFileContent, getRepoConfig } from '../src/github/githubClient.js';
import { parseConfig } from '../src/config/configLoader.js';
import { runDocsGeneration } from '../src/agent/docsAgent.js';
import { generate as generateStaleDetection } from '../src/generators/staleDetector.js';
import { generate as generateArchitecture } from '../src/generators/architecture.js';
import { convertToMarkdown } from '../src/output/markdownWriter.js';
import { commitAndPR } from '../src/output/commitDocs.js';

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage:');
  console.error('  node scripts/generateDocs.js <owner/repo> <pr-number>');
  console.error('  node scripts/generateDocs.js <owner/repo> --scan');
  console.error('  node scripts/generateDocs.js <owner/repo> --arch');
  process.exit(1);
}

const [ownerRepo, target] = args;
const [owner, repo] = ownerRepo.split('/');

if (!owner || !repo) {
  console.error('Error: Repository must be in format owner/repo (e.g. acme/api)');
  process.exit(1);
}


if (!process.env.GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN environment variable is required');
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}

async function main() {
  console.log(`\nDocuBot Manual Trigger`);
  console.log(`Repository: ${owner}/${repo}`);
  console.log(`Target: ${target}\n`);

  const startTime = Date.now();

  try {
    if (target === '--scan') {
      await runStaleScan(owner, repo);
    } else if (target === '--arch') {
      await runArchitectureOverview(owner, repo);
    } else {
      const prNumber = parseInt(target, 10);
      if (isNaN(prNumber)) {
        console.error(`Error: "${target}" is not a valid PR number. Use --scan or --arch for other modes.`);
        process.exit(1);
      }
      await runPRDocs(owner, repo, prNumber);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nCompleted in ${duration}s`);
  } catch (err) {
    console.error('\nFailed:', err.message);
    if (process.env.NODE_ENV === 'development') {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

async function runPRDocs(owner, repo, prNumber) {
  console.log(`Fetching PR #${prNumber}...`);

  const prDetails = await getPRDetails(owner, repo, prNumber);
  console.log(`  Title: ${prDetails.title}`);
  console.log(`  Author: ${prDetails.author}`);
  console.log(`  Merged at: ${prDetails.mergedAt || 'not merged'}`);

  const defaultBranch = await getDefaultBranch(owner, repo);

  const result = await runDocsGeneration({
    type: 'docs-pr',
    owner,
    repoName: repo,
    prNumber,
    prTitle: prDetails.title,
    prDescription: prDetails.body || '',
    headSha: prDetails.mergeCommitSha || prDetails.headRef,
    baseSha: prDetails.baseRef,
    baseRef: defaultBranch,
    triggeredAt: new Date().toISOString(),
  }, (pct, msg) => {
    process.stdout.write(`\r  [${pct.toString().padStart(3)}%] ${msg.padEnd(50)}`);
  });

  console.log('\n');
  console.log(`Files generated: ${result.filesGenerated}`);
  if (result.prUrl) {
    console.log(`Documentation PR: ${result.prUrl}`);
  }
}

async function runStaleScan(owner, repo) {
  console.log('Running stale documentation scan...');

  const defaultBranch = await getDefaultBranch(owner, repo);
  const configYaml = await getRepoConfig(owner, repo, defaultBranch).catch(() => null);
  const config = parseConfig(configYaml);

  console.log('  Fetching repository tree...');
  const tree = await getRepoTree(owner, repo, defaultBranch);
  const fileTree = tree.map((f) => f.path).join('\n');

  const docPaths = tree
    .filter((f) => f.path.startsWith('docs/') || f.path === 'README.md')
    .slice(0, 10);

  console.log(`  Found ${docPaths.length} documentation files`);

  let docFilesContent = '';
  for (const docFile of docPaths) {
    const content = await getFileContent(owner, repo, docFile.path, defaultBranch).catch(() => null);
    if (content) {
      docFilesContent += `## ${docFile.path}\n${content.slice(0, 3000)}\n\n`;
    }
  }

  const sourceFiles = tree
    .filter((f) => /\.(js|ts|py|go|java)$/.test(f.path))
    .filter((f) => !f.path.includes('node_modules') && !f.path.includes('test'))
    .slice(0, 5);

  let keySourceFiles = '';
  for (const sf of sourceFiles) {
    const content = await getFileContent(owner, repo, sf.path, defaultBranch).catch(() => null);
    if (content) {
      keySourceFiles += `## ${sf.path}\n\`\`\`\n${content.slice(0, 2000)}\n\`\`\`\n\n`;
    }
  }

  const envExample = await getFileContent(owner, repo, '.env.example', defaultBranch).catch(() => null);

  console.log('  Running stale detection analysis...');
  const result = await generateStaleDetection({
    DOC_FILES_CONTENT: docFilesContent || '(No documentation files found)',
    FILE_TREE: fileTree,
    KEY_SOURCE_FILES: keySourceFiles || '(No source files found)',
    ENV_EXAMPLE: envExample || '(No .env.example found)',
  }, config);

  console.log('\nStale Detection Results:');
  console.log(`  Overall health: ${result.overall_health}`);
  if (result.summary) {
    console.log(`  Total issues: ${result.summary.total_issues}`);
    console.log(`  Critical: ${result.summary.critical}`);
    console.log(`  High: ${result.summary.high}`);
    console.log(`  Medium: ${result.summary.medium}`);
    console.log(`  Low: ${result.summary.low}`);
  }

  const md = convertToMarkdown(result);
  if (md) {
    const { prUrl } = await commitAndPR(owner, repo, [md], config, {
      baseBranch: defaultBranch,
    });
    if (prUrl) console.log(`\nReport PR: ${prUrl}`);
  }
}

async function runArchitectureOverview(owner, repo) {
  console.log('Generating architecture overview...');

  const defaultBranch = await getDefaultBranch(owner, repo);
  const configYaml = await getRepoConfig(owner, repo, defaultBranch).catch(() => null);
  const config = parseConfig(configYaml);

  console.log('  Fetching repository tree...');
  const tree = await getRepoTree(owner, repo, defaultBranch);
  const fileTree = tree.map((f) => f.path).join('\n');

  const packageJson = await getFileContent(owner, repo, 'package.json', defaultBranch).catch(() => null);

  const keyFilePaths = tree
    .filter((f) => {
      const name = f.path.split('/').pop();
      return ['index.js', 'index.ts', 'main.js', 'main.ts', 'app.js', 'app.ts', 'server.js'].includes(name);
    })
    .slice(0, 5);

  let keyFilesContent = '';
  for (const kf of keyFilePaths) {
    const content = await getFileContent(owner, repo, kf.path, defaultBranch).catch(() => null);
    if (content) {
      keyFilesContent += `## ${kf.path}\n\`\`\`javascript\n${content.slice(0, 3000)}\n\`\`\`\n\n`;
    }
  }

  console.log('  Running architecture analysis...');
  const result = await generateArchitecture({
    FILE_TREE: fileTree,
    KEY_FILES_CONTENT: keyFilesContent || '(No key files found)',
    PACKAGE_JSON: packageJson || '{}',
  }, config);

  console.log(`\nArchitecture: ${result.one_liner || ''}`);
  console.log(`Pattern: ${result.architecture_pattern || ''}`);

  const md = convertToMarkdown(result);
  if (md) {
    const { prUrl } = await commitAndPR(owner, repo, [md], config, {
      baseBranch: defaultBranch,
    });
    if (prUrl) console.log(`\nArchitecture doc PR: ${prUrl}`);
  }
}

main();
