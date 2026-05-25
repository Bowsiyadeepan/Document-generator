import { callClaude, injectVariables, DOCUBOT_SYSTEM_PROMPT } from '../agent/llmWriter.js';

const PROMPT_TEMPLATE = `A pull request has been merged. Determine if the project README needs updating and generate the exact updated content if so.

## Current README
\`\`\`markdown
{{CURRENT_README}}
\`\`\`

## PR Data
- Title: {{PR_TITLE}}
- Description: {{PR_DESCRIPTION}}
- Files changed: {{FILES_CHANGED}}

## Diff
\`\`\`diff
{{PR_DIFF}}
\`\`\`

## Update README only if the PR
- Adds or removes a user-facing feature
- Changes installation or setup steps
- Adds, removes, or renames environment variables
- Changes CLI commands, flags, or arguments
- Changes public API endpoints or their behavior
- Adds new required dependencies
- Changes the configuration file format
- Changes deployment requirements

## Skip README update if the PR
- Only changes internal implementation details
- Only adds or modifies tests
- Only refactors without behavior change
- Only fixes a bug without changing documented behavior
- Only updates dependencies with no API changes

## Merge Rules When Updating
- Preserve all existing README sections not affected by this PR
- Do not change the README's voice or formatting style
- Add new sections at the logical position
- Keep all existing links and badges intact

Respond with this exact JSON structure.

If update needed:
{
  "doc_type": "readme_update",
  "confidence": "high|medium|low",
  "needs_update": true,
  "reason": "Specific reason why README needs updating",
  "sections_changed": ["Section Name"],
  "updated_readme": "# Full updated README in markdown -- complete file, not just changed sections",
  "diff_summary": "Brief description of what changed in the README",
  "flags": []
}

If no update needed:
{
  "doc_type": "readme_update",
  "confidence": "high",
  "needs_update": false,
  "reason": "Specific reason why README does not need updating",
  "flags": []
}`;

/**
 * Determines if a README needs updating after a PR merge, and generates the update if so.
 *
 * @param {{CURRENT_README, PR_TITLE, PR_DESCRIPTION, FILES_CHANGED, PR_DIFF}} inputs
 * @param {object} config
 * @returns {Promise<object>} README update JSON
 */
export async function generate(inputs, config) {
  console.log('[readmeUpdater] Checking if README needs updating...');

  const prompt = injectVariables(PROMPT_TEMPLATE, inputs);
  const result = await callClaude(DOCUBOT_SYSTEM_PROMPT, prompt);

  console.log(`[readmeUpdater] Done -- needs_update: ${result.needs_update}`);
  return result;
}
