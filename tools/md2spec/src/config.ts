import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export interface Md2SpecConfig {
  consent?: {
    selector: string;
    comment?: string;
    writeToSpec?: boolean;   // if true, add consent try/catch to generated spec
  };
  popupClose?: {
    selector: string;
    comment?: string;
    writeToSpec?: boolean;   // if true, add popup close try/catch to generated spec
  };
  sections?: Record<string, string>;  // name → CSS selector for the container
  hints?: string[];                   // free-text hints injected into Claude's prompt
}

/**
 * Loads md2spec.config.json by walking up from cwd until found.
 * Returns empty config if not found.
 */
export function loadConfig(startDir = process.cwd()): Md2SpecConfig {
  let dir = resolve(startDir);
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, 'md2spec.config.json');
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, 'utf-8');
        return JSON.parse(raw) as Md2SpecConfig;
      } catch {
        console.warn(`[md2spec] Failed to parse ${candidate}`);
        return {};
      }
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return {};
}

/**
 * Builds the site-specific section of the Claude system prompt from config.
 */
export function buildConfigHints(config: Md2SpecConfig): string {
  const lines: string[] = [];

  if (config.consent?.selector) {
    lines.push(`- Consent/cookie accept button selector: ${config.consent.selector}`);
    lines.push(`  Always prefer this selector when step mentions accepting cookies, privacy or consent.`);
  }

  if (config.sections && Object.keys(config.sections).length > 0) {
    lines.push(`- Page section CSS selectors for scoping duplicate elements:`);
    for (const [name, selector] of Object.entries(config.sections)) {
      lines.push(`  ${name}: ${selector}`);
    }
  }

  if (config.hints && config.hints.length > 0) {
    for (const hint of config.hints) {
      lines.push(`- ${hint}`);
    }
  }

  if (lines.length === 0) return '';

  return `\nSite-specific knowledge for this project:\n${lines.join('\n')}`;
}
