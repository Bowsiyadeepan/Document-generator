import { callClaude, injectVariables, DOCUBOT_SYSTEM_PROMPT } from '../agent/llmWriter.js';

const PROMPT_TEMPLATE = `Analyze this entire codebase and generate a comprehensive architecture overview for developers joining this project.

## Your Audience
A developer with 3+ years of experience who has never seen this codebase. They need to understand the big picture in 10 minutes so they can start contributing.

## package.json
\`\`\`json
{{PACKAGE_JSON}}
\`\`\`

## Directory Structure
\`\`\`
{{FILE_TREE}}
\`\`\`

## Key File Contents
{{KEY_FILES_CONTENT}}

## Analysis Checklist
1. What does this project DO? (user-facing value, not tech description)
2. What architectural pattern is used? (MVC, event-driven, microservices, monolith, etc.)
3. How is the code organized? (by feature, by layer, by domain?)
4. What is the critical path? (most important flow from user action to response)
5. Where does data come from and where does it go?
6. What are the external dependencies and why do they exist?
7. What are the non-obvious things that would trip up a new developer?
8. What is the recommended reading order for a new developer?

## Writing Rules
- Name actual files and directories -- not abstract descriptions
- If you see a pattern (singleton, factory, observer), name it
- Highlight anything unusual or project-specific
- Flag anything that looks like tech debt or a known limitation
- No buzzwords: not "robust", "scalable", "seamless", "powerful"

Respond with this exact JSON structure:
{
  "doc_type": "architecture_overview",
  "confidence": "high|medium|low",
  "project_name": "Project name from package.json",
  "one_liner": "One sentence describing what this project does",
  "what_it_does": "2-3 sentence plain English description",
  "architecture_pattern": "Pattern name and brief description",
  "tech_stack": [
    { "name": "Node.js", "version": ">=20", "role": "Runtime", "why": "Why this was chosen" }
  ],
  "directory_structure": [
    {
      "path": "src/",
      "description": "All application source",
      "important": true,
      "children": [
        { "path": "src/index.js", "description": "Entry point description", "important": true }
      ]
    }
  ],
  "critical_path": [
    "1. Step one",
    "2. Step two"
  ],
  "data_flow": {
    "inputs": ["Input source 1"],
    "processing": ["Processing step 1"],
    "outputs": ["Output 1"]
  },
  "external_services": [
    {
      "name": "Service name",
      "purpose": "What it does",
      "auth": "How it authenticates",
      "what_breaks_if_down": "Impact if unavailable"
    }
  ],
  "key_files_to_read_first": [
    { "file": "src/index.js", "why": "Entry point -- start here", "read_order": 1 }
  ],
  "non_obvious_things": [
    "Non-obvious thing 1"
  ],
  "known_limitations": [],
  "flags": []
}`;

/**
 * Generates a comprehensive architecture overview for an entire codebase.
 *
 * @param {{FILE_TREE, KEY_FILES_CONTENT, PACKAGE_JSON}} inputs
 * @param {object} config
 * @returns {Promise<object>} Architecture overview JSON
 */
export async function generate(inputs, config) {
  console.log('[architecture] Generating architecture overview...');

  const prompt = injectVariables(PROMPT_TEMPLATE, inputs);
  const result = await callClaude(DOCUBOT_SYSTEM_PROMPT, prompt, { maxTokens: 4096 });

  console.log(`[architecture] Done -- confidence: ${result.confidence}`);
  return result;
}
