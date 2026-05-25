import yaml from 'js-yaml';
import { z } from 'zod';

const GeneratorsSchema = z.object({
  api_reference:   z.boolean().default(true),
  changelog:       z.boolean().default(true),
  readme_update:   z.boolean().default(true),
  architecture:    z.boolean().default(false),
  docstrings:      z.boolean().default(false),
  migration_guide: z.boolean().default(true),
  onboarding:      z.boolean().default(false),
  runbook:         z.boolean().default(false),
  stale_detection: z.boolean().default(false),
}).default({});

const ConfigSchema = z.object({
  enabled:           z.boolean().default(true),
  docs_output_dir:   z.string().default('docs/'),
  open_pr:           z.boolean().default(true),
  generators:        GeneratorsSchema,
  ignore_paths:      z.array(z.string()).default([]),
  source_extensions: z.array(z.string()).default(['.js', '.ts', '.py', '.go', '.java']),
  changelog_file:    z.string().default('CHANGELOG.md'),
});

/**
 * Parses a raw YAML string into a validated config object.
 * Falls back to all defaults if the YAML is null/empty.
 *
 * @param {string|null} yamlContent - Raw .docsbot.yaml content
 * @returns {object} Validated config with defaults applied
 */
export function parseConfig(yamlContent) {
  if (!yamlContent) {
    console.log('[config] No .docsbot.yaml found -- using defaults');
    return ConfigSchema.parse({});
  }

  let raw;
  try {
    raw = yaml.load(yamlContent);
  } catch (err) {
    console.warn('[config] Failed to parse .docsbot.yaml:', err.message, '-- using defaults');
    return ConfigSchema.parse({});
  }

  const result = ConfigSchema.safeParse(raw || {});

  if (!result.success) {
    console.warn('[config] .docsbot.yaml validation errors:', result.error.flatten());
    return ConfigSchema.parse(raw || {});
  }

  console.log('[config] Loaded .docsbot.yaml successfully');
  return result.data;
}

/**
 * Returns the default config (all defaults, no YAML needed).
 * @returns {object}
 */
export function getDefaultConfig() {
  return ConfigSchema.parse({});
}
