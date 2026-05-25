import { callClaude, injectVariables, DOCUBOT_SYSTEM_PROMPT } from '../agent/llmWriter.js';

const PROMPT_TEMPLATE = `Add documentation comments to every undocumented or poorly documented function in this file.

File: {{FILE_PATH}}
Language: {{LANGUAGE}}

## Language-Specific Format Rules
- JavaScript/TypeScript -> JSDoc (/** ... */)
- Python -> Google-style docstrings
- Java/Kotlin -> Javadoc
- Go -> GoDoc (comment directly above func, no special syntax)
- Ruby -> YARD
- Rust -> /// comments

## Writing Rules
- One sentence summary -- what it does, not how
- Document params only when the name + type is not self-explanatory
- Use real example values (not "value", "data", "string")
- If a function is genuinely obvious (e.g., getId()), write a minimal one-liner
- Never change the function's code -- only add/update the comment above it
- If existing docstring is present but wrong/incomplete, fix it

## Source Code
\`\`\`{{LANGUAGE}}
{{FILE_CONTENT}}
\`\`\`

Respond with this exact JSON structure:
{
  "doc_type": "inline_docstrings",
  "confidence": "high|medium|low",
  "file": "{{FILE_PATH}}",
  "language": "{{LANGUAGE}}",
  "functions_documented": [
    {
      "function_name": "functionName",
      "line_number": 42,
      "was_documented": false,
      "original_signature": "function functionName(param1, param2) {",
      "docstring": "/**\\n * One sentence description.\\n *\\n * @param {string} param1 - Description\\n * @returns {Promise<object>} Description\\n */"
    }
  ],
  "functions_skipped": [
    { "function_name": "getId", "reason": "Trivial getter -- self-documenting" }
  ],
  "patched_file_content": "Complete file content with all docstrings inserted",
  "flags": []
}`;

/**
 * Generates inline documentation comments for undocumented functions in a source file.
 *
 * @param {{FILE_PATH, FILE_CONTENT, LANGUAGE}} inputs
 * @param {object} config
 * @returns {Promise<object>} Docstrings JSON with patched file content
 */
export async function generate(inputs, config) {
  console.log(`[docstrings] Generating docstrings for ${inputs.FILE_PATH}`);

  const prompt = injectVariables(PROMPT_TEMPLATE, inputs);
  const result = await callClaude(DOCUBOT_SYSTEM_PROMPT, prompt);

  const documented = result.functions_documented?.length ?? 0;
  const skipped = result.functions_skipped?.length ?? 0;
  console.log(`[docstrings] Done -- documented: ${documented}, skipped: ${skipped}`);
  return result;
}
