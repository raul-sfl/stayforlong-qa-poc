#!/usr/bin/env node

import { Command } from 'commander';
import fg from 'fast-glob';
import fs from 'node:fs';
import path from 'node:path';
import { parseTestFile } from './parser.js';
import { convertTest } from './converter.js';
import { renderMarkdown } from './codegen.js';
import { toFileName, deduplicateFileName } from './sanitize.js';
import { logger } from './logger.js';
import type { CLIOptions } from './types.js';

const program = new Command();

program
  .name('dd2md')
  .description('Migrate Datadog Synthetics Browser Tests to Markdown specs')
  .version('1.0.0')
  .argument('<input>', 'JSON file or glob pattern (e.g. "./exports/*.json")')
  .option('-o, --output <dir>', 'Output directory', './md-specs')
  .option('--dry-run', 'Print generated Markdown to stdout without writing files', false)
  .option('-v, --verbose', 'Show step-level conversion details', false)
  .option('--ai-enhance', 'Use Claude AI to improve step descriptions (requires ANTHROPIC_API_KEY)', false)
  .option('--model <model>', 'Claude model for --ai-enhance (default: claude-haiku-4-5)', 'claude-haiku-4-5')
  .action(async (input: string, opts: CLIOptions) => {
    logger.setVerbose(opts.verbose);

    if (opts.aiEnhance && !process.env['ANTHROPIC_API_KEY']) {
      logger.error('--ai-enhance requires ANTHROPIC_API_KEY to be set');
      process.exit(1);
    }

    if (opts.aiEnhance) {
      logger.info(`AI enhancement enabled (model: ${opts.model})`);
    }

    const files = await fg(input, { absolute: true });
    if (files.length === 0) {
      logger.error(`No files matched pattern: ${input}`);
      process.exit(1);
    }

    logger.info(`Found ${files.length} file(s) to convert`);

    if (!opts.dryRun) {
      fs.mkdirSync(opts.output, { recursive: true });
    }

    const emittedNames = new Set<string>();
    let successCount = 0;
    let failCount = 0;

    for (const filePath of files) {
      let ddTests: import('./types.js').DDTest[];
      try {
        ddTests = parseTestFile(filePath);
        logger.verbose(`${path.basename(filePath)}: found ${ddTests.length} test(s)`);
      } catch (err) {
        logger.error(`Failed to parse ${path.basename(filePath)}: ${(err as Error).message}`);
        failCount++;
        continue;
      }

      for (const ddTest of ddTests) {
        try {
          const mdTest = await convertTest(ddTest, filePath, {
            aiEnhance: opts.aiEnhance,
            model: opts.model,
          });
          const markdown = renderMarkdown(mdTest);

          const rawName = toFileName(mdTest.title);
          const outFileName = deduplicateFileName(rawName, emittedNames);

          if (opts.dryRun) {
            const divider = '─'.repeat(60);
            console.log(`\n${divider}`);
            console.log(`<!-- Output file: ${outFileName} -->`);
            console.log(divider);
            console.log(markdown);
          } else {
            const outPath = path.join(opts.output, outFileName);
            fs.writeFileSync(outPath, markdown, 'utf-8');
            logger.info(`Written: ${outPath}`);
          }

          successCount++;
        } catch (err) {
          logger.error(`Failed to convert "${ddTest.name}": ${(err as Error).message}`);
          failCount++;
        }
      }
    }

    logger.info(`Done. ${successCount} succeeded, ${failCount} failed.`);
    if (failCount > 0) process.exit(1);
  });

program.parse();
