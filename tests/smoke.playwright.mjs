// Simple smoke test: ensure backend health endpoint responds and the SPA renders without runtime errors.
import { chromium } from 'playwright';

const targetUrl = process.env.TARGET_URL || 'http://frontend:80';
const healthUrl = process.env.BACKEND_HEALTH || 'http://backend:3001/health';

async function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  // Backend health check
  const healthRes = await fetch(healthUrl, { redirect: 'manual' });
  assert(healthRes.ok, `Health check failed: ${healthRes.status} ${healthRes.statusText}`);
  const healthJson = await healthRes.json();
  assert(healthJson.status === 'ok', `Unexpected health payload: ${JSON.stringify(healthJson)}`);

  // Frontend render check
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  const title = await page.title();
  const hasContent = await page.locator('#app').evaluate((el) => {
    if (!el) return false;
    return el.childNodes.length > 0;
  });

  await browser.close();

  assert(pageErrors.length === 0, `Page errors: ${pageErrors.map((e) => e.message).join('; ')}`);
  assert(title.includes('Dispatcharr'), `Unexpected page title: ${title}`);
  assert(hasContent, 'App container is empty');

  console.log('Smoke test passed:', { title, health: healthJson });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
