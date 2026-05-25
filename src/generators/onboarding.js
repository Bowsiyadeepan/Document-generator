import { callClaude, injectVariables, DOCUBOT_SYSTEM_PROMPT } from '../agent/llmWriter.js';

const PROMPT_TEMPLATE = `Generate a complete Getting Started guide for a developer joining this project for the first time.

## Goal
Zero to running locally in under 20 minutes. Every step must work exactly as written.

## Project Context

### package.json
\`\`\`json
{{PACKAGE_JSON}}
\`\`\`

### Directory Structure
\`\`\`
{{FILE_TREE}}
\`\`\`

### .env.example
\`\`\`
{{ENV_EXAMPLE}}
\`\`\`

### README (if exists)
\`\`\`markdown
{{README}}
\`\`\`

## Mandatory Sections (in this order)
1. Prerequisites -- tools, versions, accounts needed BEFORE starting
2. Clone & Install -- exact terminal commands
3. Environment Setup -- every env variable explained with real example values
4. External Services Setup -- any accounts or APIs needed
5. Start Locally -- commands to run all processes (include how many terminals needed)
6. Verify It Works -- specific thing to check that confirms success
7. Run Tests -- command + what passing output looks like
8. Common Mistakes -- top 5 problems new developers actually hit

## Writing Rules
- Every command is copy-pasteable
- State expected output after significant commands
- Note when steps differ on Mac vs Linux vs Windows
- Call out common pitfalls explicitly
- No forward references -- each step stands alone

Respond with this exact JSON structure:
{
  "doc_type": "onboarding_guide",
  "confidence": "high|medium|low",
  "project_name": "Project name",
  "estimated_setup_time": "15 minutes",
  "prerequisites": [
    {
      "tool": "Node.js",
      "version": ">=20.0.0",
      "check_command": "node --version",
      "install_url": "https://nodejs.org",
      "notes": "Optional notes"
    }
  ],
  "sections": [
    {
      "title": "Clone & Install",
      "steps": [
        {
          "instruction": "Clone the repository",
          "command": "git clone https://github.com/your-org/repo.git && cd repo",
          "expected_output": null,
          "duration_seconds": 10,
          "pitfall": null
        }
      ]
    }
  ],
  "verify_success": {
    "instruction": "Check the health endpoint",
    "command": "curl http://localhost:3000/health",
    "expected_output": "{\\"status\\":\\"ok\\"}"
  },
  "run_tests": {
    "command": "npm test",
    "expected_output": "All tests passed"
  },
  "common_mistakes": [
    {
      "problem": "Problem description",
      "cause": "Root cause",
      "fix": "Exact fix command or steps"
    }
  ],
  "flags": []
}`;

/**
 * Generates a complete Getting Started / onboarding guide for a project.
 *
 * @param {{FILE_TREE, PACKAGE_JSON, ENV_EXAMPLE, README}} inputs
 * @param {object} config
 * @returns {Promise<object>} Onboarding guide JSON
 */
export async function generate(inputs, config) {
  console.log('[onboarding] Generating onboarding guide...');

  const prompt = injectVariables(PROMPT_TEMPLATE, {
    README: inputs.README || '(No README found)',
    ENV_EXAMPLE: inputs.ENV_EXAMPLE || '(No .env.example found)',
    ...inputs,
  });

  const result = await callClaude(DOCUBOT_SYSTEM_PROMPT, prompt, { maxTokens: 4096 });
  console.log(`[onboarding] Done -- estimated_setup_time: ${result.estimated_setup_time}`);
  return result;
}
