import { callClaude, injectVariables, DOCUBOT_SYSTEM_PROMPT } from '../agent/llmWriter.js';

const PROMPT_TEMPLATE = `A pull request introduces breaking changes. Write a step-by-step migration guide for developers upgrading to this version.

## PR Data
- Title: {{PR_TITLE}}
- Description: {{PR_DESCRIPTION}}
- Base version: {{BASE_VERSION}}
- Head version: {{HEAD_VERSION}}
- Files changed: {{FILES_CHANGED}}

## Diff
\`\`\`diff
{{PR_DIFF}}
\`\`\`

## Your Audience
A developer who:
- Has never read this PR
- Is running the previous version in production
- Needs to upgrade with zero downtime if possible
- Will follow your steps exactly as written

## Breaking Change Detection
Look for: renamed/removed functions, changed signatures, renamed/removed API endpoints, changed request/response schemas, renamed env vars, changed config format, changed CLI commands.

## Writing Rules
- Number every step -- sequential, no skipping
- Show BEFORE and AFTER for every breaking change
- Use actual code from the diff, not invented examples
- Estimate realistic effort: trivial (<5 min), easy (<30 min), moderate (1-2 hrs), significant (half day+)
- If rollback is possible, explain exactly how
- Flag if any step is irreversible

Respond with this exact JSON structure:
{
  "doc_type": "migration_guide",
  "confidence": "high|medium|low",
  "from_version": "{{BASE_VERSION}}",
  "to_version": "{{HEAD_VERSION}}",
  "breaking": true,
  "effort": "trivial|easy|moderate|significant",
  "rollback_possible": true,
  "summary": "One paragraph summary of what changed and why",
  "steps": [
    {
      "step": 1,
      "title": "Step title",
      "description": "What needs to change and why",
      "effort": "trivial|easy|moderate|significant",
      "before": "// Old code\\nconst x = oldFunction();",
      "after": "// New code\\nconst x = newFunction();",
      "files_likely_affected": ["src/auth.js"],
      "irreversible": false
    }
  ],
  "env_vars_changed": [
    {
      "action": "rename|add|remove",
      "old_name": "OLD_VAR",
      "new_name": "NEW_VAR",
      "instructions": "Add NEW_VAR to your .env with the same value as OLD_VAR, then remove OLD_VAR"
    }
  ],
  "database_migrations": [],
  "rollback_steps": "Step-by-step rollback instructions",
  "flags": []
}`;

/**
 * Generates a migration guide for a PR that introduces breaking changes.
 *
 * @param {{PR_TITLE, PR_DESCRIPTION, PR_DIFF, FILES_CHANGED, BASE_VERSION, HEAD_VERSION}} inputs
 * @param {object} config
 * @returns {Promise<object>} Migration guide JSON
 */
export async function generate(inputs, config) {
  console.log('[migration] Generating migration guide...');

  const prompt = injectVariables(PROMPT_TEMPLATE, {
    BASE_VERSION: inputs.BASE_VERSION || 'previous',
    HEAD_VERSION: inputs.HEAD_VERSION || 'current',
    ...inputs,
  });

  const result = await callClaude(DOCUBOT_SYSTEM_PROMPT, prompt);
  console.log(`[migration] Done -- effort: ${result.effort}, steps: ${result.steps?.length ?? 0}`);
  return result;
}
