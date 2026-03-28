#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { fetchIssue } from './jiraClient.js';
import { convertIssue, renderMarkdown, toFileName } from './converter.js';
import { adfToPlainText } from './adfParser.js';

const program = new Command();

program
  .name('jira2md')
  .description('Extract QA requirements from Jira issues and generate Markdown specs')
  .version('1.0.0');

program
  .argument('<issues...>', 'Jira issue keys (e.g. WEB-666 WEB-667)')
  .option('-o, --output <dir>', 'Output directory for markdown files', './md-specs')
  .option('--dry-run', 'Print to stdout without writing files', false)
  .option('-v, --verbose', 'Show debug information', false)
  .option('--base-url <url>', 'Base URL to include in Preconditions (e.g. https://es.stayforlong.com)', '')
  .action(async (issues: string[], opts: {
    output: string;
    dryRun: boolean;
    verbose: boolean;
    baseUrl: string;
  }) => {
    const outputDir = path.resolve(opts.output);
    let converted = 0;
    let skipped = 0;
    let failed = 0;

    if (!opts.dryRun) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    for (const issueKey of issues) {
      const key = issueKey.toUpperCase();
      process.stdout.write(`  ${key} ... `);

      try {
        const issue = await fetchIssue(key);

        if (opts.verbose) {
          console.log(`\n  Summary: ${issue.fields.summary}`);
          console.log(`  Status: ${issue.fields.status.name}`);
          console.log(`  Description (plain):\n${adfToPlainText(issue.fields.description).slice(0, 300)}`);
        }

        const spec = convertIssue(issue, opts.baseUrl);

        if (!spec) {
          console.log('⚠ skipped (no QA section found in description)');
          if (opts.verbose) {
            console.log(`  Tip: Add a section with heading "QA Requirements", "Acceptance Criteria",`);
            console.log(`       "Test Cases", or "Definition of Done" to the Jira description.`);
          }
          skipped++;
          continue;
        }

        const markdown = renderMarkdown(spec, opts.baseUrl);
        const fileName = `${toFileName(issue)}.md`;

        if (opts.dryRun) {
          console.log(`✓ (dry run — would write ${fileName})`);
          console.log('\n' + markdown);
        } else {
          const filePath = path.join(outputDir, fileName);
          fs.writeFileSync(filePath, markdown, 'utf-8');
          console.log(`✓ ${fileName}`);
          if (opts.verbose) {
            console.log(`  QA section: "${spec.qaSection.heading}" (${spec.qaSection.steps.length} steps)`);
          }
        }

        converted++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`✗ ${message}`);
        failed++;
      }
    }

    console.log('');
    console.log(`Done: ${converted} converted, ${skipped} skipped (no QA section), ${failed} failed`);

    if (converted > 0 && !opts.dryRun) {
      console.log(`\nNext step: generate Playwright specs with md2spec:`);
      console.log(`  node tools/md2spec/dist/cli.js '${outputDir}/*.md' -o playwright/specs --headed`);
    }

    if (failed > 0) process.exit(1);
  });

program.parse();
