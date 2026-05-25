import { getPRFiles, getPRDetails, getFileContent, getRepoTree, getRepoConfig, getDefaultBranch, compareCommits } from '../github/githubClient.js';
import { parseConfig } from '../config/configLoader.js';
import { detectBreakingChanges, filterSourceFiles, detectLanguage } from './diffParser.js';
import { convertToMarkdown } from '../output/markdownWriter.js';
import { commitAndPR } from '../output/commitDocs.js';

import { generate as generateApiReference } from '../generators/apiReference.js';
import { generate as generateChangelog } from '../generators/changelog.js';
import { generate as generateReadmeUpdate } from '../generators/readmeUpdater.js';
import { generate as generateMigration } from '../generators/migration.js';
import { generate as generateArchitecture } from '../generators/architecture.js';
import { generate as generateDocstrings } from '../generators/docstrings.js';
import { generate as generateOnboarding } from '../generators/onboarding.js';
import { generate as generateRunbook } from '../generators/runbook.js';
import { generate as generateStaleDetection } from '../generators/staleDetector.js';

const MAX_CONCURRENCY = 3;
const MAX_FILE_SIZE_CHARS = 50_000;

/**
 * Main orchestrator. Runs the full documentation generation pipeline for a job.
 *
 * @param {object} jobData - Job payload from the queue
 * @param {Function} [onProgress] - Progress callback (percent, message) => void
 * @returns {Promise<{filesGenerated: number, prUrl: string|null, duration: number}>}
 */
export async function runDocsGeneration(jobData, onProgress = () => {}) {
  const startTime = Date.now();
  const { owner, repoName: repo, prNumber, headSha, baseSha, baseRef } = jobData;

  console.log(`[agent] Starting docs generation for ${owner}/${repo} (${jobData.type})`);
  onProgress(5, 'Fetching repo config...');

  // 1. Load config
  const configYaml = await getRepoConfig(owner, repo, headSha).catch(() => null);
  const config = parseConfig(configYaml);

  if (!config.enabled) {
    console.log('[agent] DocuBot is disabled for this repo (.docsbot.yaml: enabled: false)');
    return { filesGenerated: 0, prUrl: null, duration: Date.now() - startTime };
  }

  onProgress(10, 'Fetching PR data...');

  // 2. Fetch PR files and details
  let prFiles = [];
  let prDetails = null;
  let defaultBranch = baseRef || 'main';
  let repoTree = [];

  try {
    defaultBranch = await getDefaultBranch(owner, repo);
  } catch {
    console.warn('[agent] Could not fetch default branch -- using baseRef or "main"');
  }

  const dataFetches = [];
  if (jobData.type === 'docs-pr' && prNumber) {
    dataFetches.push(getPRFiles(owner, repo, prNumber).then(f => prFiles = f));
    dataFetches.push(getPRDetails(owner, repo, prNumber).then(d => prDetails = d));
  } else if (jobData.type === 'docs-push' && baseSha && headSha) {
    dataFetches.push(compareCommits(owner, repo, baseSha, headSha).then(f => prFiles = f));
  }
  dataFetches.push(getRepoTree(owner, repo, headSha).then(t => repoTree = t));

  await Promise.all(dataFetches);

  onProgress(20, 'Analyzing changes...');

  // 3. Filter to source files
  const sourceFiles = filterSourceFiles(prFiles, config);
  console.log(`[agent] ${sourceFiles.length} source files to document (of ${prFiles.length} changed)`);

  // 4. Detect breaking changes
  const { breaking, reasons: breakingReasons } = detectBreakingChanges(prFiles);
  if (breaking) {
    console.log(`[agent] Breaking changes detected: ${breakingReasons.join(', ')}`);
  }

  onProgress(25, 'Fetching file contents...');

  // 5. Fetch content for source files + key context files
  const fileContents = await fetchFileContents(owner, repo, sourceFiles, headSha, repoTree);

  // 6. Build generator tasks
  onProgress(30, 'Building generator tasks...');

  const tasks = buildTasks({
    config, owner, repo, prNumber, prDetails, prFiles,
    sourceFiles, fileContents, breaking, headSha, defaultBranch, repoTree,
  });

  console.log(`[agent] Running ${tasks.length} generator tasks...`);

  // 7. Run generators with concurrency limit
  onProgress(35, `Running ${tasks.length} generators...`);

  const results = await runWithConcurrency(tasks, MAX_CONCURRENCY, (completed, total) => {
    const pct = 35 + Math.floor((completed / total) * 45);
    onProgress(pct, `Completed ${completed}/${total} generators`);
  });

  const successfulResults = results.filter((r) => r !== null && r.doc_type !== 'error');
  console.log(`[agent] ${successfulResults.length}/${results.length} generators succeeded`);

  // 8. Convert to markdown
  onProgress(82, 'Converting to markdown...');

  const markdownFiles = [];
  for (const result of successfulResults) {
    try {
      const md = convertToMarkdown(result, {
        prNumber,
        version: prDetails?.headRef || 'next',
        baseBranch: defaultBranch,
      });
      if (md) markdownFiles.push(md);
    } catch (err) {
      console.error(`[agent] Failed to convert ${result.doc_type} to markdown:`, err.message);
    }
  }

  console.log(`[agent] Generated ${markdownFiles.length} markdown files`);

  if (markdownFiles.length === 0) {
    console.log('[agent] No markdown files to commit');
    return { filesGenerated: 0, prUrl: null, duration: Date.now() - startTime };
  }

  // 9. Commit docs
  onProgress(90, 'Committing documentation...');

  const { prUrl, filesCommitted } = await commitAndPR(owner, repo, markdownFiles, config, {
    prNumber,
    prTitle: prDetails?.title || jobData.prTitle,
    baseBranch: defaultBranch,
  });

  const duration = Date.now() - startTime;
  onProgress(100, 'Done');

  console.log(`[agent] Completed in ${(duration / 1000).toFixed(1)}s -- ${filesCommitted} files, PR: ${prUrl || 'none'}`);

  return { filesGenerated: filesCommitted, prUrl, duration };
}

