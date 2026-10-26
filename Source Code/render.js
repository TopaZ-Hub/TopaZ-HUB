const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  for (const name of ['logo_editing', 'logo_hub']) {
    const svg = fs.readFileSync(__dirname + '/' + name + '.svg', 'utf8');
    for (const s of [16, 24, 32, 48, 64, 128, 256, 512]) {
      await p.setViewportSize({ width: s, height: s });
      await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
      await p.screenshot({ path: `${__dirname}/${name}_${s}.png`, omitBackground: true });
    }
  }
  await b.close();
})();
