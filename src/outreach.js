/**
 * Outreach & Client Acquisition Module
 * Uses Gemini to research potential clients and draft personalized outreach.
 * OpenClaw can use Computer Use to actually send messages via browser.
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from './logger.js';

const logger = createLogger('outreach');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';

const OUTREACH_DIR = '/home/brans/legacy-automation-agency/outreach';
if (!existsSync(OUTREACH_DIR)) mkdirSync(OUTREACH_DIR, { recursive: true });

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 4096 }
    })
  });
  if (!response.ok) throw new Error(`Gemini error: ${response.status}`);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Generate a list of target industries and software to search for.
 */
export async function generateTargetList() {
  logger.info('Generating target client list...');

  const prompt = `You are a business development AI for a Legacy Interface Automation Agency.
We automate data entry into old desktop software using AI that can control the mouse and keyboard.

Generate a list of 30 specific opportunities. For each, provide:
1. The legacy software name (real software that exists)
2. The industry vertical
3. The type of data entry task commonly done
4. Where to find these businesses (job boards, industry forums, etc.)
5. The pain point / cost they're currently paying for manual entry
6. A search query to find them on Upwork, Indeed, or LinkedIn

Focus on:
- Dental practice management (Dentrix, Eaglesoft, Open Dental)
- Accounting (Sage 50, QuickBooks Desktop, Peachtree)
- Medical records (Epic client, Allscripts, eClinicalWorks desktop)
- Logistics (TMS systems, SAP GUI, AS/400 terminals)
- Insurance (legacy claims processing)
- Government (legacy portals, mainframe web interfaces)
- Real estate (MLS data entry, old CRM systems)
- Manufacturing (ERP systems with no API)

Return as a JSON array of objects.`;

  const result = await callGemini(prompt);
  const cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  writeFileSync(join(OUTREACH_DIR, 'target-list.json'), cleaned);
  logger.info('Target list saved to outreach/target-list.json');
  return cleaned;
}

/**
 * Generate outreach message templates.
 */
export async function generateOutreachTemplates() {
  logger.info('Generating outreach templates...');

  const prompt = `Create 5 outreach message templates for a Legacy Interface Automation Agency.

Our service: We automate data entry and extraction for desktop software that has no API.
Our AI agents control the mouse and keyboard like a human, but 24/7 with zero errors.
Setup: $2,000-5,000 one-time. Monthly: $500-1,500.

Create templates for these channels:
1. **Upwork proposal** — responding to a "data entry" job posting
2. **Cold email** — to a business owner struggling with legacy software
3. **LinkedIn message** — to an office manager or IT director
4. **Forum post** — for industry-specific forums (dental, accounting, etc.)
5. **Follow-up email** — after initial contact, no response

Each template should:
- Be personalized (with [PLACEHOLDERS] for names, software, etc.)
- Lead with the pain point, not the technology
- Include a clear call to action
- Be concise (under 200 words each)
- Sound human, not AI-generated

Return as JSON with: channel, subject (if email), body, notes.`;

  const result = await callGemini(prompt);
  const cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  writeFileSync(join(OUTREACH_DIR, 'templates.json'), cleaned);
  logger.info('Outreach templates saved to outreach/templates.json');
  return cleaned;
}

/**
 * Research specific job postings for legacy data entry work.
 */
export async function researchJobPostings() {
  logger.info('Researching job postings for legacy data entry...');

  const prompt = `You are researching the market for legacy software data entry automation.

List 20 specific search queries I should use to find businesses currently paying for manual data entry into legacy desktop software. These queries should work on:
- Upwork.com
- Indeed.com
- LinkedIn Jobs
- Google (site-specific searches)

Also provide:
1. The typical hourly rate these businesses pay for manual entry ($15-25/hr)
2. The estimated monthly volume per business
3. Our potential monthly revenue per client ($500-1,500)
4. The ROI pitch (e.g., "Replace a $3,000/month data entry clerk with a $750/month AI")

Return as JSON with: platform, search_query, expected_results, monthly_value_per_client, roi_pitch.`;

  const result = await callGemini(prompt);
  const cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  writeFileSync(join(OUTREACH_DIR, 'job-research.json'), cleaned);
  logger.info('Job research saved to outreach/job-research.json');
  return cleaned;
}

/**
 * Generate a personalized pitch for a specific prospect.
 */
export async function generatePitch(prospect) {
  const { name, company, software, painPoint } = prospect;

  const prompt = `Write a personalized outreach message for:

Name: ${name}
Company: ${company}
Software they use: ${software}
Their pain point: ${painPoint}

We are Legacy Automation Agency. We automate data entry into legacy desktop software
using AI that controls the mouse and keyboard. No API integration needed.

Write a warm, professional message (under 150 words) that:
1. Acknowledges their specific pain
2. Explains our solution in simple terms
3. Offers a free assessment
4. Has a clear CTA

Sound like a helpful consultant, not a salesperson.`;

  return await callGemini(prompt);
}

/**
 * Run the full outreach pipeline.
 */
export async function runOutreachPipeline() {
  logger.info('=== Starting Full Outreach Pipeline ===');

  try {
    await generateTargetList();
    await generateOutreachTemplates();
    await researchJobPostings();

    logger.info('=== Outreach Pipeline Complete ===');
    logger.info(`Results in: ${OUTREACH_DIR}/`);

    return { status: 'complete', dir: OUTREACH_DIR };
  } catch (err) {
    logger.error(`Outreach pipeline error: ${err.message}`);
    return { status: 'error', error: err.message };
  }
}
