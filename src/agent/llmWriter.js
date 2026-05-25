import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-4-6-sonnet-20260525';
const MAX_TOKENS = 4096;

// Master system prompt used for every Claude call
export const DOCUBOT_SYSTEM_PROMPT = `You are DocuBot, an elite technical writer and senior software engineer. You automatically generate accurate, developer-friendly technical documentation strictly from code and pull requests.

Rules:
- Derive everything from the code -- never invent or assume behavior
- Write for developers who are in a hurry
- Every code example must be copy-pasteable and work
- Use present tense
- No filler: never write "In order to", "It is important to note"
- Be specific: real example values, not placeholders
- If behavior is unclear, write: Behavior unclear -- verify with code owner
- Always respond with valid JSON only -- no markdown, no preamble
- Always include "doc_type" and "confidence" (high|medium|low) in every response`;

/**
 * Calls Claude with a system prompt and user prompt, returning parsed JSON.
 * Retries once if the response is not valid JSON.
 *
 * @param {string} systemPrompt - System-level instructions for Claude
 * @param {string} userPrompt - The actual documentation task
 * @param {object} [options={}] - Optional overrides
 * @param {number} [options.maxTokens] - Override max tokens (default: 4096)
 * @returns {Promise<object>} Parsed JSON response with doc_type and confidence
 */
export async function callClaude(systemPrompt, userPrompt, options = {}) {
  const maxTokens = options.maxTokens || MAX_TOKENS;

  const makeRequest = async (prompt) => {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0]?.text || '';
  };

  // First attempt
  let raw;
  try {
    raw = await makeRequest(userPrompt);
  } catch (err) {
    console.error('[llm] Claude API call failed:', err.message);
    throw err;
  }

  // Try to parse JSON
  const parsed = tryParseJSON(raw);
  if (parsed) {
    return ensureRequiredFields(parsed);
  }

  // Retry with explicit JSON reminder
  console.warn('[llm] Response was not valid JSON -- retrying with JSON reminder');
  const retryPrompt = `${userPrompt}\n\nIMPORTANT: Your previous response was not valid JSON. Respond with ONLY a valid JSON object. No markdown fences, no explanation, no preamble. Start your response with { and end with }.`;

  try {
    raw = await makeRequest(retryPrompt);
  } catch (err) {
    console.error('[llm] Claude retry failed:', err.message);
    throw err;
  }

  const retryParsed = tryParseJSON(raw);
  if (retryParsed) {
    return ensureRequiredFields(retryParsed);
  }

  // Both attempts failed -- return a structured error object
  console.error('[llm] Failed to parse JSON after retry. Raw response:', raw.slice(0, 200));
  return {
    doc_type: 'error',
    confidence: 'low',
    error: 'Failed to parse LLM response as JSON',
    raw_response: raw.slice(0, 500),
    flags: ['LLM returned non-JSON response -- manual review required'],
  };
}

/**
 * Replaces {{VARIABLE_NAME}} placeholders in a template string with values.
 * Logs a warning for any placeholder that has no corresponding value.
 *
 * @param {string} template - Template string with {{PLACEHOLDER}} markers
 * @param {Record<string, string>} variables - Map of placeholder names to values
 * @returns {string} Template with all placeholders replaced
 */
export function injectVariables(template, variables) {
  const placeholderPattern = /\{\{([A-Z_]+)\}\}/g;

  const result = template.replace(placeholderPattern, (match, key) => {
    if (key in variables && variables[key] !== undefined && variables[key] !== null) {
      return String(variables[key]);
    }
    console.warn(`[llm] Unfilled placeholder: {{${key}}}`);
    return match;
  });

  return result;
}

// Attempts to parse a string as JSON, stripping markdown code fences if present.
function tryParseJSON(raw) {
  if (!raw || typeof raw !== 'string') return null;

  let cleaned = raw.trim();

  // Strip ```json ... ``` or ``` ... ``` fences
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  cleaned = cleaned.trim();

  // Find the first { and last } to extract JSON object
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  cleaned = cleaned.slice(start, end + 1);

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// Ensures every response has the required doc_type and confidence fields.
function ensureRequiredFields(obj) {
  if (!obj.doc_type) {
    obj.doc_type = 'unknown';
    console.warn('[llm] Response missing doc_type field');
  }
  if (!obj.confidence) {
    obj.confidence = 'medium';
    console.warn('[llm] Response missing confidence field -- defaulting to medium');
  }
  if (!obj.flags) {
    obj.flags = [];
  }
  return obj;
}
