// Inspect the real temporary host created by verify-dsh-host.mjs, with a fresh browser context.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const artifacts = resolve(process.argv[2]);
const runtime = process.env.DSH_VERIFY_PLAYWRIGHT ?? 'C:/Users/xiaoz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(runtime).href);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const report = { success: false, errors };
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
  page.on('pageerror', (error) => errors.push(String(error)));
  const url = (await readFile(join(artifacts, 'browser-url.txt'), 'utf8')).trim();
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  report.status = response?.status() ?? null;
  if (report.status !== 200) throw new Error(`Host browser HTML failed: HTTP ${report.status}`);
  await page.locator('button').first().waitFor({ state: 'visible', timeout: 30000 });
  const continueButton = page.getByRole('button', { name: '继续', exact: true });
  await continueButton.click();
  await page.getByText('标准模式', { exact: true }).click();
  await writeFile(join(artifacts, 'actual-host-mode-menu.txt'), await page.locator('body').innerText());
  await page.getByText('红队模式', { exact: true }).waitFor({ state: 'visible' });
  await page.screenshot({ path: join(artifacts, 'actual-host-mode-menu.png'), fullPage: true });
  await page.getByText('红队模式', { exact: true }).click();
  await page.screenshot({ path: join(artifacts, 'actual-host.png'), fullPage: true });
  const text = await page.locator('body').innerText();
  await writeFile(join(artifacts, 'actual-host.txt'), text);
  report.title = await page.title();
  if (errors.length) throw new Error(`Host browser raised page errors: ${errors.join('\n')}`);
  report.success = true;
  console.log(JSON.stringify({ artifacts, ...report, text }));
} catch (error) {
  report.error = String(error);
  process.exitCode = 1;
  console.error(report.error);
} finally {
  await writeFile(join(artifacts, 'browser-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
