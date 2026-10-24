// Full-page captures of the live site, both lenses: node scripts/capture-live.mjs FDX
import { chromium } from 'playwright';
const t = (process.argv[2] || 'FDX').toUpperCase();
const out = process.env.HOME + '/Downloads/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
try {
  await p.goto('https://earnings-lens-sigma.vercel.app', { waitUntil: 'networkidle' });
  const box = p.locator('input').first();
  await box.click();
  await box.fill(t);
  await p.getByRole('button', { name: 'Go', exact: true }).click();
  await p.getByText('Verdict:').first().waitFor({ timeout: 60000 });
  await p.getByText('Liquidity vs debt').first().waitFor({ timeout: 60000 });
  await p.waitForTimeout(3000);
  await p.screenshot({ path: out + t + '-CoreThread-full-page.png', fullPage: true });
  await p.getByText('SaaS · NexCore').first().click();
  await p.getByText('What this means for NexCore').first().waitFor({ timeout: 30000 });
  await p.waitForTimeout(3000);
  await p.screenshot({ path: out + t + '-NexCore-full-page.png', fullPage: true });
  console.log('Saved ' + t + ' to ~/Downloads');
} catch (e) {
  await p.screenshot({ path: out + 'capture-debug.png', fullPage: true });
  console.log('Failed: ' + e.message.split('\n')[0] + ' (see ~/Downloads/capture-debug.png)');
}
await b.close();
