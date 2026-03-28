import { chromium, FullConfig } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const STATE_FILE = path.join(__dirname, '.auth', 'consent-state.json');
const BASE_URL = process.env.AUTOQA_BASE_URL ?? 'https://es.stayforlong.com';

async function globalSetup(_config: FullConfig) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('→ Navigating to', BASE_URL);
  await page.goto(BASE_URL);
  console.log('→ Current URL:', page.url());

  // Accept cookie consent if present (Adopt/Usercentrics banner)
  const consentBtn = page.locator('#adopt-accept-all-button');
  const visible = await consentBtn.isVisible({ timeout: 8000 }).catch(() => false);
  console.log('→ Consent button visible:', visible);
  if (visible) {
    await consentBtn.click();
    await page.waitForTimeout(2000);
    console.log('→ After consent click URL:', page.url());
    await page.goto(BASE_URL);
  }

  // Dismiss exclusive offers popup if present
  const closeIcon = page.locator('[data-testid="CloseIcon"]').first();
  const popupVisible = await closeIcon.isVisible({ timeout: 5000 }).catch(() => false);
  console.log('→ Popup visible:', popupVisible);
  if (popupVisible) {
    await closeIcon.locator('..').click();
    await page.waitForTimeout(500);
  }

  await context.storageState({ path: STATE_FILE });
  await browser.close();

  console.log('✓ Consent accepted and state saved to', STATE_FILE);
}

export default globalSetup;
