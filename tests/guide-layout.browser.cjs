/* Optional real-browser regression suite. No browser dependency is needed by
   the guides or model tests. See README for PUPPETEER_MODULE / CHROME_PATH. */
'use strict';
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const root = resolve(__dirname, '..');
const guides = ['how-the-web-works.html', 'how-data-travels.html', 'how-operating-systems-work.html', 'row-vs-columnar-databases.html'];
(async () => {
  const server = createServer(async (req, res) => {
    try {
      const path = resolve(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/interactive-guides\//, ''));
      if (!path.startsWith(root + '/')) throw Error('Outside project');
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' })[extname(path)] || 'text/plain');
      res.end(await readFile(path));
    } catch { res.statusCode = 404; res.end('Not found'); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => { if (!/^(file:|about:|data:|http:\/\/127\.0\.0\.1)/.test(request.url())) errors.push('Unexpected network: ' + request.url()); });
    await page.evaluateOnNewDocument(() => {
      const set = window.setInterval.bind(window), clear = window.clearInterval.bind(window);
      window.__guideTimers = new Set(); window.__fastGuidePlayback = false;
      window.setInterval = (fn, ms, ...args) => { const id = set(fn, window.__fastGuidePlayback ? 35 : ms, ...args); window.__guideTimers.add(id); return id; };
      window.clearInterval = id => { window.__guideTimers.delete(id); clear(id); };
    });
    const base = `http://127.0.0.1:${server.address().port}/interactive-guides/`;
    const text = id => page.$eval('#' + id, node => node.textContent);
    const tab = id => page.$eval('#guide-tab-' + id, node => node.click());
    const click = id => page.click('#' + id);
    const input = (id, value) => page.$eval('#' + id, (node, v) => { node.value = String(v); node.dispatchEvent(new Event('input', { bubbles: true })); }, value);
    const frameClick = async (context, selector) => {
      // A sticky parent header can cover an otherwise intersecting iframe button.
      await context.$eval(selector, node => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
      await context.click(selector);
    };
    const choice = (id, value, context = page) => frameClick(context, `[data-choice-for="${id}"] [data-choice-value="${value}"]`);
    const checked = id => page.$eval(`[data-choice-for="${id}"] [aria-checked="true"]`, node => node.dataset.choiceValue);
    const active = () => page.evaluate(() => GuideLayout.active);
    const seek = (name, step) => input(name + '-player-seek', step);
    const end = async name => seek(name, await page.$eval('#' + name + '-player-seek', node => node.max));
    await page.setViewport({ width: 1280, height: 950 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);

    // Every topic on every article, both delivery modes, themes, and key widths.
    for (const protocol of ['http', 'file']) for (const theme of ['light', 'dark']) for (const width of [320, 390, 1280]) {
      await page.setViewport({ width, height: 950 });
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
      for (const file of guides) {
        await page.goto((protocol === 'http' ? base : 'file://' + root + '/') + file, { waitUntil: 'networkidle0' });
        if (file === 'how-the-web-works.html') {
          assert.equal(await page.$('.guide-dock'), null, 'web guide has only its journey navigator');
          assert.equal(await page.$$eval('.step-links a', nodes => nodes.length), 6);
          for (let step = 0; step < 6; step++) {
            await frameClick(page, `[data-step="${step}"]`);
            assert.equal(await page.$$eval('[data-journey-step]:not([hidden])', nodes => nodes.length), 1);
            assert.equal(await page.$eval('[aria-current="step"]', node => node.dataset.step), String(step));
            assert(await page.$eval(`[data-step="${step}"]`, node => { const r = node.getBoundingClientRect(), p = node.parentElement.getBoundingClientRect(); return r.left >= p.left - 2 && r.right <= p.right + 2; }), 'active journey step stays in strip');
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${file} ${width} step ${step} overflows`);
          }
          assert.equal(await page.$$eval('[data-journey-step]', nodes => nodes.length), 6);
          await frameClick(page, '[data-step="3"]'); await click('signed-in');
          assert((await text('page-identity')).includes('demo user'));
          await frameClick(page, '[data-step="4"]'); await click('resources-cached');
          assert((await text('resources-wire')).includes('no request'));
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        } else {
          assert(await page.$('.guide-enhanced'), file);
          const ids = await page.$$eval('.guide-panel', nodes => nodes.map(node => node.id));
          assert.equal(ids.length, file.includes('operating') ? 9 : file.includes('row-vs-columnar') ? 5 : 7);
          for (const id of ids) {
            await tab(id); assert.equal(await active(), id);
            assert.equal(await page.$$eval('.guide-panel:not([hidden])', nodes => nodes.length), 1);
            assert.equal(await page.$$eval('.guide-tab[aria-selected="true"]', nodes => nodes.length), 1);
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${file} ${width} ${id} overflows`);
            assert(await page.$eval('#guide-tab-' + id, node => { const r = node.getBoundingClientRect(), p = node.parentElement.getBoundingClientRect(); return r.left >= p.left - 2 && r.right <= p.right + 2; }), 'selected tab stays in the strip');
            assert(!/interactive (?:field )?guide/i.test(await page.$eval('#' + id, node => node.innerText)), 'no redundant subtitle');
          }
        }
        const labelIssues = await page.$$eval('.choice-cards', groups => groups.filter(group => {
          const ids = (group.getAttribute('aria-labelledby') || '').split(' ').filter(Boolean);
          return (!ids.length && !group.getAttribute('aria-label')) || ids.some(id => !document.getElementById(id));
        }).map(group => group.dataset.choiceFor));
        assert.deepEqual(labelIssues, []);
        const duplicateIDs = await page.$$eval('[id]', nodes => nodes.map(node => node.id).filter((id, i, ids) => ids.indexOf(id) !== i));
        assert.deepEqual(duplicateIDs, []);
        await page.evaluate(() => window.scrollTo({ top: 500, behavior: 'instant' }));
        const dock = file === 'how-the-web-works.html' ? '.journey-nav' : '.guide-dock';
        assert.equal(await page.$eval(dock, node => getComputedStyle(node).position), 'sticky');
        assert(await page.$eval(dock, node => node.getBoundingClientRect().top >= -1));
      }
      console.log(`PASS all topics: ${protocol}, ${theme}, ${width}px`);
    }

    // Native models keep state while navigation changes presentation only.
    await page.setViewport({ width: 1280, height: 950 });
    await page.goto(base + 'how-operating-systems-work.html#memory-title', { waitUntil: 'networkidle0' });
    assert.equal(await active(), 'memory');
    assert(await page.evaluate(() => document.getElementById('memory-title').getBoundingClientRect().top >= document.querySelector('.guide-dock').getBoundingClientRect().bottom));
    await choice('memory-process', 'player'); await input('memory-address', 31);
    await tab('files'); await click('file-open'); await input('file-name', 'shopping.txt'); await click('file-rename');
    assert((await text('file-handle')).includes('inode 42')); assert((await checked('file-choice')) === '42');
    assert((await page.$eval('[data-choice-for="file-choice"]', node => node.textContent)).includes('shopping.txt'));
    await tab('memory'); assert.equal(await checked('memory-process'), 'player'); assert.equal(await page.$eval('#memory-address', node => node.value), '31');
    await page.focus('[data-choice-for="memory-process"] [aria-checked="true"]'); await page.keyboard.press('ArrowLeft'); assert.equal(await checked('memory-process'), 'editor');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.choiceValue), 'editor');
    await page.focus('#guide-tab-memory'); await page.keyboard.press('ArrowRight'); assert.equal(await active(), 'pressure');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'guide-tab-pressure');
    await page.keyboard.press('End'); assert.equal(await active(), 'journey'); await page.keyboard.press('Home'); assert.equal(await active(), 'kernel');
    await tab('memory'); await tab('files'); await page.goBack(); assert.equal(await active(), 'memory');
    await page.evaluate(() => { location.hash = '#memory-heading'; });
    await page.waitForFunction(() => location.hash === '#memory-heading');
    assert(await page.evaluate(() => document.getElementById('memory-heading').getBoundingClientRect().top >= document.querySelector('.guide-dock').getBoundingClientRect().bottom));
    await page.goto(base + 'how-operating-systems-work.html#%', { waitUntil: 'networkidle0' }); assert.equal(await active(), 'kernel'); assert(await page.$('[data-choice-for="kernel-action"]'));
    await tab('journey'); await seek('journey', 8); await choice('journey-scenario', 'normal'); assert.equal(await page.$eval('#journey-player-seek', node => node.value), '8', 'selected card must not restart the model');
    for (const [scenario, reads] of Object.entries({ normal: '2', pressure: '3', slow: '2', denied: '1' })) {
      await choice('journey-scenario', scenario); await end('journey'); assert.equal(await text('journey-reads'), reads);
      assert.equal(await text('journey-disk-value'), scenario === 'denied' ? 'Buy milk' : 'Buy milk + bread');
    }
    await choice('journey-scenario', 'normal'); await click('journey-player-play'); await tab('memory');
    assert.equal(await page.evaluate(() => window.__guideTimers.size), 0); assert.equal(await text('journey-player-play'), 'Autoplay');
    console.log('PASS OS state, radio/tab keyboard controls, history, nested/malformed hashes, same-choice clicks, and autoplay pause');

    await page.goto(base + 'how-data-travels.html', { waitUntil: 'networkidle0' });
    await choice('preset', 'loss'); await choice('transport', 'udp'); await click('finish');
    assert((await text('metric-data')).includes('1,800'));
    await tab('applications');
    for (const value of ['clean', 'shared', 'distance', 'loss', 'reorder', 'busy']) {
      await choice('comparison-preset', value);
      const output = await text('application-comparison'); assert(output.includes('TCP-style') && output.includes('UDP-style'));
      if (value === 'reorder') assert(output.includes('A2: 80 ms'));
      if (value === 'loss') assert(output.includes('Missing A2'));
    }
    await tab('experiment'); assert.equal(await checked('preset'), 'loss'); assert.equal(await checked('transport'), 'udp');
    await choice('preset', 'custom'); assert(await page.$eval('#settings', node => node.open)); await input('capacity', 192); await page.waitForFunction(() => document.querySelector('[data-choice-for="preset"] [aria-checked="true"]').dataset.choiceValue === 'custom');
    await tab('delivery'); await click('try-reorder'); assert.equal(await active(), 'experiment'); assert.equal(await page.evaluate(() => document.activeElement.id), 'experiment-title');
    await tab('realtime'); await page.click('[data-rt-time="1"]'); await page.click('[data-mode="sse"]'); assert.equal(await text('rt-clock'), '1 s'); assert((await text('rt-browser-inbox')).includes('Your order is ready.'));
    await click('rt-play'); await tab('routes'); assert.equal(await page.evaluate(() => window.__guideTimers.size), 0);
    await tab('realtime'); assert.equal(await text('rt-clock'), '1 s');
    console.log('PASS network presets/sync, independent comparisons, cross-topic shortcuts, and messaging state');

    await page.goto(base + 'how-the-web-works.html', { waitUntil: 'networkidle0' });
    const webStep = step => frameClick(page, `[data-step="${step}"]`);
    const webActive = () => page.$eval('[data-journey-step]:not([hidden])', node => node.id);
    assert.equal(await webActive(), 'address');
    assert.equal(await page.$('#scenario'), null, 'no upfront experiment matrix');
    for (let i = 0; i < 5; i++) await click('next');
    assert.equal(await webActive(), 'rendering'); await click('journey-water'); assert((await text('journey-water')).includes('Watered'));
    assert.equal(await page.$('#repeat-visit'), null); assert.equal(await page.$('#continue-session'), null, 'no end-of-journey examples');
    await webStep(3); assert((await text('page-identity')).includes('guest')); assert((await text('http-wire')).includes('[No session cookie]'));
    await click('signed-in'); assert((await text('page-identity')).includes('demo user')); assert((await text('http-wire')).includes('Cookie: demo_session=demo-7'));
    assert((await text('http-wire')).includes('<p>Welcome back, demo user.</p>'), 'identity is part of server HTML');
    assert((await text('http-wire')).includes('Cache-Control: private, no-store'));
    await webStep(4); const networkPreview = await page.$eval('#browser-preview', node => node.innerHTML);
    assert((await text('resources-wire')).includes('GET → 200 OK')); await click('resources-cached');
    assert.equal(await webActive(), 'resources', 'cache toggle does not restart the visit');
    assert.equal(await page.$eval('#browser-preview', node => node.innerHTML), networkPreview, 'cache changes source, not the page');
    assert.equal((await text('resources-wire')).match(/no request/g).length, 3);
    assert(!(await page.$eval('#dns-cached', node => node.checked)), 'asset caching does not change DNS caching');
    assert((await text('time-total')).includes('460 ms'), 'fresh assets add no modeled network time');
    await click('resources-cached'); assert((await text('time-total')).includes('580 ms'));
    await click('resources-cached');
    await click('load-css'); assert.equal(await page.$('.garden.styled'), null);
    await click('load-js'); assert((await text('page-identity')).includes('demo user'), 'server recognizes the user without CSS or JavaScript');
    await click('missing-image'); assert((await text('resources-wire')).includes('404')); assert(await page.$('#browser-preview .image-failed'));
    assert.equal((await text('resources-wire')).match(/no request/g)?.length || 0, 0, 'disabled resources and cache-miss image make no fresh cache hits');
    await webStep(5); assert(await page.$eval('#journey-water', node => node.disabled));
    await webStep(4); await click('load-js'); await webStep(5); await click('journey-water');
    await webStep(3); assert(await page.$eval('#signed-in', node => node.checked)); await click('signed-in');
    assert((await text('page-identity')).includes('guest')); assert(!(await text('http-wire')).includes('Cookie: demo_session'));
    await webStep(4); assert(await page.$eval('#resources-cached', node => node.checked)); assert((await text('page-identity')).includes('guest'), 'cached public assets do not preserve another user’s greeting');
    await webStep(3); await click('signed-in'); await choice('path', '/missing'); assert((await text('http-wire')).includes('404'));
    assert((await text('http-wire')).includes('Cookie: demo_session')); assert((await text('browser-preview')).includes('Plant not found')); assert.equal(await page.$('#page-identity'), null);
    await webStep(4); assert((await text('resources-wire')).includes('No referenced')); assert(await page.$eval('#resources-cached', node => node.disabled));
    await webStep(3); await choice('path', '/broken'); assert((await text('browser-preview')).includes('500'));
    await choice('path', '/plants'); await click('slow-server'); assert((await text('server-timing')).includes('1,800'));
    await click('replay'); assert.equal(await webActive(), 'address'); assert(!(await page.$eval('#signed-in', node => node.checked))); assert(!(await page.$eval('#resources-cached', node => node.checked)));
    await webStep(1); await click('dns-cached'); assert((await text('dns-wire')).includes('local DNS cache'));
    await click('dns-failure'); assert((await text('browser-preview')).includes('Address not found'));
    assert(await page.$eval('#next', node => node.disabled));
    assert.equal(await page.$eval('[data-step="2"]', node => node.getAttribute('aria-disabled')), 'true');
    await page.$eval('[data-step="5"]', node => node.click()); assert.equal(await webActive(), 'dns');
    await click('dns-failure'); await click('next'); await click('invalid-cert');
    assert((await text('connection-wire')).includes('not sent')); assert((await text('browser-preview')).includes('Connection stopped'));
    assert(await page.$eval('#next', node => node.disabled));
    await click('invalid-cert'); await webStep(4); await click('resources-cached'); assert((await text('resources-wire')).includes('fresh browser cache'));
    await webStep(5); await page.focus('[data-step="5"]'); await page.keyboard.press('Home'); assert.equal(await webActive(), 'address');
    await page.keyboard.press('ArrowRight'); assert.equal(await webActive(), 'dns');
    await page.keyboard.press('ArrowLeft'); assert.equal(await webActive(), 'address');
    await page.keyboard.press('End'); assert.equal(await webActive(), 'rendering');
    await page.goBack(); assert.equal(await webActive(), 'address'); await page.goForward(); assert.equal(await webActive(), 'rendering');
    await click('replay'); assert.equal(await webActive(), 'address'); assert(!(await page.$eval('#dns-cached', node => node.checked)));
    for (const [hash, expected] of [['#http-title', 'http'], ['#sessions', 'http'], ['#journey', 'address'], ['#%', 'address']]) {
      await page.goto(base + 'how-the-web-works.html' + hash, { waitUntil: 'networkidle0' }); assert.equal(await webActive(), expected);
    }
    await page.goto(base + 'how-the-web-works.html#sessions', { waitUntil: 'networkidle0' }); assert.equal(await webActive(), 'http');
    assert(await page.$eval('#sessions', node => node.open), 'old session link opens the embedded explanation');
    const webClosed = await page.$$eval('details:not([open])', nodes => nodes.length);
    await page.evaluate(() => dispatchEvent(new Event('beforeprint'))); await page.emulateMediaType('print');
    assert(await page.$$eval('[data-journey-step]', nodes => nodes.every(node => getComputedStyle(node).display !== 'none')));
    assert.equal(await page.$eval('#static-url', node => getComputedStyle(node).display), 'inline', 'browser address remains printable');
    assert.equal(await page.$$eval('details:not([open])', nodes => nodes.length), 0);
    await page.emulateMediaType('screen'); await page.evaluate(() => dispatchEvent(new Event('afterprint')));
    assert.equal(await page.$$eval('details:not([open])', nodes => nodes.length), webClosed);
    for (const width of [320, 390]) {
      await page.setViewport({ width, height: 568 });
      await page.goto(base + 'how-the-web-works.html#resources', { waitUntil: 'networkidle0' }); await click('next');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'rendering-title');
      assert(await page.$eval('#rendering-title', node => { const r = node.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), 'mobile focus stays visible after Next');
      assert(await page.$eval('#rendering-title', node => node.getBoundingClientRect().top >= document.querySelector('.journey-nav').getBoundingClientRect().bottom), 'mobile heading clears sticky navigation');
    }
    await page.setViewport({ width: 1280, height: 950 });
    console.log('PASS web single journey, contextual failures/recovery, same-preview resources, caching, session requests, keyboard/history/deep links, mobile focus, and print');

    await page.goto(base + 'row-vs-columnar-databases.html', { waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('h1', node => node.textContent), 'Row vs columnar databases');
    assert((await text('difference')).includes('Iceberg is a table format, not a database engine'));
    await input('columns', 10); await tab('layout'); await page.click('[data-layout-query="lookup"]'); assert((await text('layout-result')).includes('AAPL'));
    await tab('difference'); assert.equal(await text('column-count'), '10');
    await tab('writes');
    for (const mode of ['cow', 'mor']) { await page.click('[data-mode="' + mode + '"]'); await click('write-next'); await click('write-next'); assert.equal(await text('iceberg-new-reader'), '105'); assert.equal(await text('iceberg-old-reader'), '100'); }
    await tab('fit'); await page.click('[data-workload="lookup"]'); assert((await text('workload-verdict')).includes('InnoDB'));
    await page.$eval('#partition-toggle', node => { node.closest('details').open = true; }); await click('partition-toggle'); assert((await text('iceberg-partition-files')).includes('day(time)'));
    console.log('PASS storage queries, snapshots, partition controls, and preserved state');

    // The reference guide retains its own chapters; small selects become cards
    // even when the iframe demo replaces its control subtree.
    for (const width of [320, 390, 1280]) {
      await page.setViewport({ width, height: 950 }); await page.goto(base + 'ai.html', { waitUntil: 'networkidle0' });
      assert.equal(await text('chapter-position'), 'How LLMs work');
      assert(await page.$eval('#chapter-previous', node => node.disabled));
      assert.equal(await text('chapter-next'), 'How agents work →');
      await click('chapter-next'); assert.equal(await text('chapter-position'), 'How agents work');
      assert.equal(await text('chapter-previous'), '← How LLMs work'); assert(await page.$eval('#chapter-next', node => node.disabled));
      await click('chapter-previous'); assert.equal(await text('chapter-position'), 'How LLMs work');
      const frame = await (await page.$('#frame-llm')).contentFrame();
      await frame.waitForSelector('[data-choice-for="query"]'); await choice('query', '1', frame);
      assert.equal(await frame.$eval('#query', node => node.value), '1');
      await frameClick(frame, '[data-part="parameters"]'); await frame.waitForSelector('[data-choice-for="size-layers"]');
      await choice('size-layers', '64', frame); assert.equal(await frame.$eval('#size-layers', node => node.value), '64');
      assert.equal(await frame.evaluate(() => document.activeElement.dataset.choiceValue), '64');
      await choice('size-gqa', 'true', frame); await frameClick(frame, '[data-part="quantization"]'); await frameClick(frame, '[data-bits="4"]');
      await page.click('#chapter-tab-agents'); const agents = await (await page.$('#frame-agents')).contentFrame();
      await frameClick(agents, '[data-tab="loop"]'); await agents.waitForSelector('[data-choice-for="call-limit"]');
      await choice('call-limit', '4', agents); await frameClick(agents, '#loop-next');
      assert(await agents.$$eval('[data-choice-for="call-limit"] button', nodes => nodes.every(node => node.disabled)));
      await frameClick(agents, '#loop-reset'); assert(await agents.$$eval('[data-choice-for="call-limit"] button', nodes => nodes.every(node => !node.disabled)));
      await page.click('#chapter-tab-llm'); await frameClick(frame, '[data-part="parameters"]'); assert.equal(await frame.$eval('#size-layers', node => node.value), '64');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert(!/interactive guide/i.test(await page.$eval('.book-label', node => node.textContent)));
      if (width === 1280) {
        await page.emulateMediaType('print');
        assert(await frame.$eval('#size-layers', node => getComputedStyle(node).display !== 'none'), 'selected parameter controls remain printable');
        await page.emulateMediaType('screen');
      }
    }
    console.log('PASS AI chapters, dynamic controls, keyboard focus, disabled cards, and state retention');

    await page.goto(base + 'how-operating-systems-work.html#save', { waitUntil: 'networkidle0' });
    const closedBefore = await page.$$eval('details:not([open])', nodes => nodes.length);
    await page.evaluate(() => dispatchEvent(new Event('beforeprint'))); await page.emulateMediaType('print');
    assert(await page.$$eval('.guide-panel', nodes => nodes.every(node => getComputedStyle(node).display !== 'none')));
    assert.equal(await page.$$eval('details:not([open])', nodes => nodes.length), 0);
    await page.emulateMediaType('screen'); await page.evaluate(() => dispatchEvent(new Event('afterprint')));
    assert.equal(await page.$$eval('details:not([open])', nodes => nodes.length), closedBefore);
    await page.setJavaScriptEnabled(false);
    for (const file of guides) {
      await page.goto(base + file, { waitUntil: 'networkidle0' }); assert.equal(await page.$('.guide-dock'), null);
      assert(await page.$$eval('main > section, [data-journey-step]', nodes => nodes.every(node => !node.hidden)));
      if (file === 'how-the-web-works.html') {
        assert.equal(await page.$$eval('[data-journey-step]', nodes => nodes.length), 6);
        assert(await page.$$eval('[data-journey-step]', nodes => nodes.every(node => node.innerText.length > 100)));
      }
    }
    await page.setJavaScriptEnabled(true); await page.setRequestInterception(true);
    page.on('request', request => { if (/\/(?:guide-layout|web-guide)\.js$/.test(request.url())) request.abort(); else request.continue(); });
    await page.goto(base + 'how-operating-systems-work.html', { waitUntil: 'networkidle0' });
    assert.equal(await page.$('.guide-dock'), null); assert(!(await page.$eval('#kernel-action', node => node.hidden)));
    await page.goto(base + 'how-the-web-works.html', { waitUntil: 'networkidle0' });
    assert(await page.$$eval('[data-journey-step]', nodes => nodes.every(node => !node.hidden)), 'missing web script leaves all explanations readable');
    assert.deepEqual(errors, []);
    console.log('PASS print restoration, no-JS article fallback, missing-presentation native controls, and zero script errors');
  } finally { if (browser) await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
