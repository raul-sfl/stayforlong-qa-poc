import { DDStep } from './types.js';

/**
 * Converts a Datadog browser step to a human-readable sentence
 * for use in Markdown spec format.
 *
 * Strategy:
 * - Use step.name as the base (it's already written in human language by the test author)
 * - Enrich with parameter values when the value is not already present in the name
 */
export function stepToText(step: DDStep): string {
  const name = step.name.trim();
  const params = step.params ?? {};

  switch (step.type) {
    case 'goToUrl': {
      const url = params.value ?? '';
      if (url && !name.includes(url)) {
        return `${name} ${url}`.trim();
      }
      return name || `Navigate to ${url}`;
    }

    case 'typeText': {
      const value = params.value ?? '';
      if (value && !name.toLowerCase().includes(value.toLowerCase())) {
        return `${name} with "${annotateVariables(value)}"`;
      }
      return name;
    }

    case 'selectOption': {
      const value = params.value ?? '';
      if (value && !name.toLowerCase().includes(value.toLowerCase())) {
        return `${name} selecting "${annotateVariables(value)}"`;
      }
      return name;
    }

    case 'pressKey': {
      const key = params.value ?? '';
      if (key && !name.toLowerCase().includes(key.toLowerCase())) {
        return `${name} (${key})`;
      }
      return name || `Press the ${key} key`;
    }

    case 'wait': {
      const ms = parseInt(params.value ?? '1000', 10);
      return name || `Wait ${ms} milliseconds`;
    }

    case 'refresh':
      return name || 'Refresh the page';

    case 'scroll': {
      if (name) return name;
      const x = params.x ?? 0;
      const y = params.y ?? 0;
      return y > 0 ? 'Scroll down the page' : x > 0 ? 'Scroll right on the page' : 'Scroll the page';
    }

    case 'assertCurrentUrl': {
      const value = params.value ?? '';
      const operator = params.operator ?? params.check ?? 'contains';
      if (name) return name;
      if (operator === 'is') return `Verify the URL is "${value}"`;
      if (operator === 'matches') return `Verify the URL matches "${value}"`;
      return `Verify the URL contains "${value}"`;
    }

    case 'assertPageContains': {
      const value = params.value ?? '';
      if (name) return name;
      return `Verify the page contains "${value}"`;
    }

    case 'assertPageLacks': {
      const value = params.value ?? '';
      if (name) return name;
      return `Verify the page does not contain "${value}"`;
    }

    case 'assertElementContent': {
      const value = params.value ?? '';
      if (value && name && !name.toLowerCase().includes(value.toLowerCase())) {
        return `${name} containing "${value}"`;
      }
      return name;
    }

    // For all other types (click, hover, assertElementPresent, assertElementAttribute,
    // extractVariable, and unknowns) the step.name is already descriptive enough.
    default:
      return name;
  }
}

/**
 * Annotates Datadog variable references so they stand out in the Markdown.
 * Example: "{{USERNAME}}" → "{{USERNAME}} (Datadog variable)"
 * We leave the variable syntax intact kept as-is for reference.
 */
function annotateVariables(value: string): string {
  if (value.includes('{{') && value.includes('}}')) {
    return `${value} <!-- Datadog variable: replace with actual value -->`;
  }
  return value;
}
