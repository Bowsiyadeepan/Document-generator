import { callClaude, injectVariables, DOCUBOT_SYSTEM_PROMPT } from '../agent/llmWriter.js';

const PROMPT_TEMPLATE = `Analyze the following source code file and generate complete API reference documentation.

File path: {{FILE_PATH}}
Language: {{LANGUAGE}}

## Detection Rules
Identify all exported symbols: functions (async/sync), classes and public methods, REST route handlers, TypeScript interfaces/types, constants and enums that are part of the public API.

## Skip
- Private/internal functions (not exported)
- Auto-generated code
- Test helpers and fixtures
- Simple getters that just return a property with no logic

## For Each Export, Document
1. SIGNATURE - exact function/method signature with types
2. PURPOSE - one sentence: what it does, not how
3. PARAMETERS - name, type, required/optional, constraints, default if optional
4. RETURN - type, exact shape, what each field means
5. ERRORS - every exception with the exact condition that triggers it
6. EXAMPLE - realistic, working code snippet with production-like values
7. SIDE EFFECTS - DB writes, external API calls, file system changes, events emitted
8. NOTES - rate limits, performance warnings, deprecation notices

## Source Code
\`\`\`
{{FILE_CONTENT}}
\`\`\`

Respond with this exact JSON structure:
{
  "doc_type": "api_reference",
  "confidence": "high|medium|low",
  "file": "{{FILE_PATH}}",
  "language": "{{LANGUAGE}}",
  "last_analyzed": "{{TIMESTAMP}}",
  "module_description": "One sentence describing what this module does overall",
  "exports": [
    {
      "name": "functionName",
      "type": "async_function|sync_function|class|method|route|type|constant",
      "http_method": null,
      "http_path": null,
      "signature": "functionName(param: Type): ReturnType",
      "description": "One sentence description",
      "params": [
        {
          "name": "paramName",
          "type": "string",
          "required": true,
          "constraints": "Must be a valid email format",
          "example": "jane@acme.com"
        }
      ],
      "returns": {
        "type": "Promise<User>",
        "description": "Resolves with the created user",
        "shape": {}
      },
      "throws": [
        { "error": "ErrorName", "condition": "Exact condition that triggers this" }
      ],
      "example": "// Working code example\\nconst result = await functionName('example_value');",
      "side_effects": [],
      "notes": null
    }
  ],
  "flags": []
}`;

/**
 * Generates API reference documentation for a single source file.
 *
 * @param {{FILE_PATH: string, FILE_CONTENT: string, LANGUAGE: string}} inputs
 * @param {object} config
 * @returns {Promise<object>} API reference JSON
 */
export async function generate(inputs, config) {
  console.log(`[apiReference] Generating API reference for ${inputs.FILE_PATH}`);

  const prompt = injectVariables(PROMPT_TEMPLATE, {
    ...inputs,
    TIMESTAMP: new Date().toISOString(),
  });

  const result = await callClaude(DOCUBOT_SYSTEM_PROMPT, prompt);
  console.log(`[apiReference] Done -- confidence: ${result.confidence}, exports: ${result.exports?.length ?? 0}`);
  return result;
}