// Build the list of generator tasks based on config and PR data
function buildTasks({
  config, owner, repo, prNumber, prDetails, prFiles,
  sourceFiles, fileContents, breaking, headSha, defaultBranch, repoTree,
}) {
  const tasks = [];
  const gen = config.generators;

  const prDiff = prFiles.map((f) => `--- ${f.filename}\n${f.patch || ''}`).join('\n\n');
  const filesChanged = prFiles.map((f) => f.filename).join(', ');
  const fileTreeStr = repoTree.map((f) => f.path).join('\n');

  // Helper for architecture and onboarding
  const contextInputs = {
    PACKAGE_JSON: fileContents['package.json'] || '{}',
    FILE_TREE: fileTreeStr,
    ENV_EXAMPLE: fileContents['.env.example'] || fileContents['.env'] || '',
    README: fileContents['README.md'] || '',
    KEY_FILES_CONTENT: Object.entries(fileContents)
      .filter(([path]) => path.includes('index') || path.includes('main') || path.includes('server') || path.includes('app'))
      .map(([path, content]) => `File: ${path}\n\`\`\`\n${truncate(content, 2000)}\n\`\`\``)
      .join('\n\n'),
  };

  // 1. Changelog
  if (gen.changelog && prDetails) {
    tasks.push(async () => generateChangelog({
      PR_TITLE: prDetails.title,
      PR_NUMBER: String(prNumber),
      PR_AUTHOR: prDetails.author,
      PR_DESCRIPTION: prDetails.body || '',
      MERGED_AT: prDetails.mergedAt || new Date().toISOString(),
      FILES_CHANGED: filesChanged,
      PR_DIFF: truncate(prDiff, 15000),
    }, config));
  }

  // 2. README update
  if (gen.readme_update && prDetails) {
    tasks.push(async () => {
      const currentReadme = fileContents['README.md'] || '';
      return generateReadmeUpdate({
        CURRENT_README: truncate(currentReadme, 10000),
        PR_TITLE: prDetails.title,
        PR_DESCRIPTION: prDetails.body || '',
        FILES_CHANGED: filesChanged,
        PR_DIFF: truncate(prDiff, 10000),
      }, config);
    });
  }

  // 3. Migration guide
  if (gen.migration_guide && breaking && prDetails) {
    tasks.push(async () => generateMigration({
      PR_TITLE: prDetails.title,
      PR_DESCRIPTION: prDetails.body || '',
      PR_DIFF: truncate(prDiff, 15000),
      FILES_CHANGED: filesChanged,
      BASE_VERSION: prDetails.baseRef || 'previous',
      HEAD_VERSION: prDetails.headRef || 'next',
    }, config));
  }

  // 4. API Reference
  if (gen.api_reference) {
    for (const file of sourceFiles) {
      const content = fileContents[file.filename];
      if (!content) continue;
      const language = detectLanguage(file.filename);
      const capturedFile = file;
      const capturedContent = content;
      const capturedLang = language;
      tasks.push(async () => generateApiReference({
        FILE_PATH: capturedFile.filename,
        FILE_CONTENT: truncate(capturedContent, 20000),
        LANGUAGE: capturedLang,
      }, config));
    }
  }

  // 5. Architecture Overview
  if (gen.architecture) {
    tasks.push(async () => generateArchitecture(contextInputs, config));
  }

  // 6. Onboarding Guide
  if (gen.onboarding) {
    tasks.push(async () => generateOnboarding(contextInputs, config));
  }

  // 7. Runbook
  if (gen.runbook && prDetails) {
    tasks.push(async () => generateRunbook({
      SERVICE_NAME: repo,
      SERVICE_DESCRIPTION: prDetails.body || '',
      DEPLOYMENT_DIFF: truncate(prDiff, 10000),
      INFRASTRUCTURE_CONFIG: fileContents['Dockerfile'] || fileContents['docker-compose.yml'] || '',
    }, config));
  }

  // 8. Stale Detection
  if (gen.stale_detection) {
    tasks.push(async () => generateStaleDetection({
      DOC_FILES_CONTENT: Object.entries(fileContents)
        .filter(([path]) => path.endsWith('.md') && path !== 'README.md')
        .map(([path, content]) => `File: ${path}\n\`\`\`\n${truncate(content, 5000)}\n\`\`\``)
        .join('\n\n'),
      FILE_TREE: fileTreeStr,
      KEY_SOURCE_FILES: contextInputs.KEY_FILES_CONTENT,
      ENV_EXAMPLE: contextInputs.ENV_EXAMPLE,
    }, config));
  }

  // 9. Docstrings
  if (gen.docstrings) {
    for (const file of sourceFiles) {
      const content = fileContents[file.filename];
      if (!content) continue;
      const language = detectLanguage(file.filename);
      const capturedFile = file;
      const capturedContent = content;
      const capturedLang = language;
      tasks.push(async () => generateDocstrings({
        FILE_PATH: capturedFile.filename,
        FILE_CONTENT: truncate(capturedContent, 20000),
        LANGUAGE: capturedLang,
      }, config));
    }
  }

  return tasks;
}

