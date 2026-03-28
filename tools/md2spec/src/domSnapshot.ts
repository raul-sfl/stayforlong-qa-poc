import type { Page } from '@playwright/test';

/**
 * Extracts a concise snapshot of interactive elements from the current page.
 * This snapshot is passed to Claude to help it identify the correct locator.
 */
export async function getDOMSnapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const MAX_ELEMENTS = 60;
    const MAX_TEXT = 80;

    function truncate(s: string, max: number): string {
      s = s.replace(/\s+/g, ' ').trim();
      return s.length > max ? s.slice(0, max) + '…' : s;
    }

    function getAttrs(el: Element): string {
      const parts: string[] = [];
      const tag = el.tagName.toLowerCase();

      const id = el.getAttribute('id');
      if (id) parts.push(`id="${id}"`);

      const testId = el.getAttribute('data-testid');
      if (testId) parts.push(`data-testid="${testId}"`);

      const placeholder = el.getAttribute('placeholder');
      if (placeholder) parts.push(`placeholder="${placeholder}"`);

      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) parts.push(`aria-label="${ariaLabel}"`);

      const type = el.getAttribute('type');
      if (type && tag === 'input') parts.push(`type="${type}"`);

      const readonly = el.getAttribute('readonly');
      if (readonly !== null && tag === 'input') parts.push(`readonly`);

      const role = el.getAttribute('role');
      if (role) parts.push(`role="${role}"`);

      const href = el.getAttribute('href');
      if (href && tag === 'a') parts.push(`href="${truncate(href, 40)}"`);

      const name = el.getAttribute('name');
      if (name) parts.push(`name="${name}"`);

      const text = (el.textContent ?? '').trim();
      if (text && !['input', 'select', 'textarea'].includes(tag)) {
        parts.push(`text="${truncate(text, MAX_TEXT)}"`);
      }

      // For icon-only buttons (no text/label), expose inner SVG data-testid
      // so Claude can generate button:has([data-testid="..."]) selectors
      if (tag === 'button' && !parts.some(p => p.startsWith('text=') || p.startsWith('aria-label='))) {
        const innerTestId = el.querySelector('[data-testid]')?.getAttribute('data-testid');
        if (innerTestId) parts.push(`svg-testid="${innerTestId}"`);
      }

      // Add semantic section context to disambiguate duplicate elements
      // e.g. two ChevronRight buttons: one in calendar, one in map
      const section = getSection(el);
      if (section) parts.push(`section="${section}"`);

      return `<${tag}${parts.length ? ' ' + parts.join(' ') : ''}>`;
    }

    function getSection(el: Element): string {
      // Walk up the DOM to find the closest meaningful container
      const SECTION_SELECTORS: Array<[string, string]> = [
        ['[class*="calendar"], [class*="Calendar"], [class*="datepicker"], [class*="DatePicker"], [class*="Picker"]', 'calendar'],
        ['[class*="map"], [class*="Map"]', 'map'],
        ['[role="dialog"], [class*="modal"], [class*="Modal"]', 'modal'],
        ['[class*="header"], header', 'header'],
        ['[class*="search"], [class*="Search"]', 'search'],
        ['nav, [role="navigation"]', 'nav'],
        ['[class*="rooms"], [class*="booking"], [class*="Booking"]', 'booking'],
      ];

      let node: Element | null = el.parentElement;
      let depth = 0;
      while (node && depth < 8) {
        for (const [selector, label] of SECTION_SELECTORS) {
          try {
            if (node.matches(selector)) return label;
          } catch { /* invalid selector, skip */ }
        }
        node = node.parentElement;
        depth++;
      }
      return '';
    }

    const selectors = [
      'input:not([type="hidden"])',
      'textarea',
      'select',
      'button',
      'a[href]',
      '[role="button"]',
      '[role="link"]',
      '[role="combobox"]',
      '[role="option"]',
      '[role="menuitem"]',
      '[role="tab"]',
      '[data-testid]',
    ].join(', ');

    const elements = Array.from(document.querySelectorAll(selectors));
    const visible = elements.filter(el => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const style = window.getComputedStyle(el as HTMLElement);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.opacity !== '0'
      );
    });

    return visible
      .slice(0, MAX_ELEMENTS)
      .map(el => getAttrs(el))
      .join('\n');
  });
}
