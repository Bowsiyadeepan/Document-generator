import { callClaude, injectVariables, DOCUBOT_SYSTEM_PROMPT } from '../agent/llmWriter.js';

const PROMPT_TEMPLATE = `A pull request has been merged. Generate a precise changelog entry.

## PR Data
- Title: {{PR_TITLE}}
- PR Number: {{PR_NUMBER}}
- Author: {{PR_AUTHOR}}
- Merged at: {{MERGED_AT}}
- Description: {{PR_DESCRIPTION}}
- Files changed: {{FILES_CHANGED}}

## Diff
\`\`\`diff
{{PR_DIFF}}
\`\`\`

## Changelog Categories -- pick the most accurate
- Added     -> new feature, endpoint, config option, or capability
- Changed   -> existing behavior modified
- Fixed     -> bug resolved
- Removed   -> feature, endpoint, or option deleted
- Deprecated -> still works but will be removed
- Security  -> vulnerability patched
- Performance -> measurable speed or resource improvement

## Analysis Steps
1. Read the PR title and description for intent
2. Read the file diffs for actual changes
3. Compare intent vs actual -- flag mismatches
4. Determine semantic version bump: patch (bug fixes), minor (new features), major (breaking changes)
5. Identify if migration steps are needed

## Writing Rules
- Write from the perspective of a developer consuming this project
- Never just copy the PR title -- explain the impact
- Breaking changes get BREAKING prefix
- Use past tense: "Added", "Fixed", "Changed"

Respond with this exact JSON structure:
{
  "doc_type": "changelog_entry",
  "confidence": "high|medium|low",
  "pr_number": {{PR_NUMBER}},
  "merged_at": "{{MERGED_AT}}",
  "version_bump": "major|minor|patch",
  "breaking": false,
  "entries": [
    {
      "category": "Fixed|Added|Changed|Removed|Deprecated|Security|Performance",
      "summary": "Specific description of what changed and why it matters",
      "impact": "How this affects developers using this project",
      "affects": ["ComponentName"],
      "migration_note": null
    }
  ],
  "internal_only": false,
  "flags": []
}`;

/**
 * Generates a changelog entry from a merged pull request.
 *
 * @param {{PR_TITLE, PR_NUMBER, PR_AUTHOR, PR_DESCRIPTION, MERGED_AT, FILES_CHANGED, PR_DIFF}} inputs
 * @param {object} config
 * @returns {Promise<object>} Changelog entry JSON
 */
export async function generate(inputs, config) {
  console.log(`[changelog] Generating changelog entry for PR #${inputs.PR_NUMBER}`);

  const prompt = injectVariables(PROMPT_TEMPLATE, inputs);
  const result = await callClaude(DOCUBOT_SYSTEM_PROMPT, prompt);

  console.log(`[changelog] Done -- version_bump: ${result.version_bump}, breaking: ${result.breaking}`);
  return result;
}
