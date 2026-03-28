import fs from 'node:fs';
import { DDTest, DDStep } from './types.js';

/**
 * Parses a file that can contain:
 * - A single JSON object (one test)
 * - A JSON array of objects (multiple tests)
 * - NDJSON / newline-delimited JSON (one JSON object per line)
 *
 * Always returns an array of DDTest.
 */
export function parseTestFile(filePath: string): DDTest[] {
  const raw = fs.readFileSync(filePath, 'utf-8').trim();

  // Try standard JSON first (object or array)
  if (raw.startsWith('{') || raw.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Not valid single JSON — fall through to NDJSON parsing
    }
    if (parsed !== undefined) {
      const items = Array.isArray(parsed) ? parsed : [parsed];
      return items.map((item, i) => validateTest(item, filePath, i));
    }
  }

  // NDJSON: one JSON object per non-empty line
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) {
    throw new Error(`${filePath}: file is empty`);
  }

  return lines.map((line, i) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      throw new Error(`${filePath} line ${i + 1}: invalid JSON — ${(e as Error).message}`);
    }
    return validateTest(parsed, filePath, i);
  });
}

function validateTest(raw: unknown, filePath: string, index: number): DDTest {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${filePath}[${index}]: expected a JSON object`);
  }
  const obj = raw as Record<string, unknown>;
  if (obj['type'] !== 'browser') {
    throw new Error(`${filePath}[${index}]: expected type "browser", got "${obj['type']}"`);
  }
  if (typeof obj['name'] !== 'string' || !obj['name']) {
    throw new Error(`${filePath}[${index}]: missing or empty "name" field`);
  }
  return raw as DDTest;
}

/**
 * Returns browser steps from whichever location they are stored in.
 * Handles both v1 (options.browser_steps) and v2 (top-level steps).
 */
export function extractSteps(test: DDTest): DDStep[] {
  return test.options?.browser_steps ?? test.steps ?? [];
}
