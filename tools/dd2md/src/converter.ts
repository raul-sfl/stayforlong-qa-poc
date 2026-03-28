import path from 'node:path';
import { DDTest, MarkdownTest } from './types.js';
import { extractSteps } from './parser.js';
import { stepToText } from './stepToText.js';
import { enhanceSteps, DEFAULT_MODEL } from './aiEnhancer.js';
import { logger } from './logger.js';

export interface ConvertOptions {
  aiEnhance?: boolean;
  model?: string;
}

export async function convertTest(
  test: DDTest,
  sourceFile: string,
  opts: ConvertOptions = {}
): Promise<MarkdownTest> {
  const steps = extractSteps(test);

  if (steps.length === 0) {
    logger.warn(`${path.basename(sourceFile)}: no steps found`);
  }

  const startUrl = test.config?.request?.url ?? '';

  // If no goToUrl step exists as the first step, prepend a navigation step
  const hasInitialNavigation = steps.length > 0 && steps[0].type === 'goToUrl';
  const prefixSteps: string[] = (!hasInitialNavigation && startUrl)
    ? [`Navigate to ${startUrl}`]
    : [];

  if (prefixSteps.length > 0) {
    logger.verbose(`  Step 0 [auto-navigate]: ${prefixSteps[0]}`);
  }

  let lines: string[];

  if (opts.aiEnhance && steps.length > 0) {
    // Use Claude to generate human-readable descriptions
    const enhanced = await enhanceSteps(steps, opts.model);
    lines = steps.map((step, index) => {
      const text = enhanced[index] ?? stepToText(step);
      logger.verbose(`  Step ${index + 1} [${step.type}] (ai): ${text}`);
      return text;
    });
  } else {
    lines = steps.map((step, index) => {
      const text = stepToText(step);
      logger.verbose(`  Step ${index + 1} [${step.type}]: ${text}`);
      return text;
    });
  }

  return {
    title: test.name,
    sourceFile: path.basename(sourceFile),
    steps: [...prefixSteps, ...lines],
    aiEnhanced: opts.aiEnhance ?? false,
    model: opts.aiEnhance ? (opts.model ?? DEFAULT_MODEL) : undefined,
    viewport: detectViewport(test.options?.device_ids ?? []),
  };
}

/**
 * Detects the viewport type from Datadog device_ids.
 * Datadog devices: chrome.mobile.small, chrome.mobile.large, chrome.tablet, firefox.laptop_large, etc.
 */
function detectViewport(deviceIds: string[]): 'mobile' | 'tablet' | 'desktop' {
  const id = (deviceIds[0] ?? '').toLowerCase();
  if (id.includes('mobile') || id.includes('phone')) return 'mobile';
  if (id.includes('tablet')) return 'tablet';
  return 'desktop';
}
