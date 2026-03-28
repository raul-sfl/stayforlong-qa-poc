import Anthropic from '@anthropic-ai/sdk';
import { Md2SpecConfig, buildConfigHints } from './config.js';

export const DEFAULT_MODEL = 'claude-haiku-4-5';

// Pricing per million tokens (input / output) — update if Anthropic changes rates
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5':    { input: 0.80,  output: 4.00  },
  'claude-haiku-3':      { input: 0.25,  output: 1.25  },
  'claude-sonnet-4-5':   { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-6':   { input: 3.00,  output: 15.00 },
  'claude-opus-4':       { input: 15.00, output: 75.00 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['claude-haiku-4-5'];
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens:  a.inputTokens  + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd:      a.costUsd      + b.costUsd,
  };
}

export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

/**
 * Structured action returned by Claude.
 * Maps directly to Playwright API calls.
 */
export interface PlaywrightAction {
  type: 'navigate' | 'click' | 'fill' | 'selectOption' | 'press' | 'wait' | 'scroll' | 'assert' | 'skip';
  assertType?: 'visible' | 'hidden' | 'text' | 'count';
  locatorMethod?: 'getByRole' | 'getByTestId' | 'getByPlaceholder' | 'getByText' | 'getByLabel' | 'locator';
  locatorArg?: string;
  locatorOptions?: Record<string, unknown>;
  useFirst?: boolean;
  useNth?: number;
  actionArg?: string;
  url?: string;
  optional?: boolean;
  forceClick?: boolean;
}

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a Playwright test automation expert.
Given a page DOM snapshot and a test step in natural language, return a JSON object describing the Playwright action to perform.

JSON schema:
{
  "type": "navigate" | "click" | "fill" | "selectOption" | "press" | "wait" | "scroll" | "assert" | "skip",
  "assertType": "visible" | "hidden" | "text" | "count",  (only for assert)
  "locatorMethod": "getByRole" | "getByTestId" | "getByPlaceholder" | "getByText" | "getByLabel" | "locator",
  "locatorArg": string,
  "locatorOptions": object (optional),
  "useFirst": boolean (optional, use .first() when multiple matches expected),
  "useNth": number (optional, 0-based index — use .nth(N) to pick a specific occurrence),
  "actionArg": string (for fill/selectOption/press/assert with text),
  "url": string (only for navigate),
  "optional": boolean (true when step says "if present", "if visible", etc.)
}

Locator priority (use in this order):
1. getByTestId — when data-testid attribute is present on the element itself
2. getByPlaceholder — for text inputs with placeholder
3. getByRole — for buttons, links, checkboxes with name/text
4. getByLabel — for form fields with associated label
5. getByText — when text content uniquely identifies element
6. locator('#id') — when element has a unique id
7. locator('css') — as last resort

Special cases:
- When DOM shows <button svg-testid="CloseIcon"> or similar svg-testid, the element is an icon-only BUTTON containing an SVG.
  Use: locatorMethod "locator", locatorArg 'button:has([data-testid="CloseIcon"])'
  (Replace CloseIcon with the actual svg-testid value shown in the DOM)
- When DOM shows <svg data-testid="ChevronRightIcon" role="button"> (the SVG ITSELF has role="button"), do NOT use button:has(...).
  Use: locatorMethod "locator", locatorArg '[data-testid="ChevronRightIcon"]'
  This is the case for calendar navigation arrows on this site.
- The DOM snapshot includes section="..." to show which UI area contains each element (calendar, map, modal, header, search, nav, booking)
- When multiple elements share the same data-testid (e.g. two ChevronRightIcon), use section context:
  For "next month" / "calendar arrow" (section="calendar"): locatorArg '.calendar [data-testid="ChevronRightIcon"]', useFirst: true
  For map navigation (section="map"): locatorArg '.map [data-testid="ChevronRightIcon"]'
- If section-scoped selector might not work, fallback: locatorArg '[data-testid="ChevronRightIcon"]', useFirst: true
- When matching a button by role+name and there are multiple buttons, prefer the most specific name match

