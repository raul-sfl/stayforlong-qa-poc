import Anthropic from '@anthropic-ai/sdk';
import { DDStep } from './types.js';
import { logger } from './logger.js';

export const DEFAULT_MODEL = 'claude-haiku-4-5';

/**
 * Uses Claude to rewrite raw Datadog recorder step names into
 * human-readable functional descriptions for md2spec.
 *
 * All steps for a test are sent in a single API call to minimise cost.
 * Falls back to the original step names if the API call fails.
 */
export async function enhanceSteps(steps: DDStep[], model = DEFAULT_MODEL): Promise<string[]> {
  if (steps.length === 0) return [];

  const client = new Anthropic();

  const stepsPayload = steps.map((step, i) => ({
    index: i + 1,
    type: step.type,
    name: step.name,
    value: step.params?.value ?? null,
    html: truncateHtml(step.params?.element?.targetOuterHTML ?? ''),
  }));

  const prompt = buildPrompt(stepsPayload);

  logger.verbose(`  [ai-enhance] Calling ${model} for ${steps.length} steps...`);

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = (response.content[0] as { type: string; text: string }).text;
    const descriptions = parseDescriptions(text, steps.length);

    logger.verbose(`  [ai-enhance] Done. ${descriptions.length} descriptions received.`);
    return descriptions;
  } catch (err) {
    logger.warn(`  [ai-enhance] API call failed: ${(err as Error).message}. Using original names.`);
    return steps.map(s => s.name);
  }
}

function buildPrompt(steps: Array<{
  index: number;
  type: string;
  name: string;
  value: string | null;
  html: string;
}>): string {
  return `Convert these Datadog Synthetics browser test recorder steps into clear, human-readable QA test step descriptions.
Return ONLY a valid JSON array of strings — one description per step, in the same order.

Rules:
- Describe WHAT the user is doing, not which HTML element type
- Keep each description short (max 12 words)
- Use data-testid, aria-label, placeholder, or visible button/link text from the HTML when available
- For navigation (goToUrl) steps, keep the URL in the description
- For fill/typeText steps, include the value in quotes
- For assertion steps, start with "Verify" or "Assert"
- Write in English

Steps:
${JSON.stringify(steps, null, 2)}

Return format: ["description 1", "description 2", ...]`;
}

function parseDescriptions(text: string, expectedCount: number): string[] {
  // Extract JSON array from response (Claude may add prose around it)
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error('Response did not contain a JSON array');
  }

  const parsed = JSON.parse(match[0]) as unknown[];
  if (!Array.isArray(parsed) || parsed.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} descriptions, got ${parsed.length}`
    );
  }

  return parsed.map(d => String(d));
}

/**
 * Truncate HTML to keep only the first ~300 chars — enough for data-testid, class, aria-label,
 * placeholder, and visible text, without blowing up the prompt size.
 */
function truncateHtml(html: string): string {
  if (!html) return '';
  return html.slice(0, 300);
}
