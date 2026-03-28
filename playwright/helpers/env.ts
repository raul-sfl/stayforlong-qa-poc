import * as fs from 'fs';
import * as path from 'path';

/**
 * Loads .env files from the project root if they exist.
 * Supports: .env, .env.local, .env.test
 */
export function loadEnvFiles(): void {
  const root = path.resolve(__dirname, '../../');
  const envFiles = ['.env', '.env.local', '.env.test'];

  for (const file of envFiles) {
    const filePath = path.join(root, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (key && !(key in process.env)) {
          process.env[key] = value;
        }
      }
    }
  }
}

/**
 * Gets an environment variable, falling back to a default if provided.
 */
export function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Environment variable "${key}" is required but not set.`);
  }
  return value;
}
