import { AdfDoc, AdfNode, QASection } from './types.js';

/**
 * Heading patterns that indicate a QA/test section.
 * Matched case-insensitively against the heading text.
 */
const QA_HEADING_PATTERNS = [
  /qa\s+requirements?/i,
  /qa\s+tests?/i,
  /test\s+(cases?|requirements?|definition|scenarios?|steps?)/i,
  /definition\s+of\s+(done|success|ready)/i,
  /acceptance\s+criteria/i,
  /success\s+criteria/i,
  /verification\s+steps?/i,
  /how\s+to\s+(test|verify|validate)/i,
  /testing\s+(guide|notes?|requirements?)/i,
];

/**
 * Extract plain text from an ADF node recursively.
 */
function nodeToText(node: AdfNode): string {
  if (node.type === 'text') {
    return node.text ?? '';
  }
  if (!node.content) return '';
  return node.content.map(nodeToText).join('');
}

/**
 * Extract list items from a bulletList or orderedList node.
 * Returns one string per list item (nested lists are flattened).
 */
function extractListItems(node: AdfNode): string[] {
  if (node.type !== 'bulletList' && node.type !== 'orderedList') return [];

  const items: string[] = [];
  for (const listItem of node.content ?? []) {
    if (listItem.type !== 'listItem') continue;
    const parts: string[] = [];
    for (const child of listItem.content ?? []) {
      if (child.type === 'paragraph') {
        const text = nodeToText(child).trim();
        if (text) parts.push(text);
      } else if (child.type === 'bulletList' || child.type === 'orderedList') {
        // Nested list — flatten into sub-items
        parts.push(...extractListItems(child));
      }
    }
    if (parts.length > 0) items.push(parts.join(' '));
  }
  return items;
}

/**
 * Extract all list items and paragraph text that follow a QA heading
 * until the next heading of equal or higher level.
 */
function extractSectionContent(nodes: AdfNode[], startIndex: number, headingLevel: number): string[] {
  const steps: string[] = [];

  for (let i = startIndex; i < nodes.length; i++) {
    const node = nodes[i];

    // Stop at the next heading of equal or higher level
    if (node.type === 'heading') {
      const level = (node.attrs?.level as number) ?? 1;
      if (level <= headingLevel) break;
    }

    // Extract list items
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      steps.push(...extractListItems(node));
    }

    // Extract standalone paragraphs (but skip empty ones)
    if (node.type === 'paragraph') {
      const text = nodeToText(node).trim();
      if (text) steps.push(text);
    }

    // Handle taskList (checkbox items in Jira)
    if (node.type === 'taskList') {
      for (const taskItem of node.content ?? []) {
        if (taskItem.type !== 'taskItem') continue;
        const text = nodeToText(taskItem).trim();
        // Skip meta items like "All QA tests pass" or "Deployed to staging"
        if (text && !isMetaStep(text)) {
          steps.push(text);
        }
      }
    }
  }

  return steps;
}

/**
 * Filter out DoD meta-items that aren't actual test steps.
 */
function isMetaStep(text: string): boolean {
  const metaPatterns = [
    /^all\s+qa\s+tests?\s+pass/i,
    /^deployed\s+to/i,
    /^code\s+review/i,
    /^merge\s+to/i,
    /^pr\s+(approved|merged)/i,
    /^documentation/i,
  ];
  return metaPatterns.some(p => p.test(text));
}

/**
 * Find and extract QA sections from a Jira ADF document.
 * Returns the first matching section found.
 */
export function extractQASections(doc: AdfDoc | null): QASection | null {
  if (!doc?.content) return null;

  const nodes = doc.content;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type !== 'heading') continue;

    const headingText = nodeToText(node).trim();
    const headingLevel = (node.attrs?.level as number) ?? 1;

    const isQAHeading = QA_HEADING_PATTERNS.some(pattern => pattern.test(headingText));
    if (!isQAHeading) continue;

    const steps = extractSectionContent(nodes, i + 1, headingLevel);
    if (steps.length === 0) continue;

    return {
      heading: headingText,
      steps,
    };
  }

  return null;
}

/**
 * Get a plain-text summary of the entire description for fallback/debugging.
 */
export function adfToPlainText(doc: AdfDoc | null): string {
  if (!doc?.content) return '';
  return doc.content.map(nodeToText).join('\n').trim();
}
