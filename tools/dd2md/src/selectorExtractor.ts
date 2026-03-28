import { DDElement } from './types.js';

export type SelectorMethod = 'css' | 'xpath' | 'getByText' | 'getByPlaceholder';

export interface SelectorResult {
  selector: string;
  method: SelectorMethod;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Extracts the best Playwright selector from a Datadog element descriptor.
 *
 * Priority (high → low):
 *  1. id attribute in targetOuterHTML            → #id
 *  2. data-testid attribute in targetOuterHTML   → [data-testid="..."]
 *  3. aria-label attribute in targetOuterHTML    → [aria-label="..."]
 *  4. placeholder in targetOuterHTML             → getByPlaceholder(...)
 *  5. userLocator values (explicit CSS/XPath)    → as-is
 *  6. text content from multiLocator.co          → getByText(...)
 *  7. multiLocator.at (attribute-based XPath)    → xpath=...
 *  8. multiLocator.ro (role/class XPath)         → xpath=...
 *  9. multiLocator.cl (class XPath)              → xpath=...
 */
export function extractSelector(element: DDElement | undefined): SelectorResult {
  if (!element) {
    return { selector: 'body', method: 'css', confidence: 'low' };
  }

  const html = element.targetOuterHTML ?? '';

  // 1. id attribute
  const idMatch = html.match(/\bid="([^"]+)"/);
  if (idMatch) {
    return { selector: `#${idMatch[1]}`, method: 'css', confidence: 'high' };
  }

  // 2. data-testid
  const testIdMatch = html.match(/data-testid="([^"]+)"/);
  if (testIdMatch) {
    return { selector: `[data-testid="${testIdMatch[1]}"]`, method: 'css', confidence: 'high' };
  }

  // 3. aria-label
  const ariaMatch = html.match(/aria-label="([^"]+)"/);
  if (ariaMatch) {
    return { selector: `[aria-label="${ariaMatch[1]}"]`, method: 'css', confidence: 'high' };
  }

  // 4. placeholder
  const placeholderMatch = html.match(/placeholder="([^"]+)"/);
  if (placeholderMatch) {
    return { selector: placeholderMatch[1], method: 'getByPlaceholder', confidence: 'high' };
  }

  // 5. userLocator (explicitly set by test author)
  const locValues = element.userLocator?.values ?? [];
  if (locValues.length > 0 && locValues[0].value) {
    const loc = locValues[0];
    return {
      selector: loc.type === 'xpath' ? loc.value : loc.value,
      method: loc.type === 'xpath' ? 'xpath' : 'css',
      confidence: 'high',
    };
  }

  // 6. text content from multiLocator.co
  const co = element.multiLocator?.co ?? '';
  if (co) {
    try {
      const coData = JSON.parse(co) as Array<{ text: string; textType: string }>;
      if (Array.isArray(coData) && coData[0]?.text) {
        return { selector: coData[0].text, method: 'getByText', confidence: 'medium' };
      }
    } catch {
      // ignore parse errors
    }
  }

  // 7. attribute-based XPath (multiLocator.at — often @placeholder, @value, @href)
  if (element.multiLocator?.at) {
    return { selector: element.multiLocator.at, method: 'xpath', confidence: 'medium' };
  }

  // 8. role/class XPath (most readable fallback XPath)
  if (element.multiLocator?.ro) {
    return { selector: element.multiLocator.ro, method: 'xpath', confidence: 'medium' };
  }

  // 9. class-based XPath (last resort)
  if (element.multiLocator?.cl) {
    return { selector: element.multiLocator.cl, method: 'xpath', confidence: 'low' };
  }

  return { selector: 'body', method: 'css', confidence: 'low' };
}

/**
 * Converts a SelectorResult to the appropriate Playwright locator code string.
 * The returned string is a complete locator expression (not a statement).
 */
export function selectorToLocatorCode(result: SelectorResult): string {
  switch (result.method) {
    case 'getByText':
      return `page.getByText(${JSON.stringify(result.selector)}, { exact: false }).first()`;
    case 'getByPlaceholder':
      return `page.getByPlaceholder(${JSON.stringify(result.selector)})`;
    case 'xpath':
      return `page.locator(${JSON.stringify(`xpath=${result.selector}`)})`;
    default: // css
      return `page.locator(${JSON.stringify(result.selector)})`;
  }
}
