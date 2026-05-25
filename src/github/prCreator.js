import { Octokit } from '@octokit/rest';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  userAgent: 'DocuBot/1.0.0',
});

/**
 * Creates a new branch, commits all generated doc files in one commit,
 * and opens a pull request back to the base branch.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {Array<{path: string, content: string}>} files
 * @param {string} prTitle
 * @param {string} prBody
 * @param {string} baseBranch
 * @returns {Promise<string>} URL of the created PR
 */
export async function commitDocsPR(owner, repo, files, prTitle, prBody, baseBranch) {
  const timestamp = Date.now();
  const newBranch = `docs/auto-update-${timestamp}`;

  console.log(`[prCreator] Creating branch ${newBranch} from ${baseBranch}`);

  // Get the SHA of the base branch tip
  const { data: refData } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${baseBranch}`,
  });
  const baseSha = refData.object.sha;

  // Get the base commit to find the tree SHA
  const { data: baseCommit } = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: baseSha,
  });
  const baseTreeSha = baseCommit.tree.sha;

  // Create blobs for each file
  console.log(`[prCreator] Creating ${files.length} blobs...`);
  const blobs = await Promise.all(
    files.map(async (file) => {
      const { data: blob } = await octokit.git.createBlob({
        owner,
        repo,
        content: Buffer.from(file.content, 'utf8').toString('base64'),
        encoding: 'base64',
      });
      return {
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      };
    })
  );

  // Create a new tree with all the blobs
  const { data: newTree } = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha,
    tree: blobs,
  });

  // Create the commit
  const { data: newCommit } = await octokit.git.createCommit({
    owner,
    repo,
    message: `docs: auto-generated documentation update\n\n${prBody.slice(0, 500)}`,
    tree: newTree.sha,
    parents: [baseSha],
  });

  // Create the new branch pointing at the new commit
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${newBranch}`,
    sha: newCommit.sha,
  });

  console.log(`[prCreator] Branch ${newBranch} created at ${newCommit.sha}`);

  // Open the pull request
  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    title: prTitle,
    body: prBody,
    head: newBranch,
    base: baseBranch,
    draft: false,
  });

  console.log(`[prCreator] PR #${pr.number} opened: ${pr.html_url}`);
  return pr.html_url;
}

/**
 * Commits files directly to a branch without opening a PR.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {Array<{path: string, content: string}>} files
 * @param {string} branch
 * @param {string} message
 * @returns {Promise<string>} SHA of the new commit
 */
export async function commitDirectly(owner, repo, files, branch, message) {
  console.log(`[prCreator] Committing ${files.length} files directly to ${branch}`);

  const { data: refData } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });
  const baseSha = refData.object.sha;

  const { data: baseCommit } = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: baseSha,
  });

  const blobs = await Promise.all(
    files.map(async (file) => {
      const { data: blob } = await octokit.git.createBlob({
        owner,
        repo,
        content: Buffer.from(file.content, 'utf8').toString('base64'),
        encoding: 'base64',
      });
      return {
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      };
    })
  );

  const { data: newTree } = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseCommit.tree.sha,
    tree: blobs,
  });

  const { data: newCommit } = await octokit.git.createCommit({
    owner,
    repo,
    message,
    tree: newTree.sha,
    parents: [baseSha],
  });

  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });

  console.log(`[prCreator] Committed directly to ${branch}: ${newCommit.sha}`);
  return newCommit.sha;
}
