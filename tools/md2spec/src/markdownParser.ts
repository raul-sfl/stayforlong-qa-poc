/**
 * Parses Markdown spec files.
 *
 * Expected format:
 *   # Test Title
 *
 *   ## Preconditions
 *   - item
 *
 *   ## Steps
 *   1. Navigate to https://...
 *   2. Click something
 */

export type ViewportPreset = 'mobile' | 'tablet' | 'desktop';

export interface ParsedSpec {
  title: string;
  steps: string[];
  startUrl: string | null;
  viewport?: ViewportPreset;
}

export function parseMarkdownSpec(content: string): ParsedSpec {
  const lines = content.split('\n');

  let title = '';
  const steps: string[] = [];
  let inSteps = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Title
    if (!title && trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      title = trimmed.replace(/^# /, '').trim();
      continue;
    }

    // Section headers
    if (trimmed.startsWith('## ')) {
      inSteps = trimmed.toLowerCase().includes('step');
      continue;
    }

    // Numbered list items under ## Steps
    if (inSteps) {
      const match = trimmed.match(/^\d+\.\s+(.+)/);
      if (match) {
        steps.push(match[1].trim());
      }
    }
  }

  // Extract start URL from first "Navigate to ..." step
  const startUrl = extractNavigateUrl(steps[0] ?? '');

  // Extract viewport from <!-- viewport: mobile|tablet|desktop --> comment
  const viewportMatch = content.match(/<!--\s*viewport:\s*(mobile|tablet|desktop)\s*-->/i);
  const viewport = viewportMatch ? (viewportMatch[1].toLowerCase() as ViewportPreset) : undefined;

  return { title: title || 'Untitled Test', steps, startUrl, viewport };
}

/**
 * Extracts a URL from a navigation step.
 * Handles: "Navigate to https://...", "Navigate to SERP https://...", etc.
 */
export function extractNavigateUrl(step: string): string | null {
  const match = step.match(/navigate\b.*(https?:\/\/\S+)/i);
  return match ? match[1] : null;
}

/**
 * Returns true if a step is optional.
 * Explicit: "if present", "if visible", etc.
 * Implicit: consent banners, popups and modals are always optional
 * since they may not appear on every run (session-dependent).
 */
export function isOptionalStep(step: string): boolean {
  if (/\bif\s+(present|visible|shown|exists?|available|needed)\b/i.test(step)) {
    return true;
  }
  // Consent banners and promotional popups are session-dependent
  if (/\b(consent|cookie|gdpr|accept.*button|popup|modal|banner|dismiss|close.*popup|close.*modal)\b/i.test(step)) {
    return true;
  }
  return false;
}

/**
 * Returns true if a step is a plain navigation (no element interaction needed).
 * Handles: "Navigate to https://", "Navigate to SERP https://", etc.
 */
export function isNavigationStep(step: string): boolean {
  return /^navigate\b.*(https?:\/\/)/i.test(step.trim());
}

/**
 * Returns true if a step involves an overlay that appears with a programmatic delay.
 * These steps need extra wait time before taking the DOM snapshot.
 * Covers: promotional popups, cookie banners, date picker calendars, dropdowns.
 */
export function isPopupStep(step: string): boolean {
  return /\b(popup|modal|banner|overlay|offer|suscri|subscri|newsletter|calendar|month|next month|prev month|check.?in|check.?out|date picker|arrow|chevron)\b/i.test(step);
}
