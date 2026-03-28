#!/usr/bin/env node

import { Command } from 'commander';
import fg from 'fast-glob';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runMd2Spec } from './runner.js';
import { DEFAULT_MODEL } from './claudeLocator.js';

const program = new Command();

program
  .name('md2spec')
  .description('Convert Markdown test specs to Playwright .spec.ts using Claude AI as the browser agent')
  .version('1.0.0')
  .argument('<input>', 'Markdown file or glob pattern (e.g. "./md-specs/*.md")')
  .option('-o, --output <dir>', 'Output directory for .spec.ts files', './playwright/specs')
  .option('--model <model>', `Claude model to use (default: ${DEFAULT_MODEL})`, DEFAULT_MODEL)
  .option('--headed', 'Run browser in headed (visible) mode', false)
  .option('--dry-run', 'Print generated spec to stdout without writing files', false)
  .option('--run', 'Run generated Playwright specs immediately after generation', false)
  .option('--viewport <size>', 'Viewport size: "mobile" (390x844), "tablet" (768x1024), or "WxH" (e.g. 375x667)')
  .option('--storage-state <path>', 'Path to Playwright storage state file (consent cookies)')
  .option('--force', 'Overwrite existing .spec.ts files (default: skip if already exists)', false)
  .action(async (input: string, opts: {
    output: string;
    model: string;
    headed: boolean;
    dryRun: boolean;
    run: boolean;
    force: boolean;
    viewport?: string;
    storageState?: string;
  }) => {
    if (!process.env['ANTHROPIC_API_KEY']) {
      console.error('Error: ANTHROPIC_API_KEY environment variable is required');
      process.exit(1);
    }

    const files = await fg(input, { absolute: true });
    if (files.length === 0) {
      console.error(`No files matched: ${input}`);
      process.exit(1);
    }

    console.log(`md2spec — ${files.length} file(s) to process`);
    console.log(`Model: ${opts.model} | Output: ${opts.output}`);

    let success = 0;
    let failed = 0;
    const generatedSpecs: string[] = [];

    for (const file of files) {
      // Skip if spec already exists and --force not set
      if (!opts.force && !opts.dryRun) {
        const baseName = path.basename(file, '.md').replace(/\s+/g, '-').toLowerCase();
        const outPath = path.resolve(opts.output, `${baseName}.spec.ts`);
        const fs = await import('node:fs');
        if (fs.existsSync(outPath)) {
          console.log(`⏭  Skipping ${path.basename(file)} (spec exists, use --force to overwrite)`);
          continue;
        }
      }

      try {
        const result = await runMd2Spec(file, {
          model: opts.model,
          headed: opts.headed,
          dryRun: opts.dryRun,
          outputDir: path.resolve(opts.output),
          storageState: opts.storageState,
          viewport: parseViewport(opts.viewport),
          force: opts.force,
        });
        if (result?.specPath) generatedSpecs.push(result.specPath);
        success++;
      } catch (err) {
        console.error(`\n✗ Failed: ${path.basename(file)}: ${(err as Error).message}`);
        failed++;
      }
    }

    console.log(`\nDone. ${success} succeeded, ${failed} failed.`);

    // Run generated specs with Playwright if --run flag is set
    if (opts.run && generatedSpecs.length > 0 && !opts.dryRun) {
      const playwrightDir = path.resolve(opts.output, '..');
      const relativeSpecs = generatedSpecs.map(s => path.relative(playwrightDir, s));
      const pwArgs = ['playwright', 'test', ...relativeSpecs];
      if (opts.headed) pwArgs.push('--headed');

      console.log(`\n▶ Running Playwright tests...\n`);
      const pw = spawnSync('npx', pwArgs, {
        cwd: playwrightDir,
        stdio: 'inherit',
        env: { ...process.env },
      });
      if ((pw.status ?? 1) !== 0) process.exit(pw.status ?? 1);
    }

    if (failed > 0) process.exit(1);
  });

function parseViewport(v?: string): { width: number; height: number } | undefined {
  if (!v) return undefined;
  const presets: Record<string, { width: number; height: number }> = {
    mobile:  { width: 390,  height: 844  },
    tablet:  { width: 768,  height: 1024 },
    desktop: { width: 1280, height: 800  },
  };
  if (presets[v]) return presets[v];
  const m = v.match(/^(\d+)[x×](\d+)$/);
  if (m) return { width: parseInt(m[1]), height: parseInt(m[2]) };
  console.warn(`[warn] Unknown viewport "${v}", using default. Use "mobile", "tablet" or "WxH"`);
  return undefined;
}

program.parse();
