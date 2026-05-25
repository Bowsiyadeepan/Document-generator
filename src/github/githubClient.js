import { Octokit } from '@octokit/rest';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  userAgent: 'DocuBot/1.0.0',
});

/**
 * Fetches the list of files changed in a pull request.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {number} prNumber
 * @returns {Promise<Array<{filename, status, patch, additions, deletions}>>}
 */
export async function getPRFiles(owner, repo, prNumber) {
  try {
    const files = [];
    let page = 1;

    while (true) {
      const { data } = await octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
        page,
      });

      files.push(...data.map((f) => ({
        filename: f.filename,
        status: f.status,
        patch: f.patch || '',
        additions: f.additions,
        deletions: f.deletions,
        previousFilename: f.previous_filename || null,
      })));

      if (data.length < 100) break;
      page++;
    }

    console.log(`[github] Fetched ${files.length} files for PR #${prNumber}`);
    return files;
  } catch (err) {
    console.error(`[github] getPRFiles failed for PR #${prNumber}:`, err.message);
    throw err;
  }
}

/**
 * Fetches the raw content of a file at a specific ref.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} path - File path in the repo
 * @param {string} ref - Branch name, tag, or commit SHA
 * @returns {Promise<string|null>} File content as string, or null if not found
 */
export async function getFileContent(owner, repo, path, ref) {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref });

    if (data.type !== 'file') return null;

    return Buffer.from(data.content, 'base64').toString('utf8');
  } catch (err) {
    if (err.status === 404) return null;
    console.error(`[github] getFileContent failed for ${path}@${ref}:`, err.message);
    throw err;
  }
}

/**
 * Fetches the full file tree of a repository at a given ref.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} ref
 * @returns {Promise<Array<{path, type}>>}
 */
export async function getRepoTree(owner, repo, ref) {
  try {
    const { data } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: ref,
      recursive: 'true',
    });

    const EXCLUDED_PREFIXES = ['node_modules/', '.git/', 'dist/', 'build/', 'coverage/'];

    const files = data.tree
      .filter((item) => item.type === 'blob')
      .filter((item) => !EXCLUDED_PREFIXES.some((prefix) => item.path.startsWith(prefix)))
      .map((item) => ({
        path: item.path,
        type: item.type,
        size: item.size,
      }));

    console.log(`[github] Fetched repo tree: ${files.length} files at ${ref}`);
    return files;
  } catch (err) {
    console.error(`[github] getRepoTree failed at ${ref}:`, err.message);
    throw err;
  }
}

/**
 * Fetches metadata for a pull request.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {number} prNumber
 * @returns {Promise<object>}
 */
export async function getPRDetails(owner, repo, prNumber) {
  try {
    const { data: pr } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    return {
      title: pr.title,
      body: pr.body || '',
      labels: pr.labels.map((l) => l.name),
      draft: pr.draft,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
      baseRef: pr.base.ref,
      headRef: pr.head.ref,
      mergedAt: pr.merged_at,
      author: pr.user.login,
      mergeCommitSha: pr.merge_commit_sha,
    };
  } catch (err) {
    console.error(`[github] getPRDetails failed for PR #${prNumber}:`, err.message);
    throw err;
  }
}

/**
 * Fetches the .docsbot.yaml config file from the repo root.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} ref
 * @returns {Promise<string|null>}
 */
export async function getRepoConfig(owner, repo, ref) {
  return getFileContent(owner, repo, '.docsbot.yaml', ref);
}

/**
 * Compares two commits and returns the list of changed files.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} base - Base SHA
 * @param {string} head - Head SHA
 * @returns {Promise<Array<{filename, status, patch, additions, deletions}>>}
 */
export async function compareCommits(owner, repo, base, head) {
  try {
    const { data } = await octokit.repos.compareCommits({
      owner,
      repo,
      base,
      head,
    });

    return data.files.map((f) => ({
      filename: f.filename,
      status: f.status,
      patch: f.patch || '',
      additions: f.additions,
      deletions: f.deletions,
      previousFilename: f.previous_filename || null,
    }));
  } catch (err) {
    console.error(`[github] compareCommits failed for ${base}...${head}:`, err.message);
    throw err;
  }
}

/**
 * Returns the default branch name for a repository.
 *
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<string>} e.g. 'main'
 */
export async function getDefaultBranch(owner, repo) {
  try {
    const { data } = await octokit.repos.get({ owner, repo });
    return data.default_branch;
  } catch (err) {
    console.error(`[github] getDefaultBranch failed:`, err.message);
    throw err;
  }
}