Rules:
- For "Scroll to <element>" / "Scroll down to <element>": use type "scroll" with the locator pointing to the target element
- For "Navigate to <url>": use type "navigate" with url field
- IMPORTANT: getByTestId is ONLY for elements with data-testid="..." attribute. For elements with id="..." use locator('#id') instead. Never confuse id= with data-testid=.
- IMPORTANT: when selecting items by number (calendar days, list items with numeric names), always add exact: true in locatorOptions to avoid partial matches. Example: getByRole('button', { name: '4' }) matches 4, 14, 24 — use locatorOptions: { name: '4', exact: true } instead.
- IMPORTANT: elements with aria-hidden="true" are invisible to users and cannot be clicked. When a selector returns multiple matches and some have aria-hidden="true", add [aria-hidden="false"] to the CSS selector to exclude them.
- When multiple identical elements exist and you need a specific occurrence (e.g. 2nd + button, 2nd dropdown), use useNth with 0-based index instead of useFirst
- When a step says "first month" use useFirst: true with locatorArg ':nth-match(.calendar, 1) [data-testid="default-day"][aria-hidden="false"]'. When it says "second month" or "second calendar", use locatorArg ':nth-match(.calendar, 2) [data-testid="default-day"][aria-hidden="false"]'. NEVER use .calendar:nth-of-type() or .calendar:first-of-type as they do not work with CSS class selectors.
- For ASSERTIONS — steps that verify/check something rather than interact with it:
  Patterns: "is displayed", "is visible", "is shown", "should be present", "should appear", "must be visible",
            "is not displayed", "is not visible", "should not be present", "contains text", "has text"
  Use type "assert" with assertType:
    - "visible"  → expect(locator).toBeVisible()         (e.g. "banner is displayed")
    - "hidden"   → expect(locator).not.toBeVisible()      (e.g. "modal is not displayed")
    - "text"     → expect(locator).toContainText(actionArg) (e.g. "price shows '€99'")
    - "count"    → expect(locator).toHaveCount(N)          (e.g. "3 results are shown")
  IMPORTANT: "is displayed" / "is shown" at the END of a sentence means the subject should be visible.
  Example: "Promotional banner is displayed" → assert visible on the banner element
- For optional steps — ONLY when the condition word "if" appears at the START ("if present", "if visible", "if appear", "if shown"): set optional: true
  CRITICAL: "X is displayed" / "X is visible" / "X is shown" with the verb at the END = ASSERTION, NOT optional. Use type "assert", optional: false.
- For "close popup", "dismiss modal", "close banner": set optional: true (UI elements may not always appear)
- For "wait N seconds": use type "wait" with actionArg as ms string
- If step is unclear or impossible: use type "skip"
- Return ONLY valid JSON, no explanation, no markdown fences
- NEVER use regex literals (e.g. /accept/i) — use plain strings instead (e.g. "Accept")
- For consent/cookie/privacy popups: prefer the site-specific consent selector from config if provided. Otherwise look for id containing "accept" in the DOM.
- Never rely on button text for consent buttons — text changes with language, IDs do not
- For readonly inputs (date pickers, custom selects shown as readonly text inputs): set forceClick: true, because a <label> usually overlays them and intercepts normal clicks`;

/**
 * Asks Claude to determine the correct Playwright action for a step.
 */
export interface ActionResult {
  action: PlaywrightAction;
  usage: TokenUsage;
}

export async function getPlaywrightAction(
  step: string,
  domSnapshot: string,
  model = DEFAULT_MODEL,
  config: Md2SpecConfig = {}
): Promise<ActionResult> {
  const configHints = buildConfigHints(config);
  const systemPrompt = configHints
    ? SYSTEM_PROMPT + configHints
    : SYSTEM_PROMPT;

  const userMessage = `Page DOM (visible interactive elements):
${domSnapshot || '(no interactive elements found)'}

Test step: "${step}"

