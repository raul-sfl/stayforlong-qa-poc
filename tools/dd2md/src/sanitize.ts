/**
 * Converts a Datadog test name into a valid file name.
 * Example: "Login Flow - Happy Path!" → "login-flow-happy-path.md"
 */
export function toFileName(testName: string): string {
  return (
    testName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .slice(0, 100) + '.md'
  );
}

/**
 * Deduplicates file names by appending a numeric suffix.
 */
export function deduplicateFileName(base: string, emitted: Set<string>): string {
  if (!emitted.has(base)) {
    emitted.add(base);
    return base;
  }
  let counter = 1;
  let candidate = base.replace('.md', `-${counter}.md`);
  while (emitted.has(candidate)) {
    counter++;
    candidate = base.replace('.md', `-${counter}.md`);
  }
  emitted.add(candidate);
  return candidate;
}
