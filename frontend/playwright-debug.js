const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on('console', (msg) => {
    console.log('BROWSER CONSOLE:', msg.type(), msg.text());
  });
  page.on('pageerror', (err) => {
    console.log('PAGE ERROR:', err);
  });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  const html = await page.content();
  console.log('---- PAGE HTML START ----');
  console.log(html.slice(0, 2000));
  console.log('---- PAGE HTML END ----');

  await page.screenshot({ path: 'playwright-screenshot.png', fullPage: true });
  console.log('Screenshot saved: playwright-screenshot.png');

  await browser.close();
})();
