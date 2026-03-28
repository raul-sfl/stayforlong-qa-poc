import { chromium, type Page } from '@playwright/test';
import { parseMarkdownSpec, isNavigationStep, isOptionalStep, isPopupStep, extractNavigateUrl } from './markdownParser.js';
import { getDOMSnapshot } from './domSnapshot.js';
import { getPlaywrightAction, actionToCode, addUsage, ZERO_USAGE, type PlaywrightAction, type TokenUsage } from './claudeLocator.js';
import { generateSpec, type RecordedStep } from './specWriter.js';
import { loadConfig, type Md2SpecConfig } from './config.js';
import fs from 'node:fs';
import path from 'node:path';

export interface RunOptions {
  model: string;
  headed: boolean;
  dryRun: boolean;
  outputDir: string;
  storageState?: string;
  viewport?: { width: number; height: number };
  force?: boolean;
}

/**
 * Executes a markdown spec against a live browser using Claude to resolve
 * each step into Playwright code. Generates a .spec.ts file.
 */
export interface Md2SpecResult {
  specPath?: string;
}

export async function runMd2Spec(
  markdownFile: string,
  opts: RunOptions
): Promise<Md2SpecResult> {
  const config: Md2SpecConfig = loadConfig(path.dirname(path.resolve(markdownFile)));
  const content = fs.readFileSync(markdownFile, 'utf-8');
  const spec = parseMarkdownSpec(content);
  const sourceBase = path.basename(markdownFile);

  console.log(`\n📄 ${spec.title}`);
  console.log(`   ${spec.steps.length} steps | model: ${opts.model}`);

  if (!spec.startUrl) {
    console.warn('  [warn] No "Navigate to <url>" step found. Skipping.');
    return {};
  }

  const browser = await chromium.launch({
    headless: !opts.headed,
    slowMo: opts.headed ? 300 : 0,
  });

  // Viewport priority: CLI option > markdown comment > default (desktop)
  const VIEWPORT_PRESETS: Record<string, { width: number; height: number }> = {
    mobile:  { width: 390,  height: 844  },
    tablet:  { width: 768,  height: 1024 },
    desktop: { width: 1280, height: 800  },
  };
  const resolvedViewport = opts.viewport
    ?? (spec.viewport ? VIEWPORT_PRESETS[spec.viewport] : undefined);

  if (spec.viewport && !opts.viewport) {
    console.log(`   Viewport: ${spec.viewport} (from markdown)`);
  }

  const contextOptions: Parameters<typeof browser.newContext>[0] = {
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    ...(resolvedViewport ? { viewport: resolvedViewport } : {}),
  };

  const resolvedStorageState = opts.storageState ?? config.storageState;
  if (resolvedStorageState && fs.existsSync(resolvedStorageState)) {
    contextOptions.storageState = resolvedStorageState;
    console.log(`   Using storage state: ${resolvedStorageState}`);
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  const recordedSteps: RecordedStep[] = [];
  let totalUsage: TokenUsage = { ...ZERO_USAGE };
  let abortedOnFailure = false;

  try {
    for (let i = 0; i < spec.steps.length; i++) {
      const stepText = spec.steps[i];
      const stepNum = i + 1;
      const optional = isOptionalStep(stepText);

      process.stdout.write(`  [${stepNum}/${spec.steps.length}] ${stepText} … `);

      // Navigation steps don't need Claude
      if (isNavigationStep(stepText)) {
        const url = extractNavigateUrl(stepText)!;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        // Wait for JS-rendered overlays (consent banners, popups) to appear
        try {
          await page.waitForLoadState('networkidle', { timeout: 8000 });
        } catch {
          // networkidle timeout is fine for pages with long-polling
        }

        // Auto-accept consent + close popup — record them in the spec too
        const consentSelector = config.consent?.selector;
        const popupSelector = config.popupClose?.selector;

        await autoAcceptConsent(page, url);
        await autoClosePopup(page, config.popupClose?.selector);

        const navCode: string[] = [`await page.goto(${JSON.stringify(url)});`];

        if (consentSelector && config.consent?.writeToSpec) {
          navCode.push(
            `try {`,
            `  await page.locator(${JSON.stringify(consentSelector)}).click({ timeout: 5000 });`,
            `  await page.waitForTimeout(1500);`,
            `} catch { /* consent not present */ }`
          );
        }

        if (popupSelector && config.popupClose?.writeToSpec) {
          navCode.push(
            `try {`,
            `  await page.locator(${JSON.stringify(popupSelector)}).first().waitFor({ state: 'visible', timeout: 6000 });`,
            `  await page.locator(${JSON.stringify(popupSelector)}).first().click();`,
            `} catch { /* popup not present */ }`
          );
        }

        recordedSteps.push({ description: stepText, code: navCode.join('\n  '), optional: false });
        console.log('✓ (navigate)');
        continue;
      }

      // Popup/modal steps: try config selector directly before going through Claude
      // This avoids DOM snapshot MAX_ELEMENTS limit issues for popups deep in the page
      if (isPopupStep(stepText) && config.popupClose?.selector) {
        const popupSel = config.popupClose.selector;
        try {
          await page.locator(popupSel).waitFor({ state: 'visible', timeout: 6000 });
          await page.locator(popupSel).click();
          const code = `try {\n  await page.locator(${JSON.stringify(popupSel)}).waitFor({ state: 'visible', timeout: 6000 });\n  await page.locator(${JSON.stringify(popupSel)}).click();\n} catch { /* popup not present */ }`;
          recordedSteps.push({ description: stepText, code, optional: true });
          console.log('✓ (popup closed)');
          continue;
        } catch {
          // Popup didn't appear — skip silently if optional
          if (optional) {
            const code = `try {\n  await page.locator(${JSON.stringify(popupSel)}).waitFor({ state: 'visible', timeout: 6000 });\n  await page.locator(${JSON.stringify(popupSel)}).click();\n} catch { /* popup not present */ }`;
            recordedSteps.push({ description: stepText, code, optional: true });
            console.log('⚠ skipped (popup not present)');
            continue;
          }
        }
      }

      // Other popup/modal steps: wait for overlay before snapshotting
      if (isPopupStep(stepText)) {
        try {
          await page.locator('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="popup"], [class*="Popup"], [class*="overlay"]')
            .first().waitFor({ state: 'visible', timeout: 4000 });
        } catch {
          await page.waitForTimeout(2000);
        }
      }

      // Get DOM snapshot of current page state
      const domSnapshot = await getDOMSnapshot(page);

      // Ask Claude for the right Playwright action (with site-specific config hints)
      const { action, usage } = await getPlaywrightAction(stepText, domSnapshot, opts.model, config);
      totalUsage = addUsage(totalUsage, usage);
      const code = actionToCode(action, stepText);

      // Execute the action in the real browser
      const success = await executeAction(page, action, optional);

      const costStr = usage.costUsd > 0 ? ` ($${usage.costUsd.toFixed(4)})` : '';
      recordedSteps.push({ description: stepText, code, optional });

      if (success) {
        console.log(`✓${costStr}`);
      } else if (optional) {
        console.log(`⚠ skipped (optional)${costStr}`);
      } else {
        console.log(`✗ failed${costStr}`);
        console.log(`   ⛔ Stopping — fix this step before continuing to avoid wasting tokens.`);
        abortedOnFailure = true;
        break;
      }

      // Extra wait after forceClick or calendar navigation: overlays and animations need time
      const isCalendarNav = action.type === 'click' && action.locatorArg?.includes('ChevronRight');
      const isDateField = action.type === 'click' && action.locatorArg?.includes('checkin');
      if (action.forceClick || isDateField || isCalendarNav) {
        await page.waitForTimeout(1500);
      }

      // Wait for page to stabilize after each action:
      // domcontentloaded catches full page navigations
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
      } catch {
        // No navigation, that's fine
      }
      // networkidle catches async data fetches (autocomplete, dropdowns, search results)
      try {
        await page.waitForLoadState('networkidle', { timeout: 2000 });
      } catch {
        // Short timeout: fine for pages with long-polling or streaming
      }
      // Final pause for React re-renders and CSS animations
      await page.waitForTimeout(500);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  // Print cost summary
  const costLine = `   💰 Total: ${totalUsage.inputTokens} in + ${totalUsage.outputTokens} out tokens = $${totalUsage.costUsd.toFixed(4)} (${opts.model})`;
  console.log(costLine);

  // Generate the spec
  const specContent = generateSpec(spec.title, recordedSteps, sourceBase, opts.model, totalUsage, spec.viewport);
  const outFileName = path.basename(markdownFile, '.md') + '.spec.ts';

  // Failed steps = required steps that couldn't be generated (have TODO or empty code)
  const failedSteps = recordedSteps.filter(s => !s.optional && s.code.includes('// TODO'));

  if (opts.dryRun) {
    console.log('\n─── Generated spec ───');
    console.log(specContent);
    if (failedSteps.length > 0) {
      console.log(`\n❌ ${failedSteps.length} required step(s) failed — spec would NOT be written:`);
      failedSteps.forEach(s => console.log(`   - ${s.description}`));
    }
  } else if (abortedOnFailure || failedSteps.length > 0) {
    console.log(`❌ Spec NOT written — test did not complete successfully.`);
    if (failedSteps.length > 0) {
      failedSteps.forEach(s => console.log(`   - ${s.description}`));
    }
  } else {
    fs.mkdirSync(opts.outputDir, { recursive: true });
    const outPath = path.join(opts.outputDir, outFileName);
    fs.writeFileSync(outPath, specContent, 'utf-8');
    console.log(`✅ Written: ${outPath}`);
    return { specPath: outPath };
  }

  return {};
}

/**
 * Executes a PlaywrightAction on the given page.
 * Returns true on success, false on failure.
 */
async function executeAction(page: Page, action: PlaywrightAction, optional: boolean): Promise<boolean> {
  try {
    if (action.type === 'navigate') {
      await page.goto(action.url ?? '');
      return true;
    }

    if (action.type === 'wait') {
      await page.waitForTimeout(parseInt(action.actionArg ?? '1000', 10));
      return true;
    }

    if (action.type === 'skip') {
      return false;
    }

    const locator = buildLocator(page, action);

    switch (action.type) {
      case 'scroll':
        await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
        break;

      case 'assert': {
        const { expect } = await import('@playwright/test');
        const assertType = action.assertType ?? 'visible';
        switch (assertType) {
          case 'visible':
            await expect(locator).toBeVisible({ timeout: optional ? 5000 : 10000 });
            break;
          case 'hidden':
            await expect(locator).not.toBeVisible({ timeout: optional ? 5000 : 10000 });
            break;
          case 'text':
            await expect(locator).toContainText(action.actionArg ?? '', { timeout: optional ? 5000 : 10000 });
            break;
          case 'count': {
            const count = parseInt(action.actionArg ?? '1', 10);
            await expect(locator).toHaveCount(count, { timeout: optional ? 5000 : 10000 });
            break;
          }
        }
        break;
      }

      case 'click': {
        const force = action.forceClick ?? false;
        try {
          await locator.click({ force, timeout: optional ? 8000 : 10000 });
        } catch (e) {
          const msg = (e as Error).message;
          if (!force && (msg.includes('intercepts pointer events') || msg.includes('not stable'))) {
            // Retry with force: true for elements with overlaying labels (e.g. date picker inputs)
            await locator.click({ force: true, timeout: 5000 });
          } else {
            throw e;
          }
        }
        break;
      }
      case 'fill':
        await locator.fill(action.actionArg ?? '', { timeout: optional ? 8000 : 10000 });
        break;
      case 'selectOption':
        await locator.selectOption(action.actionArg ?? '', { timeout: optional ? 8000 : 10000 });
        break;
      case 'press':
        await locator.press(action.actionArg ?? '');
        break;
    }

    return true;
  } catch (err) {
    if (!optional) {
      console.warn(`\n     Error: ${(err as Error).message}`);
    }
    return false;
  }
}

function buildLocator(page: Page, action: PlaywrightAction) {
  const arg = action.locatorArg ?? '';
  const opts = action.locatorOptions ?? {};

  let locator;
  switch (action.locatorMethod) {
    case 'getByRole':
      locator = page.getByRole(arg as Parameters<Page['getByRole']>[0], opts as Parameters<Page['getByRole']>[1]);
      break;
    case 'getByTestId':
      locator = page.getByTestId(arg);
      break;
    case 'getByPlaceholder':
      locator = page.getByPlaceholder(arg, opts as Parameters<Page['getByPlaceholder']>[1]);
      break;
    case 'getByText':
      locator = page.getByText(arg, opts as Parameters<Page['getByText']>[1]);
      break;
    case 'getByLabel':
      locator = page.getByLabel(arg, opts as Parameters<Page['getByLabel']>[1]);
      break;
    default:
      locator = page.locator(arg);
  }

  if (action.useFirst) return locator.first();
  if (action.useNth !== undefined) return locator.nth(action.useNth);
  return locator;
}

/**
 * Silently closes the subscription/offers popup after every navigation.
 * Mirrors what the generated spec does at runtime via global-setup or inline try/catch.
 */
async function autoClosePopup(page: Page, selector?: string): Promise<void> {
  if (!selector) return;
  try {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout: 6000 });
    await page.locator(selector).first().click();
    process.stdout.write(' (popup closed)');
  } catch {
    // Popup not present — that's fine
  }
}

/**
 * Silently accepts the cookie/privacy consent banner after every navigation.
 * Not recorded in the spec — the generated spec uses global-setup storageState instead.
 * If consent causes a redirect, navigates back to the original URL.
 */
async function autoAcceptConsent(page: Page, originalUrl: string): Promise<void> {
  try {
    const consentBtn = page.locator('#adopt-accept-all-button');
    await consentBtn.waitFor({ state: 'visible', timeout: 12000 });
    await consentBtn.click();
    // Consent may redirect to a different domain — navigate back
    await page.waitForTimeout(1500);
    if (!page.url().startsWith(new URL(originalUrl).origin)) {
      await page.goto(originalUrl, { waitUntil: 'domcontentloaded' });
      try {
        await page.waitForLoadState('networkidle', { timeout: 5000 });
      } catch { /* ok */ }
    }
    process.stdout.write(' (consent accepted)');
  } catch {
    // Consent banner not present — already accepted or not required
  }
}