Return the JSON action:`;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const inputTokens  = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const usage: TokenUsage = { inputTokens, outputTokens, costUsd: calcCost(model, inputTokens, outputTokens) };

    // Extract JSON — find the first complete {...} block by tracking brace depth
    let jsonStr: string | null = null;
    const start = text.indexOf('{');
    if (start !== -1) {
      let depth = 0;
      for (let i = start; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') { depth--; if (depth === 0) { jsonStr = text.slice(start, i + 1); break; } }
      }
    }
    if (!jsonStr) {
      console.warn(`  [warn] Claude returned no JSON for step: "${step}"`);
      return { action: { type: 'skip' }, usage };
    }

    // Sanitize common Claude JSON issues:
    // 1. Regex literals: /pattern/flags → "pattern"
    // 2. Trailing commas before } or ]
    let sanitized = jsonStr
      .replace(/:\s*\/([^/\n]+)\/[gimsuy]*/g, ': "$1"')
      .replace(/,\s*([}\]])/g, '$1');

    const action = JSON.parse(sanitized) as PlaywrightAction;
    return { action, usage };
  } catch (err) {
    console.warn(`  [warn] Claude API error for step "${step}": ${(err as Error).message}`);
    return { action: { type: 'skip' }, usage: ZERO_USAGE };
  }
}

/**
 * Converts a PlaywrightAction to executable Playwright code string.
 */
export function actionToCode(action: PlaywrightAction, stepDescription: string): string {
  if (action.type === 'navigate') {
    return `await page.goto(${JSON.stringify(action.url ?? '')});`;
  }

  if (action.type === 'wait') {
    const ms = parseInt(action.actionArg ?? '1000', 10);
    return `await page.waitForTimeout(${ms});`;
  }

  if (action.type === 'skip') {
    return `// TODO: could not generate code for: ${stepDescription}`;
  }

  // Build locator expression
  const locatorExpr = buildLocatorExpr(action);
  const finalLocator = action.useFirst
    ? `${locatorExpr}.first()`
    : action.useNth !== undefined
      ? `${locatorExpr}.nth(${action.useNth})`
      : locatorExpr;

  switch (action.type) {
    case 'scroll':
      return `await ${finalLocator}.scrollIntoViewIfNeeded();`;

    case 'click':
      return action.forceClick
        ? `await ${finalLocator}.click({ force: true });`
        : `await ${finalLocator}.click();`;
    case 'fill':
      return `await ${finalLocator}.fill(${JSON.stringify(action.actionArg ?? '')});`;
    case 'selectOption':
      return `await ${finalLocator}.selectOption(${JSON.stringify(action.actionArg ?? '')});`;
    case 'press':
      return `await ${finalLocator}.press(${JSON.stringify(action.actionArg ?? '')});`;

    case 'assert': {
      const assertType = action.assertType ?? 'visible';
      switch (assertType) {
        case 'visible':  return `await expect(${finalLocator}).toBeVisible();`;
        case 'hidden':   return `await expect(${finalLocator}).not.toBeVisible();`;
        case 'text':     return `await expect(${finalLocator}).toContainText(${JSON.stringify(action.actionArg ?? '')});`;
        case 'count':    return `await expect(${finalLocator}).toHaveCount(${parseInt(action.actionArg ?? '1', 10)});`;
        default:         return `await expect(${finalLocator}).toBeVisible();`;
      }
    }

    default:
      return `// TODO: unsupported action type "${action.type}" for: ${stepDescription}`;
  }
}

function buildLocatorExpr(action: PlaywrightAction): string {
  const arg = JSON.stringify(action.locatorArg ?? '');

  // Separate hasText/hasNotText (chained via .filter()) from other options passed inline
  const { hasText, hasNotText, ...inlineOpts } = (action.locatorOptions ?? {}) as Record<string, unknown>;
  const opts = Object.keys(inlineOpts).length > 0 ? `, ${JSON.stringify(inlineOpts)}` : '';

  let expr: string;
  switch (action.locatorMethod) {
    case 'getByRole':
      expr = `page.getByRole(${arg}${opts})`;
      break;
    case 'getByTestId':
      expr = `page.getByTestId(${arg})`;
      break;
    case 'getByPlaceholder':
      expr = `page.getByPlaceholder(${arg}${opts})`;
      break;
    case 'getByText':
      expr = `page.getByText(${arg}${opts})`;
      break;
    case 'getByLabel':
      expr = `page.getByLabel(${arg}${opts})`;
      break;
    default:
      expr = `page.locator(${arg})`;
  }

  // Chain .filter() for hasText / hasNotText
  if (hasText !== undefined) {
    expr += `.filter({ hasText: ${JSON.stringify(hasText)} })`;
  }
  if (hasNotText !== undefined) {
    expr += `.filter({ hasNotText: ${JSON.stringify(hasNotText)} })`;
  }

  return expr;
}