// Fetches file contents for source files + key context files
async function fetchFileContents(owner, repo, sourceFiles, ref, repoTree) {
  const contentMap = {};

  const coreFiles = ['README.md', 'package.json', '.env.example', 'Dockerfile', 'docker-compose.yml'];
  
  // Also fetch all markdown files for stale detection
  const mdFiles = repoTree
    .filter(f => f.path.endsWith('.md') && !coreFiles.includes(f.path))
    .map(f => f.path);

  const filesToFetch = [
    ...new Set([
      ...sourceFiles.map((f) => f.filename),
      ...coreFiles,
      ...mdFiles,
    ])
  ];

  await Promise.all(
    filesToFetch.map(async (filename) => {
      try {
        const content = await getFileContent(owner, repo, filename, ref);
        if (content && content.length <= MAX_FILE_SIZE_CHARS) {
          contentMap[filename] = content;
        } else if (content) {
          console.warn(`[agent] Skipping ${filename} -- too large (${content.length} chars)`);
        }
      } catch (err) {
        // Core files failing is fine, we just won't have them
        if (!coreFiles.includes(filename) && !mdFiles.includes(filename)) {
          console.warn(`[agent] Could not fetch ${filename}: ${err.message}`);
        }
      }
    })
  );

  return contentMap;
}

// Runs async task functions with a maximum concurrency
async function runWithConcurrency(tasks, concurrency, onProgress) {
  const results = new Array(tasks.length).fill(null);
  let index = 0;
  let completed = 0;

  async function worker() {
    while (index < tasks.length) {
      const taskIndex = index++;
      try {
        results[taskIndex] = await tasks[taskIndex]();
      } catch (err) {
        console.error(`[agent] Task ${taskIndex} failed:`, err.message);
        results[taskIndex] = null;
      }
      completed++;
      onProgress(completed, tasks.length);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
  await Promise.all(workers);

  return results;
}

// Truncates a string to a maximum character count
function truncate(str, maxChars) {
  if (!str) return '';
  if (str.length <= maxChars) return str;
  return str.slice(0, maxChars) + `\n\n[... truncated at ${maxChars} chars ...]`;
}
