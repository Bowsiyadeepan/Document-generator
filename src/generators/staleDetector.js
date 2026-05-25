import { callClaude, injectVariables, DOCUBOT_SYSTEM_PROMPT } from '../agent/llmWriter.js';

const PROMPT_TEMPLATE = `Analyze the following documentation files against the current codebase and identify everything that is outdated, missing, or incorrect.

## Documentation Files
{{DOC_FILES_CONTENT}}

## Current Codebase

### Directory Structure
\`\`\`
{{FILE_TREE}}
\`\`\`

### Key Source Files
{{KEY_SOURCE_FILES}}

### .env.example
\`\`\`
{{ENV_EXAMPLE}}
\`\`\`

## What to Flag as Stale
- Documented functions that no longer exist in the code
- Function signatures in docs that do not match current code
- Code examples that reference removed or renamed imports
- Environment variables in docs that no longer exist in .env.example
- API endpoints in docs that do not match current routes
- Installation steps that reference outdated package versions

## What NOT to flag
- Minor wording differences that do not affect accuracy
- Additional context in docs beyond what is in code (that is fine)
- Style or formatting issues

## Severity Levels
- critical -- incorrect info that will break a developer's setup
- high -- significantly wrong info that wastes significant time
- medium -- outdated but developer can figure it out
- low -- minor inaccuracy unlikely to cause confusion

Respond with this exact JSON structure:
{
  "doc_type": "stale_detection",
  "confidence": "high|medium|low",
  "analyzed_at": "{{TIMESTAMP}}",
  "overall_health": "good|degraded|poor",
  "stale_items": [
    {
      "severity": "critical|high|medium|low",
      "doc_file": "README.md",
      "doc_section": "Environment Variables",
      "stale_content": "The exact stale text from the doc",
      "reason": "Why this is stale",
      "suggested_fix": "Exact replacement text or action",
      "auto_fixable": true
    }
  ],
  "missing_docs": [
    {
      "severity": "high",
      "what": "Description of what is missing",
      "suggested_action": "What to do about it"
    }
  ],
  "summary": {
    "total_issues": 0,
    "critical": 0,
    "high": 0,
    "medium": 0,
    "low": 0,
    "auto_fixable": 0
  },
  "flags": []
}`;

/**
 * Scans documentation files against the codebase to find stale or missing content.
 *
 * @param {{DOC_FILES_CONTENT, FILE_TREE, KEY_SOURCE_FILES, ENV_EXAMPLE}} inputs
 * @param {object} config
 * @returns {Promise<object>} Stale detection report JSON
 */
export async function generate(inputs, config) {
  console.log('[staleDetector] Scanning for stale documentation...');

  const prompt = injectVariables(PROMPT_TEMPLATE, {
    ENV_EXAMPLE: inputs.ENV_EXAMPLE || '(No .env.example found)',
    TIMESTAMP: new Date().toISOString(),
    ...inputs,
  });

  const result = await callClaude(DOCUBOT_SYSTEM_PROMPT, prompt, { maxTokens: 4096 });

  const total = result.summary?.total_issues ?? 0;
  const health = result.overall_health ?? 'unknown';
  console.log(`[staleDetector] Done -- health: ${health}, issues: ${total}`);
  return result;
}
