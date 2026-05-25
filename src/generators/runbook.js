import { callClaude, injectVariables, DOCUBOT_SYSTEM_PROMPT } from '../agent/llmWriter.js';

const PROMPT_TEMPLATE = `A deployment change has been made. Generate an operations runbook so any engineer can understand, operate, and troubleshoot this system.

## Service Context
- Service name: {{SERVICE_NAME}}
- Description: {{SERVICE_DESCRIPTION}}

## Infrastructure Config
\`\`\`
{{INFRASTRUCTURE_CONFIG}}
\`\`\`

## Deployment Diff
\`\`\`diff
{{DEPLOYMENT_DIFF}}
\`\`\`

## What a Runbook Must Cover
1. What this service does and why it exists
2. How to deploy it (step by step)
3. How to verify a deployment succeeded
4. How to roll back if something goes wrong
5. How to monitor it (what metrics matter)
6. Alert definitions -- what each alert means and how to respond
7. Common operational tasks (restart, scale, drain)
8. Known failure modes and their remediation steps

## Writing Rules
- Write for a developer who did not build this service
- Every step is an exact command
- Include time estimates for operations
- State the blast radius of each failure mode
- If a procedure requires elevated permissions, say so explicitly

Respond with this exact JSON structure:
{
  "doc_type": "ops_runbook",
  "confidence": "high|medium|low",
  "service_name": "{{SERVICE_NAME}}",
  "service_description": "What this service does",
  "criticality": "low|medium|high|critical",
  "deployment": {
    "platform": "Platform name",
    "deploy_command": "Exact deploy command",
    "deploy_time_estimate": "3-5 minutes",
    "verify_steps": ["Step 1", "Step 2"],
    "rollback_steps": ["Step 1", "Step 2"]
  },
  "monitoring": {
    "health_endpoint": "GET /health",
    "key_metrics": [
      {
        "metric": "Metric name",
        "where": "Where to find it",
        "alert_threshold": "Threshold value",
        "meaning": "What it means when threshold is exceeded"
      }
    ],
    "log_locations": ["Log location 1"]
  },
  "alerts": [
    {
      "name": "Alert name",
      "trigger": "Trigger condition",
      "likely_cause": "Most likely cause",
      "remediation": "Step-by-step remediation"
    }
  ],
  "common_tasks": [
    {
      "task": "Task description",
      "command": "Exact command",
      "when": "When to use this"
    }
  ],
  "failure_modes": [
    {
      "scenario": "Failure scenario",
      "blast_radius": "What breaks and who is affected",
      "detection": "How to detect this failure",
      "remediation": "Step-by-step fix",
      "user_impact": "Impact on end users"
    }
  ],
  "flags": []
}`;

/**
 * Generates an operations runbook for a deployed service.
 *
 * @param {{SERVICE_NAME, SERVICE_DESCRIPTION, DEPLOYMENT_DIFF, INFRASTRUCTURE_CONFIG}} inputs
 * @param {object} config
 * @returns {Promise<object>} Ops runbook JSON
 */
export async function generate(inputs, config) {
  console.log(`[runbook] Generating ops runbook for ${inputs.SERVICE_NAME || 'service'}...`);

  const prompt = injectVariables(PROMPT_TEMPLATE, {
    SERVICE_NAME: inputs.SERVICE_NAME || 'Unknown Service',
    SERVICE_DESCRIPTION: inputs.SERVICE_DESCRIPTION || '(No description provided)',
    DEPLOYMENT_DIFF: inputs.DEPLOYMENT_DIFF || '(No deployment diff provided)',
    INFRASTRUCTURE_CONFIG: inputs.INFRASTRUCTURE_CONFIG || '(No infrastructure config provided)',
    ...inputs,
  });

  const result = await callClaude(DOCUBOT_SYSTEM_PROMPT, prompt, { maxTokens: 4096 });
  console.log(`[runbook] Done -- criticality: ${result.criticality}`);
  return result;
}
