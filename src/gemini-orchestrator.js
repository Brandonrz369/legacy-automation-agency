import { createLogger } from './logger.js';
import { readFileSync } from 'fs';

const logger = createLogger('gemini-orchestrator');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';
const FLASH_MODEL = process.env.GEMINI_FLASH_MODEL || 'gemini-2.5-flash-lite';

async function callGemini(prompt, model = GEMINI_MODEL) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096
      }
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text;
}

async function callGeminiJSON(prompt, model = GEMINI_MODEL) {
  const raw = await callGemini(prompt + '\n\nRespond with valid JSON only. No markdown, no code fences.', model);
  // Strip any markdown code fences
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    logger.warn(`Failed to parse Gemini JSON response, returning raw text`);
    return { raw: cleaned };
  }
}

export class GeminiOrchestrator {
  constructor() {
    logger.info(`Gemini Orchestrator initialized (model: ${GEMINI_MODEL})`);
  }

  /**
   * Classify an incoming task/message into a type and mode.
   * This is the "traffic cop" function from the V3 blueprint.
   */
  async classifyTask(message) {
    const prompt = `You are the Gemini Orchestrator for a Legacy Interface Automation Agency.
Your job is to classify incoming client requests.

TASK TYPES:
- "data-entry": Client needs data entered into legacy software (GUI automation)
- "data-extraction": Client needs data pulled OUT of legacy software
- "workflow": Multi-step process (entry + extraction + transformation)
- "setup": Initial configuration/mapping of a new legacy application
- "simple": A simple question that doesn't need Claude Code execution

EXECUTION MODES (for non-simple tasks):
- "EXECUTE": Standard CLI/code execution
- "SUPERVISE": GUI automation via Computer Use (screenshots, mouse, keyboard)
- "ARCHITECT": Complex planning that needs deep analysis first

CLIENT MESSAGE: "${message}"

Classify this request. Return JSON with: type, mode, software (if mentioned), complexity (low/medium/high), estimated_steps.`;

    return await callGeminiJSON(prompt);
  }

  /**
   * Handle a simple query directly (no Claude Code needed).
   */
  async handleSimpleQuery(message) {
    const prompt = `You are the customer-facing AI for a Legacy Interface Automation Agency.
Answer this client question helpfully and concisely.

Our services:
- Automate data entry into legacy desktop software (no API needed)
- Extract data from GUI-only applications
- Setup fee: $2,000-5,000 per workflow
- Monthly retainer: $500-1,500/month
- We use AI agents that can operate the mouse and keyboard like a human

CLIENT QUESTION: "${message}"`;

    return await callGemini(prompt);
  }

  /**
   * Plan execution for a task. Gemini decomposes the task into steps
   * that Claude Code can execute.
   */
  async planExecution(task) {
    const docInfo = task.documents?.length
      ? `\nAttached documents: ${task.documents.map(d => d.original).join(', ')}`
      : '\nNo documents attached.';

    const prompt = `You are the Gemini Orchestrator planning a legacy software automation task.

TASK: ${task.description}
SOFTWARE: ${task.software_name}
TYPE: ${task.task_type}
CURRENT MODE: ${task.envelope.mode}
HOPS: ${task.envelope.hops}/${task.envelope.ttl_max}
${docInfo}

Create an execution plan for Claude Code. Each step should be specific and verifiable.
For GUI tasks (SUPERVISE mode), include expected UI element descriptions.
For code tasks (EXECUTE mode), include the specific commands/scripts to run.

Return JSON with:
{
  "steps": [
    {
      "step_number": 1,
      "action": "description of what to do",
      "mode": "EXECUTE or SUPERVISE",
      "verification": "how to verify this step succeeded",
      "tools_needed": ["list", "of", "tools"]
    }
  ],
  "estimated_duration_minutes": 10,
  "requires_human_approval": false,
  "safety_notes": "any safety considerations"
}`;

    const plan = await callGeminiJSON(prompt);
    logger.info(`[${task.id}] Plan created: ${plan.steps?.length || 0} steps, est. ${plan.estimated_duration_minutes || '?'} min`);
    return plan;
  }

  /**
   * ARCHITECT mode: Deep analysis after repeated failures.
   * Read-only reasoning to find root cause and create revised plan.
   */
  async architectTask(task) {
    const prompt = `You are in ARCHITECT mode — read-only deep analysis.

A legacy automation task has FAILED ${task.envelope.consecutive_failures} times.

TASK: ${task.description}
SOFTWARE: ${task.software_name}
LAST ERROR: ${task.last_error || 'unknown'}
PREVIOUS PLAN: ${JSON.stringify(task.plan, null, 2)}
STATE HASHES: ${JSON.stringify(task.envelope.state_hashes)}

Analyze the root cause of failure. Consider:
1. Is the UI different than expected? (element moved, dialog appeared)
2. Is the data format wrong? (parsing error)
3. Is there a timing issue? (element not loaded yet)
4. Is there a permission issue?

Return JSON with:
{
  "root_cause": "what went wrong",
  "revised_plan": { "steps": [...] },
  "confidence": 0.0-1.0,
  "alternative_approaches": ["if this fails, try..."],
  "should_escalate_to_human": false
}`;

    const analysis = await callGeminiJSON(prompt);
    logger.info(`[${task.id}] ARCHITECT analysis: ${analysis.root_cause} (confidence: ${analysis.confidence})`);

    // If ARCHITECT produces a revised plan, switch back to EXECUTE for next attempt
    if (analysis.revised_plan && !analysis.should_escalate_to_human) {
      task.plan = analysis.revised_plan;
      task.envelope.mode = 'EXECUTE';
    }

    return analysis;
  }

  /**
   * Flash-Lite post-execution verification.
   * Cheap, fast check if the task result is correct.
   */
  async verifyResult(task, result) {
    const prompt = `You are a verification agent. Check if this task completed correctly.

TASK: ${task.description}
EXPECTED OUTCOME: ${task.plan?.steps?.slice(-1)?.[0]?.verification || 'Task should complete successfully'}
ACTUAL RESULT: ${JSON.stringify(result).slice(0, 2000)}

Return JSON:
{
  "status": "PASS" or "RETRY" or "ESCALATE",
  "reason": "why this status",
  "suggestions": "if RETRY, what to fix"
}`;

    const verification = await callGeminiJSON(prompt, FLASH_MODEL);
    logger.info(`[${task.id}] Verification: ${verification.status} — ${verification.reason}`);
    return verification;
  }

  /**
   * Parse documents (PDFs, images) for data extraction.
   */
  async parseDocuments(documents) {
    if (!documents || documents.length === 0) return [];

    const results = [];
    for (const doc of documents) {
      try {
        const content = readFileSync(doc.path);
        const base64 = content.toString('base64');

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: 'Extract all structured data from this document. Return as JSON with key-value pairs.' },
                { inline_data: { mime_type: doc.mimetype, data: base64 } }
              ]
            }]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          results.push({ file: doc.original, extracted: text });
        }
      } catch (err) {
        logger.error(`Document parse error (${doc.original}): ${err.message}`);
        results.push({ file: doc.original, error: err.message });
      }
    }

    return results;
  }
}
