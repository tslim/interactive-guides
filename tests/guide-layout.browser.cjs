/* Optional real-browser regression suite. No browser dependency is needed by
   the guides or model tests. See README for PUPPETEER_MODULE / CHROME_PATH. */
'use strict';
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const root = resolve(__dirname, '..');
const guides = ['how-the-web-works.html', 'how-data-travels.html', 'how-live-messages-work.html', 'how-operating-systems-work.html', 'how-virtual-machines-work.html', 'how-databases-store-and-retrieve-data.html'];
const networkModel = require(resolve(root, 'assets/network-model.js'));
const osModel = require(resolve(root, 'assets/os-model.js'));
const osJourneyModel = require(resolve(root, 'assets/os-journey-model.js'));
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
        } else if (file === 'how-data-travels.html') {
          assert.equal(await page.$('.guide-dock'), null, 'one packet journey navigator');
          assert.equal(await page.$$eval('.step-links a', nodes => nodes.length), 5);
          assert.equal(await page.$('#preset'), null, 'experiments are local, not an upfront preset wall');
          for (let step = 0; step < 5; step++) {
            await frameClick(page, `[data-step="${step}"]`);
            assert.equal(await page.$$eval('[data-journey-step]:not([hidden])', nodes => nodes.length), 1);
            assert.equal(await page.$eval('[aria-current="step"]', node => node.dataset.step), String(step));
            assert(await page.$eval(`[data-step="${step}"]`, node => { const r = node.getBoundingClientRect(), p = node.parentElement.getBoundingClientRect(); return r.left >= p.left - 2 && r.right <= p.right + 2; }));
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${file} ${width} step ${step} overflows`);
            assert.equal(await page.$eval('#lane-receiver', node => node.hidden), step < 3);
            assert.equal(await page.$eval('#lane-link', node => node.hidden), step < 2);
            assert.equal(await page.$eval('#lane-sender', node => node.hidden), step !== 0);
            assert(await page.$eval('.scene', node => {
              const firstLane = node.querySelector('.lane');
              return Boolean(node.querySelector('.event-caption').compareDocumentPosition(firstLane) & Node.DOCUMENT_POSITION_FOLLOWING) && Boolean(node.querySelector('#event-inspector').compareDocumentPosition(firstLane) & Node.DOCUMENT_POSITION_FOLLOWING);
            }), 'event tracker and advanced controls precede the packet lanes');
            if (step >= 3) assert.equal(await page.$eval('.scene > .lane', node => node.id), 'lane-receiver', 'receiver leads the scene when data arrives or is used');
          }
          await choice('app-kind', 'audio');
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        } else if (file === 'how-live-messages-work.html') {
          assert.equal(await page.$('.guide-dock'), null, 'messaging has one focused workspace');
          assert.equal(await page.$('[data-rt-time]'), null, 'no second-by-second navigation');
          assert.equal(await page.$$eval('.mode-nav [data-mode]', nodes => nodes.length), 3);
          assert.equal(await page.$('.concept-grid'), null, 'no repeated protocol cards below the simulator');
          assert.equal(await page.$eval('#realtime', node => node.firstElementChild.id), 'rt-player', 'simulator follows the compact header directly');
          assert(await page.$eval('#rt-player', node => node.firstElementChild.classList.contains('rt-controls')), 'no description block ahead of playback');
          for (const mode of ['poll', 'sse', 'ws']) {
            await frameClick(page, `[data-mode="${mode}"]`);
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${file} ${width} ${mode} overflows`);
          }
        } else if (file === 'how-operating-systems-work.html') {
          assert.equal(await page.$('.guide-dock'), null, 'one editor journey, not nine topic tabs');
          assert.equal(await page.$$eval('.step-links a', nodes => nodes.length), 5);
          for (let step = 0; step < 5; step++) {
            await frameClick(page, `[data-step="${step}"]`);
            assert.equal(await page.$$eval('[data-journey-step]:not([hidden])', nodes => nodes.length), 1);
            assert.equal(await page.$eval('[aria-current="step"]', node => node.dataset.step), String(step));
            assert(await page.$eval(`[data-step="${step}"]`, node => { const r = node.getBoundingClientRect(), p = node.parentElement.getBoundingClientRect(); return r.left >= p.left - 2 && r.right <= p.right + 2; }));
            assert(await page.$eval('#stage-event-previous', node => node.disabled), 'each new stage starts with no earlier event');
            assert.equal(await page.$eval('#copy-os', node => node.hidden), step < 2);
            assert.equal(await page.$eval('#copy-device', node => node.hidden), step !== 4);
            assert.equal(await page.$eval('#copy-disk', node => node.hidden), step < 2);
            assert.equal(await page.$eval('.copy-board', node => node.hidden), step < 2);
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${file} ${width} step ${step} overflows`);
          }
        } else if (file === 'how-virtual-machines-work.html') {
          assert.equal(await page.$eval('h1', node => node.textContent), 'How processes, containers, and virtual machines isolate work');
          assert.equal(await page.title(), 'How processes, containers, and virtual machines isolate work — Interactive Guides');
          assert.equal(await page.$('.guide-dock'), null);
          for (const kind of ['native', 'container', 'vm']) {
            await frameClick(page, `[data-environment="${kind}"]`);
            assert.equal(await page.$$eval('[data-stack]:not([hidden])', nodes => nodes.length), 1);
            assert(await page.$eval('#vm-player-previous', node => node.disabled));
            assert.equal(await page.$$eval('[data-stack]:not([hidden]) .layer[aria-current="step"]', nodes => nodes.length), 1);
            assert(await page.$$eval('.layer-icon use', nodes => nodes.every(node => document.getElementById(node.getAttribute('href').slice(1)))), 'every layer has a locally defined icon');
            assert.equal(await page.$eval('[data-stack]:not([hidden]) .process-view', node => node.dataset.view), kind);
            if (kind !== 'vm') {
              assert.equal(await page.$eval('[data-stack]:not([hidden]) .this-app td', node => node.textContent), kind === 'native' ? '2417' : '1');
              assert.equal(await page.$$eval('[data-stack]:not([hidden]) .process-table tbody tr', nodes => nodes.length), kind === 'native' ? 3 : 1);
              assert.equal(await page.$$eval('[data-stack]:not([hidden]) .process-shell', nodes => nodes.length), kind === 'native' ? 0 : 1, 'container adds OS-view isolation around an ordinary process address space');
            } else {
              assert.equal(await page.$eval('[data-view="vm"] .this-app td', node => node.textContent), '42');
              assert.equal(await page.$$eval('[data-view="vm"] .process-table tbody tr', nodes => nodes.length), 2);
              assert.deepEqual(await page.$$eval('.guest-hardware dd', nodes => nodes.map(node => node.textContent)), ['2', '2 GiB', '20 GiB']);
              assert((await page.$eval('[data-view="vm"] .view-properties', node => node.textContent)).includes('Own guest kernel'));
              assert((await page.$eval('[data-stack="vm"] .namespace-note', node => node.textContent)).includes('not a renamed host PID'));
              assert.equal(await page.$$eval('[data-stack="vm"] .layer', nodes => nodes.length), 6, 'guest view adds context, not extra request events');
            }
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${file} ${width} ${kind} overflows`);
          }
        } else {
          assert(await page.$('.guide-enhanced'), file);
          const ids = await page.$$eval('.guide-panel', nodes => nodes.map(node => node.id));
          assert.equal(ids.length, file.includes('databases') ? 5 : 7);
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
        const dock = file === 'how-live-messages-work.html' ? '.mode-nav' : file === 'how-virtual-machines-work.html' ? '.environment-dock' : ['how-the-web-works.html', 'how-data-travels.html', 'how-operating-systems-work.html'].includes(file) ? '.journey-nav' : '.guide-dock';
        assert.equal(await page.$eval(dock, node => getComputedStyle(node).position), 'sticky');
        assert(await page.$eval(dock, node => node.getBoundingClientRect().top >= -1));
      }
      console.log(`PASS all topics: ${protocol}, ${theme}, ${width}px`);
    }

    // One editor story; changing conditions never creates a second simulation.
    await page.setViewport({ width: 1280, height: 950 });
    await page.goto(base + 'how-operating-systems-work.html', { waitUntil: 'networkidle0' });
    const osStage = step => frameClick(page, `[data-step="${step}"]`);
    const osActive = () => page.$eval('[data-journey-step]:not([hidden])', node => node.id);
    const osEvent = () => page.$eval('#journey', node => node.dataset.event);
    const osNextEvent = () => page.$eval('#stage-event-next', node => node.click());
    const osFinish = async () => { for (let i = 0; i < 20 && !(await page.$eval('#stage-event-next', node => node.disabled)); i++) await osNextEvent(); };
    assert.equal(await osActive(), 'launch'); assert.equal(await osEvent(), 'launch'); assert.equal(await text('storage-reads'), '0');
    assert((await text('event-position')).includes('event 1 / 5'));
    assert(await page.$eval('.editor', node => node.hidden), 'no editor window before it launches');
    for (let i = 0; i < 3; i++) { await osNextEvent(); assert(await page.$eval('.editor', node => node.hidden)); }
    await osNextEvent(); assert.equal(await osEvent(), 'running'); assert(!(await page.$eval('.editor', node => node.hidden)));
    assert.equal(await page.$('#journey-scenario'), null); assert.equal(await page.$('#journey-player-seek'), null);
    await osStage(1); assert.equal(await osEvent(), 'open-request'); assert((await text('event-position')).includes('event 1 /'));
    assert((await text('file-identity')).includes('not returned yet')); assert(await page.$eval('#editor-tabs', node => node.hidden));
    assert(await page.$eval('.copy-board', node => node.hidden), 'Open does not expose stored file contents');
    await osFinish(); assert((await text('file-identity')).includes('3 → inode 42'));
    assert(!(await page.$eval('#editor-tabs', node => node.hidden))); assert.equal(await text('editor-filename'), 'todo.txt');
    assert(await page.$eval('#editor-document', node => node.hidden), 'opening adds a file tab, not the file bytes');
    await click('allow-file'); assert.equal(await osEvent(), 'denied'); assert.equal(await text('storage-reads'), '1');
    assert((await text('editor-wait')).includes('Access denied')); assert(await page.$eval('#next', node => node.disabled));
    await page.$eval('[data-step="4"]', node => node.click()); assert.equal(await osActive(), 'open');
    await click('allow-file'); await click('rename-file'); assert((await text('editor-path')).includes('shopping.txt'));
    assert.equal(await text('editor-filename'), 'shopping.txt');
    assert((await text('file-identity')).includes('3 → inode 42'));
    await osStage(2); assert.equal(await osEvent(), 'cache-check'); assert((await text('event-position')).includes('event 1 /'));
    assert(await page.$eval('#editor-text', node => node.hidden)); await osFinish(); assert.equal(await page.$eval('#editor-text', node => node.value), osModel.OLD_TEXT);
    assert(!(await page.$eval('#editor-document', node => node.hidden))); assert.equal(await text('editor-file-state'), 'Original');
    assert(await page.$$eval('[data-copy-filename]', nodes => nodes.every(node => node.textContent === 'shopping.txt')));
    assert.equal(await text('storage-reads'), '2'); await click('slow-storage'); assert.equal(await osEvent(), 'document-read');
    assert.equal(await text('process-state'), 'Blocked'); assert(!(await page.$eval('#cpu-handoff', node => node.hidden)));
    await osNextEvent(); assert.equal(await osEvent(), 'storage-wait-1'); await osNextEvent(); assert.equal(await osEvent(), 'storage-wait-2');
    assert.equal(await text('storage-reads'), '2', 'slow storage waits on the same outstanding read');
    await osNextEvent(); assert.equal(await text('process-state'), 'Ready'); assert(await page.$eval('#editor-text', node => node.hidden));
    await osNextEvent(); assert.equal(await text('process-state'), 'Running');
    await click('document-cached'); assert.equal(await osEvent(), 'read-complete'); assert.equal(await text('storage-reads'), '1');
    assert(await page.$eval('#slow-storage', node => node.disabled)); assert(!(await page.$eval('#slow-storage', node => node.checked)));
    await osStage(3); assert.equal(await osEvent(), 'editing-start'); assert((await text('event-position')).includes('event 1 /'));
    assert.equal(await page.$eval('#editor-text', node => node.value), osModel.OLD_TEXT);
    await osFinish(); assert.equal(await page.$eval('#editor-text', node => node.value), osModel.NEW_TEXT);
    assert.equal(await text('editor-file-state'), 'Unsaved'); assert(!(await page.$eval('#editor-pending', node => node.hidden)));
    assert.equal(await text('copy-os-value'), osModel.OLD_TEXT); assert.equal(await text('copy-disk-value'), osModel.OLD_TEXT);
    await click('memory-pressure'); assert.equal(await osEvent(), 'code-evict'); await osNextEvent(); assert.equal(await osEvent(), 'code-reload');
    assert.equal(await text('storage-reads'), '2'); assert.equal(await text('process-state'), 'Blocked'); await osFinish();
    await osStage(4); assert.equal(await osEvent(), 'save-ready'); assert((await text('event-position')).includes('event 1 /')); assert.equal(await text('edit-durable'), 'Not yet');
    assert((await text('editor-path')).includes('shopping.txt'), 'rename preserves descriptor-based read/save identity');
    const saveFrames = osJourneyModel.buildJourney({ cached: true, pressure: true, renamed: true }).frames.filter(frame => frame.stage === 4);
    for (const expected of saveFrames) {
      assert.equal(await osEvent(), expected.id);
      assert.equal(await text('editor-file-state'), expected.durable ? 'Durable' : expected.written ? 'Sync pending' : 'Unsaved');
      assert.equal(await page.$eval('#editor-pending', node => node.hidden), expected.durable);
      assert.equal(await text('copy-os-value'), expected.cache); assert.equal(await text('copy-device-value'), expected.device); assert.equal(await text('copy-disk-value'), expected.disk);
      for (const [id, failure] of [['save-app-crash', 'app'], ['save-power-loss', 'power']]) {
        await click(id); const crash = osJourneyModel.crashJourney(expected, failure);
        assert((await text('save-result')).includes('After restart the file reads “' + crash.visible + '”'));
        assert.equal(await text('copy-disk-value'), expected.disk, 'what-if failures do not mutate the selected snapshot');
      }
      if (expected.id !== 'synced') { await osNextEvent(); assert(await page.$eval('#save-result', node => node.hidden)); }
    }
    assert.equal(await text('edit-durable'), 'Yes · synced'); assert.equal(await text('next'), 'Journey complete');
    await click('stage-event-previous'); assert.equal(await osEvent(), 'sync-request');
    assert.equal(await text('edit-durable'), 'Not yet'); assert.equal(await text('copy-disk-value'), osModel.OLD_TEXT);
    assert(await page.$eval('#save-result', node => node.hidden), 'rewinding clears the previous what-if result');
    await click('stage-event-previous'); assert.equal(await osEvent(), 'device-accepted');
    await osFinish(); assert.equal(await osEvent(), 'synced');
    await osStage(1); assert((await text('file-identity')).includes('shopping.txt'));
    for (const cached of [false, true]) for (const slow of [false, true]) for (const pressure of [false, true]) {
      await click('replay'); await osStage(2);
      if (cached) await click('document-cached'); else if (slow) await click('slow-storage');
      await osStage(3); if (pressure) await click('memory-pressure'); await osFinish(); await osStage(4); await osFinish();
      assert.equal(await text('storage-reads'), String((cached ? 1 : 2) + Number(pressure)));
      assert.equal(await page.$eval('#editor-text', node => node.value), osModel.NEW_TEXT);
      assert.equal(await text('copy-disk-value'), osModel.NEW_TEXT); assert.equal(await text('edit-durable'), 'Yes · synced');
    }
    await click('replay'); await osStage(3); await click('stage-play'); assert.equal(await page.$eval('#editor-text', node => node.value), osModel.OLD_TEXT, 'replaying edit begins with the original buffer');
    await click('stage-play'); await osNextEvent(); assert.equal(await page.$eval('#editor-text', node => node.value), osModel.NEW_TEXT);
    await osStage(2); await click('stage-play'); assert.equal(await page.evaluate(() => window.__guideTimers.size), 1);
    await osStage(0); assert.equal(await page.evaluate(() => window.__guideTimers.size), 0);
    await page.$eval('#processes', node => { node.open = true; }); await choice('cpu-cores', '2');
    for (let i = 0; i < 20; i++) await page.$eval('#cpu-next', node => node.click());
    assert((await text('cpu-description')).includes('All tasks finished')); assert.equal(await text('storage-reads'), '0');
    await osStage(3); await page.$eval('#memory', node => { node.open = true; });
    await choice('memory-process', 'player'); await input('memory-address', 31); await choice('memory-access', 'write');
    assert((await text('memory-description')).includes('not permitted') || (await text('memory-description')).includes('Access denied'));
    await page.focus('[data-choice-for="memory-process"] [aria-checked="true"]'); await page.keyboard.press('ArrowLeft'); assert.equal(await checked('memory-process'), 'editor');
    await page.$eval('#pressure', node => { node.open = true; });
    for (const capacity of [2, 3, 4, 5]) {
      await choice('pressure-capacity', String(capacity)); for (let i = 0; i < 8; i++) await page.$eval('#pressure-next', node => node.click());
      assert((await text('pressure-stats')).startsWith(osModel.memoryRun(capacity).frames.at(-1).reads + ' storage reads'));
      assert.equal(await text('storage-reads'), '2', 'advanced examples do not change the editor story');
    }
    await osStage(0); await osStage(1); await page.goBack(); assert.equal(await osActive(), 'launch'); await page.goForward(); assert.equal(await osActive(), 'open');
    await page.focus('[data-step="1"]'); await page.keyboard.press('ArrowRight'); assert.equal(await osActive(), 'read');
    await page.keyboard.press('End'); assert.equal(await osActive(), 'save'); await page.keyboard.press('Home'); assert.equal(await osActive(), 'launch');
    for (const [hash, expected] of [['#memory-title', 'edit'], ['#files-title', 'open'], ['#drivers', 'read'], ['#kernel', 'launch'], ['#pressure', 'edit'], ['#journey', 'launch'], ['#%', 'launch']]) {
      await page.goto(base + 'how-operating-systems-work.html' + hash, { waitUntil: 'networkidle0' }); assert.equal(await osActive(), expected);
      if (['#drivers', '#kernel', '#pressure'].includes(hash)) assert(await page.$eval(hash, node => node.open));
    }
    for (const width of [320, 390]) {
      await page.setViewport({ width, height: 568 }); await page.goto(base + 'how-operating-systems-work.html#edit', { waitUntil: 'networkidle0' });
      await page.$eval('#next', node => node.scrollIntoView({ block: 'end', behavior: 'instant' })); await click('next');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'save-title');
      assert(await page.$eval('#save-title', node => { const r = node.getBoundingClientRect(); return r.top >= document.querySelector('.os-dashboard').getBoundingClientRect().bottom && r.bottom <= innerHeight; }));
    }
    await page.setViewport({ width: 1280, height: 950 }); await osStage(4); await page.evaluate(() => { window.__fastGuidePlayback = true; }); await click('stage-play');
    await page.waitForFunction(() => document.getElementById('edit-durable').textContent === 'Yes · synced'); assert.equal(await page.evaluate(() => window.__guideTimers.size), 0);
    await page.evaluate(() => { window.__fastGuidePlayback = false; }); await osStage(0); const beforePrintReads = await text('storage-reads');
    await page.evaluate(() => dispatchEvent(new Event('beforeprint'))); await page.emulateMediaType('print');
    assert(await page.$$eval('[data-journey-step]', nodes => nodes.every(node => getComputedStyle(node).display !== 'none')));
    assert.equal(await text('copy-disk-value'), osModel.NEW_TEXT); assert.equal(await text('edit-durable'), 'Yes · synced');
    await page.emulateMediaType('screen'); await page.evaluate(() => dispatchEvent(new Event('afterprint')));
    assert.equal(await text('storage-reads'), beforePrintReads); assert.equal(await osActive(), 'launch'); assert(await page.$eval('#copy-disk', node => node.hidden));
    console.log('PASS OS five-stage editor, permissions, descriptor identity, cache/slow/pressure combinations, save/crash matrix, close-ups, playback, history, mobile focus, and print');

    await page.goto(base + 'how-operating-systems-work.html#machines', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => location.pathname.endsWith('how-virtual-machines-work.html'));
    for (const kind of ['native', 'container', 'vm']) {
      await frameClick(page, `[data-environment="${kind}"]`);
      assert.equal(await page.$eval('[data-stack]:not([hidden])', node => node.dataset.stack), kind);
      await click('vm-kernel-crash'); assert((await text('vm-result')).includes(kind === 'vm' ? 'guest-kernel' : 'hosting-kernel'));
      await click('vm-app-crash'); assert((await text('vm-result')).includes('application crash'));
      if (kind === 'container') assert((await text('vm-result')).includes('PID 1'), 'the private PID namespace example has the right init-exit scope');
      await click('vm-player-next'); assert(await page.$eval('#vm-result', node => node.hidden));
      await click('vm-app-crash'); await click('vm-player-previous'); assert(await page.$eval('#vm-result', node => node.hidden), 'rewinding clears stale failure inspection');
      const count = kind === 'vm' ? 6 : 4;
      for (let index = 0; index < count; index++) {
        if (index) await click('vm-player-next');
        assert.equal(await text('vm-player-count'), 'Event ' + (index + 1) + ' of ' + count);
        assert.equal(await page.$eval('#vm-player-progress', node => node.max), count);
        assert.equal(await page.$eval('#vm-player-progress', node => node.value), index + 1);
        assert.equal(await page.$eval('.layer[aria-current="step"] strong', node => node.textContent), await text('vm-heading'));
        assert.equal(await page.$$eval('[data-phase="visited"]', nodes => nodes.length), index);
        assert.equal(await page.$eval('#vm-event-icon', node => node.getAttribute('href')), await page.$eval('.layer[aria-current="step"] .layer-icon use', node => node.getAttribute('href')));
        assert.equal(await text('vm-domain-label'), await page.$eval('.layer[aria-current="step"]', node => node.closest('.stack-scope').querySelector('.scope-label').textContent));
      }
      assert(await page.$eval('#vm-player-next', node => node.disabled)); assert.equal(await text('vm-player-play'), 'Replay');
      for (let index = count - 2; index >= 0; index--) { await click('vm-player-previous'); assert.equal(await text('vm-player-count'), 'Event ' + (index + 1) + ' of ' + count); }
      assert(await page.$eval('#vm-player-previous', node => node.disabled));
      await click('vm-player-next');
      assert(await page.evaluate(() => { document.getElementById('vm-player-play').click(); const running = window.__guideTimers.size; document.getElementById('vm-player-previous').click(); return running === 1 && window.__guideTimers.size === 0; }), 'previous event pauses active playback');
      assert.equal(await page.$eval('#vm-route', node => node.dataset.event), '1');
    }
    await page.evaluate(() => { window.__fastGuidePlayback = true; }); await click('vm-player-play');
    await page.waitForFunction(() => document.getElementById('vm-player-next').disabled);
    assert.equal(await page.evaluate(() => window.__guideTimers.size), 0);
    await click('vm-player-play'); await frameClick(page, '[data-environment="container"]'); assert.equal(await page.evaluate(() => window.__guideTimers.size), 0);
    await page.focus('[data-environment="container"]'); await page.keyboard.press('End'); assert.equal(await page.$eval('[data-stack]:not([hidden])', node => node.dataset.stack), 'vm');
    await page.keyboard.press('Home'); assert.equal(await page.$eval('[data-stack]:not([hidden])', node => node.dataset.stack), 'native');
    await page.emulateMediaType('print'); assert(await page.$$eval('[data-stack]', nodes => nodes.every(node => getComputedStyle(node).display !== 'none')));
    assert(await page.$$eval('.layer small', nodes => nodes.every(node => getComputedStyle(node).display !== 'none')), 'print includes the explanations of inactive layers');
    assert.equal(await page.$$eval('.process-view', nodes => nodes.length), 3);
    assert(await page.$$eval('.process-view', nodes => nodes.every(node => node.getBoundingClientRect().height > 0)), 'print preserves the contrasting host/private/guest views');
    await page.emulateMediaType('screen');
    console.log('PASS separate VM guide, layer icons/boundaries, previous/next events, progress, keyboard controls, crash scopes, print, and playback cleanup');

    await page.goto(base + 'how-data-travels.html', { waitUntil: 'networkidle0' });
    const networkStage = step => frameClick(page, `[data-step="${step}"]`);
    const networkActive = () => page.$eval('[data-journey-step]:not([hidden])', node => node.id);
    assert.equal(await networkActive(), 'pieces');
    assert(await page.$eval('.transfer-dashboard', node => getComputedStyle(node).position === 'sticky'));
    assert(await page.$eval('.transfer-dashboard', node => node.getBoundingClientRect().bottom <= document.querySelector('.workspace').getBoundingClientRect().top), 'live counters sit above both columns');
    assert(await page.$eval('#transfer-controls', node => node.hidden));
    await choice('payload', '300'); assert((await text('overhead-label')).includes('320 B headers'));
    assert.equal(await page.$$eval('#sender .packet', nodes => nodes.length), 8);
    await networkStage(1); await choice('competing', '2'); assert((await text('queue-summary')).includes('14 B packets'));
    await page.$eval('#routes', node => { node.open = true; });
    const beforeRoute = await text('queue-summary'); await click('route-failure');
    assert.equal(await text('queue-summary'), beforeRoute); assert((await text('route-status')).includes('does not change'));
    assert(!(await page.$eval('#failed-link', node => node.hasAttribute('hidden'))));
    await networkStage(2); assert(!(await page.$eval('#transfer-controls', node => node.hidden)));
    assert(await page.$eval('#event-play', node => !node.closest('details')), 'playback is visible, not buried in the inspector');
    await input('capacity', 48); await input('propagation', 100);
    assert((await text('link-breakdown')).includes('56.7 ms')); assert((await text('small-delay')).includes('140 ms'));
    await networkStage(3); await click('loss');
    assert(await page.$$eval('#buffer .buffered', nodes => nodes.length > 0), 'TCP checkpoint exposes the gap, not just the final answer');
    assert.notEqual(await text('metric-received'), await text('metric-data'), 'received bytes are distinguished from app-ready bytes');
    assert((await text('event-description')).includes('earlier'));
    await networkStage(4); assert((await text('app-result')).includes('File complete'));
    assert((await text('outcome-settings')).includes('300-byte payloads')); assert((await text('outcome-settings')).includes('48 kbit/s'));
    await choice('app-kind', 'audio'); assert((await text('app-result')).includes('/ 8 chunks'));
    await networkStage(3); await choice('transport', 'udp'); await networkStage(4);
    assert((await text('metric-data')).includes('2,100')); assert((await text('app-result')).includes('missing'));
    await choice('app-kind', 'file'); assert((await text('app-result')).includes('File incomplete'));
    assert.equal(await checked('payload'), '300'); assert.equal(await checked('competing'), '2');

    // Every outcome comes from the current run, including custom packet sizes.
    for (const payload of [300, 600, 1200]) for (const transport of ['tcp', 'udp']) for (const [loss, reorder] of [[false, false], [true, false], [false, true], [true, true]]) {
      const config = { payload, transport, loss, reorder, kbps: 72, propagation: 140, competing: 1 };
      const expected = networkModel.buildRun(config), final = expected.snapshots.at(-1);
      await page.evaluate(config => {
        const ids = { payload: 'payload', transport: 'transport', kbps: 'capacity', propagation: 'propagation', competing: 'competing' };
        for (const [key, id] of Object.entries(ids)) document.getElementById(id).value = String(config[key]);
        document.getElementById('loss').checked = config.loss; document.getElementById('reorder').checked = config.reorder;
        document.getElementById('loss').dispatchEvent(new Event('change', { bubbles: true }));
      }, config);
      assert.equal(await networkActive(), 'applications');
      assert.equal(await text('outcome-transport'), transport === 'tcp' ? 'TCP-style ordered stream' : 'Bare UDP-style datagrams');
      assert.equal(await text('outcome-loss'), loss ? 'On · lose A2 once' : 'Off');
      assert.equal(await text('outcome-reorder'), reorder ? 'On · delay A1' : 'Off');
      assert.equal(await text('metric-data'), (final.delivered.length * payload).toLocaleString('en-US') + ' / 2,400 B');
      assert.equal(await text('arrival-order'), final.received.map(n => 'A' + n).join(' → '));
      assert((await text('app-result')).includes(expected.complete ? 'File complete' : 'File incomplete'));
      await choice('app-kind', 'audio'); assert((await text('app-result')).includes(`${expected.onTime} / ${expected.count} chunks`));
      assert.equal(await page.$$eval('.media-slot small', nodes => nodes.filter(node => node.textContent.includes('Due ')).length), expected.count, 'deadline evidence is visible text, not mouse-only tooltips');
      await choice('app-kind', 'file');
    }
    await networkStage(3); await page.$eval('#event-inspector', node => { node.open = true; });
    await click('event-reset'); await click('event-play'); assert.equal(await page.evaluate(() => window.__guideTimers.size), 1);
    await networkStage(2); assert.equal(await page.evaluate(() => window.__guideTimers.size), 0, 'navigation stops optional playback');
    await networkStage(3); await click('event-reset'); await click('event-next'); const checkpoint = await text('event-number');
    await networkStage(4); await networkStage(3); assert.equal(await text('event-number'), checkpoint, 'inspected event is preserved per stage');
    await click('event-finish'); assert(await page.$eval('#event-next', node => node.disabled));
    await click('event-reset'); await click('event-play'); await page.$eval('#event-inspector', node => { node.open = false; });
    assert.equal(await page.evaluate(() => window.__guideTimers.size), 1, 'closing optional details does not stop visible playback');
    await click('event-play'); assert.equal(await page.evaluate(() => window.__guideTimers.size), 0);
    await click('replay'); await networkStage(4); assert.equal(await text('event-play'), 'Replay transfer');
    await click('event-play'); assert((await text('app-result')).includes('Receiving file'));
    assert.equal(await text('metric-data'), '0 / 2,400 B'); assert.equal(await page.$eval('#transfer-progress', node => node.value), 0);
    await click('event-play'); assert.equal(await page.evaluate(() => window.__guideTimers.size), 0);
    for (let i = 0; i < 4; i++) await click('event-next');
    assert((await text('app-result')).includes('Receiving file'));
    await choice('app-kind', 'audio'); assert((await text('app-result')).includes('so far'));
    assert(await page.$$eval('.media-slot.pending', nodes => nodes.length > 0));
    const pausedTime = await text('metric-time');
    await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
    assert.equal(await text('metric-data'), '2,400 / 2,400 B');
    await page.evaluate(() => dispatchEvent(new Event('afterprint'))); assert.equal(await text('metric-time'), pausedTime);
    await page.$eval('#event-inspector', node => { node.open = true; }); await click('event-finish');
    assert((await text('app-result')).includes('chunks on time')); assert(!(await text('app-result')).includes('so far'));
    assert.equal(await page.$eval('#transfer-progress', node => node.value), 2400);
    await page.evaluate(() => { window.__fastGuidePlayback = true; }); await click('event-play');
    await page.waitForFunction(() => document.getElementById('event-play').getAttribute('aria-pressed') === 'false');
    assert.equal(await page.evaluate(() => window.__guideTimers.size), 0, 'playback stops automatically at the final snapshot');
    assert.equal(await text('metric-data'), '2,400 / 2,400 B');
    await page.evaluate(() => { window.__fastGuidePlayback = false; });
    await click('event-play'); assert.equal(await page.evaluate(() => window.__guideTimers.size), 1);
    await networkStage(2); assert.equal(await page.evaluate(() => window.__guideTimers.size), 0);
    await click('replay'); assert.equal(await networkActive(), 'pieces'); assert.equal(await checked('payload'), '600'); assert.equal(await checked('transport'), 'tcp');
    assert(!(await page.$eval('#loss', node => node.checked))); assert(!(await page.$eval('#route-failure', node => node.checked)));
    await page.focus('[data-step="0"]'); await page.keyboard.press('ArrowRight'); assert.equal(await networkActive(), 'sharing');
    await page.keyboard.press('End'); assert.equal(await networkActive(), 'applications'); await page.keyboard.press('Home'); assert.equal(await networkActive(), 'pieces');
    await page.goBack(); assert.equal(await networkActive(), 'applications'); await page.goForward(); assert.equal(await networkActive(), 'pieces');
    for (const [hash, expected] of [['#delivery-title', 'delivery'], ['#routes', 'sharing'], ['#delay', 'link'], ['#experiment', 'link'], ['#%', 'pieces']]) {
      await page.goto(base + 'how-data-travels.html' + hash, { waitUntil: 'networkidle0' }); assert.equal(await networkActive(), expected);
      if (['#routes', '#delay'].includes(hash)) assert(await page.$eval(hash, node => node.open));
    }
    for (const width of [320, 390]) {
      await page.setViewport({ width, height: 568 }); await page.goto(base + 'how-data-travels.html#delivery', { waitUntil: 'networkidle0' });
      await page.$eval('#next', node => node.scrollIntoView({ block: 'end', behavior: 'instant' })); await click('next');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'applications-title');
      assert(await page.$eval('#applications-title', node => { const r = node.getBoundingClientRect(); return r.top >= document.querySelector('.transfer-dashboard').getBoundingClientRect().bottom && r.bottom <= innerHeight; }));
    }
    await page.setViewport({ width: 1280, height: 950 });
    await networkStage(0); assert.equal(await text('metric-time'), '0 ms');
    await page.evaluate(() => dispatchEvent(new Event('beforeprint'))); await page.emulateMediaType('print');
    assert(await page.$$eval('[data-journey-step]', nodes => nodes.every(node => getComputedStyle(node).display !== 'none')));
    assert.equal(await text('metric-data'), '2,400 / 2,400 B', 'printed scene uses the same final snapshot as its application outcome');
    assert(!(await page.$eval('#lane-receiver', node => node.hidden)), 'receiver remains part of the printed final snapshot');
    await page.emulateMediaType('screen'); await page.evaluate(() => dispatchEvent(new Event('afterprint')));
    assert.equal(await text('metric-time'), '0 ms'); assert.equal(await networkActive(), 'pieces');
    assert(await page.$eval('#lane-receiver', node => node.hidden), 'printing restores the stage-specific receiver visibility');
    console.log('PASS network five-stage journey, 24 shared-run outcome cases, contextual settings, topology scope, event playback, history, mobile focus, and print');

    await page.goto(base + 'how-data-travels.html#realtime', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => location.pathname.endsWith('how-live-messages-work.html'));
    assert.equal(await page.$('.guide-dock'), null);
    assert.equal(await page.$('#rt-timeline'), null);
    assert.equal(await page.$$eval('.rt-controls button', nodes => nodes.length), 4);
    assert(await page.$eval('#rt-back', node => node.disabled), 'no previous event before the conversation starts');
    for (const mode of ['poll', 'sse', 'ws']) {
      await frameClick(page, `[data-mode="${mode}"]`); await click('rt-reset');
      for (const second of [0, 1, 2, 5, 6, 7, 10]) {
        if (second > 0) await click('rt-tick');
        const expected = networkModel.createRealtime(mode);
        for (let s = 1; s <= second; s++) {
          expected.dispatch('tick');
          if ([1, 6].includes(s)) expected.dispatch('update', s === 1 ? 'Your order is ready.' : 'Receipt added.');
          if ([2, 7].includes(s)) expected.dispatch('send', s === 2 ? 'Please add a receipt.' : 'I’ll collect it soon.');
        }
        assert.equal(await text('rt-clock'), second + ' s'); assert.equal(await text('rt-requests'), String(expected.state.requests));
        assert.equal(await page.$eval('#rt-story-progress', node => node.value), second);
        assert((await text('rt-browser')).startsWith(expected.state.delivered.length + ' server update(s)'));
        assert.equal(await text('rt-browser-count'), String(Math.min(expected.state.delivered.length + expected.state.sent.length, 4)));
        assert.equal(await text('rt-server-count'), String(Math.min(expected.state.sent.length, 4)));
        assert.equal(await text('rt-pending-count'), String(expected.state.pending.length));
        assert.equal(await page.$$eval('#rt-browser-inbox .message-outgoing', nodes => nodes.length), expected.state.sent.length, 'browser thread shows your sent replies as well as received updates');
        if (mode === 'poll' && second === 2) {
          assert.equal(await page.$$eval('#rt-browser-inbox .message-incoming', nodes => nodes.length), 0, 'queued shop updates are not falsely shown as delivered');
          assert.equal(await page.$eval('#rt-channel-badge', node => node.dataset.state), 'queued');
        }
      }
      for (const second of [7, 6, 5, 2, 1, 0]) { await click('rt-back'); assert.equal(await text('rt-clock'), second + ' s'); }
      assert(await page.$eval('#rt-back', node => node.disabled));
      await click('rt-play'); await page.waitForFunction(() => document.getElementById('rt-clock').textContent !== '0 s'); await click('rt-back');
      assert.equal(await page.evaluate(() => window.__guideTimers.size), 0, 'previous event pauses playback');
      for (let i = 0; i < 6; i++) await click('rt-tick');
    }
    assert(await page.$eval('#rt-tick', node => node.disabled)); assert.equal(await text('rt-play'), 'Replay');
    await click('rt-reset'); await click('rt-tick');
    await page.focus('[data-mode="poll"]'); await page.keyboard.press('ArrowRight');
    assert.equal(await page.$eval('[data-mode="sse"]', node => node.getAttribute('aria-pressed')), 'true');
    assert.equal(await text('rt-clock'), '1 s', 'keyboard mode switching preserves the moment');
    await page.keyboard.press('End'); assert.equal(await page.$eval('[data-mode="ws"]', node => node.getAttribute('aria-pressed')), 'true');
    await page.keyboard.press('Home'); assert.equal(await page.$eval('[data-mode="poll"]', node => node.getAttribute('aria-pressed')), 'true');
    assert((await text('rt-pending')).includes('1 update(s) waiting'));
    await frameClick(page, '[data-mode="sse"]');
    assert((await text('rt-browser-inbox')).includes('Your order is ready.'));
    await page.$eval('#rt-custom', node => { node.open = true; });
    await page.$eval('#rt-server-text', node => { node.value = '<custom update>'; }); await click('rt-update');
    assert((await text('rt-browser-inbox')).includes('<custom update>')); assert.equal(await page.$('#rt-browser-inbox custom'), null, 'custom messages are text, not HTML');
    await click('rt-play'); assert.equal(await page.evaluate(() => window.__guideTimers.size), 1);
    await frameClick(page, '[data-mode="poll"]'); assert.equal(await page.evaluate(() => window.__guideTimers.size), 0);
    await click('rt-tick'); assert.equal(await text('rt-clock'), '2 s');
    await click('rt-tick'); assert.equal(await text('rt-clock'), '5 s'); assert((await text('rt-browser-inbox')).includes('<custom update>'), 'custom updates survive event skipping and mode changes');
    assert.equal(await page.$eval('#rt-browser-inbox .message', node => node.querySelector('.message-head span').textContent), 'You', 'the reply sent at 2 s precedes updates delivered at 5 s');
    await click('rt-back'); assert.equal(await text('rt-clock'), '2 s'); await click('rt-back'); assert.equal(await text('rt-clock'), '1 s');
    assert((await text('rt-queue-messages')).includes('<custom update>'), 'custom action is a rewindable event at the same timestamp');
    assert.equal(await page.$$eval('#rt-queue-messages li', nodes => nodes.length), 2);
    await click('rt-back'); assert.equal(await text('rt-clock'), '1 s'); assert(!(await text('rt-queue-messages')).includes('<custom update>'));
    await click('rt-reset'); assert.equal(await text('rt-clock'), '0 s');
    await page.evaluate(() => { window.__fastGuidePlayback = true; }); await click('rt-play');
    await page.waitForFunction(() => document.getElementById('rt-clock').textContent === '10 s');
    assert.equal(await page.evaluate(() => window.__guideTimers.size), 0); assert.equal(await text('rt-play'), 'Replay');
    await page.evaluate(() => { window.__fastGuidePlayback = false; });
    await click('rt-play'); await page.evaluate(() => dispatchEvent(new Event('beforeprint'))); await page.emulateMediaType('print');
    assert.equal(await page.evaluate(() => window.__guideTimers.size), 0);
    assert.equal(await page.$eval('.mode-nav', node => getComputedStyle(node).display), 'none');
    await page.emulateMediaType('screen'); await page.evaluate(() => dispatchEvent(new Event('afterprint')));
    await click('rt-play'); await page.goto(base + 'how-data-travels.html', { waitUntil: 'networkidle0' }); assert.equal(await page.evaluate(() => window.__guideTimers.size), 0);
    console.log('PASS messaging top selector, event-based playback/progress, same-time comparison, custom text, keyboard controls, print, and cleanup');

    await page.goto(base + 'how-the-web-works.html', { waitUntil: 'networkidle0' });
    const webStep = step => frameClick(page, `[data-step="${step}"]`);
    const webActive = () => page.$eval('[data-journey-step]:not([hidden])', node => node.id);
    assert.equal(await webActive(), 'address');
    assert(await page.$('.browser-tab')); assert(await page.$('.browser-toolbar .address-bar'));
    assert.equal(await page.$eval('#browser-connection', node => node.dataset.state), 'pending');
    assert.equal(await page.$eval('#browser-connection-icon', node => node.getAttribute('href')), '#web-icon-globe', 'HTTPS scheme alone does not mean TLS is established');
    await webStep(2); assert.equal(await page.$eval('#browser-connection', node => node.dataset.state), 'secure');
    await frameClick(page, '[data-url-part="host"]'); assert.equal(await webActive(), 'address'); assert((await text('url-description')).includes('Hostname'));
    assert.equal(await page.$('#scenario'), null, 'no upfront experiment matrix');
    for (let i = 0; i < 5; i++) await click('next');
    assert.equal(await webActive(), 'rendering');
    assert.equal(await text('browser-tab-title'), 'Your small garden'); assert.equal(await page.$eval('#browser-progress', node => node.value), 6);
    assert.equal(await page.$eval('.browser', node => node.dataset.state), 'ready'); await click('journey-water'); assert((await text('journey-water')).includes('Watered'));
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
    assert.equal(await text('browser-tab-title'), 'Plant not found'); assert.equal(await page.$eval('.browser', node => node.dataset.state), 'http-error');
    assert.equal(await page.$eval('#browser-connection', node => node.dataset.state), 'secure', 'an HTTP error response can still use a valid encrypted connection');
    const webCheck = (id, value) => page.$eval('#' + id, (node, value) => { if (node.checked !== value) node.click(); }, value);
    for (const [path, code] of [['/missing', '404'], ['/broken', '500']]) {
      await webStep(3); await choice('path', path);
      assert((await text('http-wire')).includes('<link rel="stylesheet"')); assert((await text('http-wire')).includes('Response: ' + code));
      await webStep(4); assert(await page.$$eval('#resource-controls input', nodes => nodes.every(node => !node.disabled)), 'resource experiments remain available on HTTP error documents');
      await webCheck('load-css', true); await webCheck('load-js', true); await webCheck('missing-image', false); await webCheck('resources-cached', false);
      assert(await page.$('.garden.styled')); assert((await text('resources-wire')).includes('GET → 200 OK'));
      await webCheck('load-css', false); assert.equal(await page.$('.garden.styled'), null); await webCheck('load-css', true);
      await webCheck('resources-cached', true); assert.equal((await text('resources-wire')).match(/no request/g).length, 3);
      await webCheck('missing-image', true); assert(await page.$('#browser-preview .image-failed'));
      assert((await text('browser-state')).startsWith(code)); assert.equal(await text('url-path-part'), path);
      await webCheck('missing-image', false); await webCheck('load-js', false); await webStep(5);
      assert(await page.$eval('#journey-help', node => node.disabled));
      await webStep(4); await webCheck('load-js', true); await webStep(5); await click('journey-help');
      assert.equal(await page.$eval('#journey-help', node => node.getAttribute('aria-expanded')), 'true');
      assert(!(await page.$eval('#journey-help-text', node => node.hidden)));
      await click('journey-help'); assert(await page.$eval('#journey-help-text', node => node.hidden));
      assert((await text('http-wire')).includes('Response: ' + code)); assert.equal(await text('url-path-part'), path);
      assert.equal(await page.$eval('.browser', node => node.dataset.state), 'http-error', 'assets do not turn the original error response into success');
    }
    await webStep(3); await choice('path', '/broken'); assert((await text('browser-preview')).includes('500'));
    await choice('path', '/plants'); await click('slow-server'); assert((await text('server-timing')).includes('1,800'));
    await click('replay'); assert.equal(await webActive(), 'address'); assert(!(await page.$eval('#signed-in', node => node.checked))); assert(!(await page.$eval('#resources-cached', node => node.checked)));
    await webStep(1); await click('dns-cached'); assert((await text('dns-wire')).includes('local DNS cache'));
    await click('dns-failure'); assert((await text('browser-preview')).includes('Address not found'));
    assert.equal(await page.$eval('#browser-connection', node => node.dataset.state), 'blocked');
    assert.equal(await page.$eval('#browser-connection-icon', node => node.getAttribute('href')), '#web-icon-warning');
    assert(await page.$eval('#next', node => node.disabled));
    assert.equal(await page.$eval('[data-step="2"]', node => node.getAttribute('aria-disabled')), 'true');
    await page.$eval('[data-step="5"]', node => node.click()); assert.equal(await webActive(), 'dns');
    await click('dns-failure'); await click('next'); await click('invalid-cert');
    assert((await text('connection-wire')).includes('not sent')); assert((await text('browser-preview')).includes('Connection stopped'));
    assert.equal(await text('browser-tab-title'), 'Connection stopped'); assert.equal(await page.$eval('#browser-connection', node => node.dataset.state), 'blocked');
    assert((await text('browser-connection-label')).includes('HTTP not sent'));
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

    await page.goto(base + 'how-databases-store-and-retrieve-data.html', { waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('h1', node => node.textContent), 'How databases store and retrieve data');
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
      await page.setViewport({ width, height: 950 }); await page.goto(base + 'from-tokens-to-agents.html', { waitUntil: 'networkidle0' });
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
    assert(await page.$$eval('[data-journey-step]', nodes => nodes.every(node => getComputedStyle(node).display !== 'none')));
    assert.equal(await page.$$eval('details:not([open])', nodes => nodes.length), 0);
    await page.emulateMediaType('screen'); await page.evaluate(() => dispatchEvent(new Event('afterprint')));
    assert.equal(await page.$$eval('details:not([open])', nodes => nodes.length), closedBefore);
    await page.setJavaScriptEnabled(false);
    for (const file of guides) {
      await page.goto(base + file, { waitUntil: 'networkidle0' }); assert.equal(await page.$('.guide-dock'), null);
      assert(await page.$$eval('main > section, [data-journey-step]', nodes => nodes.every(node => !node.hidden)));
      if (['how-the-web-works.html', 'how-data-travels.html', 'how-operating-systems-work.html'].includes(file)) {
        assert.equal(await page.$$eval('[data-journey-step]', nodes => nodes.length), file === 'how-the-web-works.html' ? 6 : 5);
        assert(await page.$$eval('[data-journey-step]', nodes => nodes.every(node => node.innerText.length > 100)));
      }
    }
    await page.setJavaScriptEnabled(true); await page.setRequestInterception(true);
    let blockNetworkModel = false, blockOSJourneyModel = false, blockGuideControllers = true;
    page.on('request', request => {
      const url = request.url();
      if (url.endsWith('/guide-layout.js') || (blockGuideControllers && /\/(?:web-guide|network-guide|messaging-guide|os-guide|vm-guide)\.js$/.test(url)) || (blockNetworkModel && url.endsWith('/network-model.js')) || (blockOSJourneyModel && url.endsWith('/os-journey-model.js'))) request.abort();
      else request.continue();
    });
    blockGuideControllers = false;
    await page.goto(base + 'how-operating-systems-work.html', { waitUntil: 'networkidle0' });
    assert.equal(await page.$('.guide-dock'), null); assert(!(await page.$eval('#cpu-cores', node => node.hidden)));
    await page.$eval('#cpu-cores', node => { node.value = '2'; node.dispatchEvent(new Event('change')); });
    assert.equal(await page.$$eval('#cpu-lanes > div', nodes => nodes.length), 2, 'missing shared presentation leaves native OS controls functional');
    blockGuideControllers = true;
    for (const file of ['how-the-web-works.html', 'how-data-travels.html', 'how-live-messages-work.html', 'how-operating-systems-work.html', 'how-virtual-machines-work.html']) {
      await page.goto(base + file, { waitUntil: 'networkidle0' });
      assert(await page.$$eval('[data-journey-step], main > section', nodes => nodes.every(node => !node.hidden)), 'missing guide script leaves explanations readable');
    }
    blockNetworkModel = true; blockGuideControllers = false;
    for (const file of ['how-data-travels.html', 'how-live-messages-work.html']) {
      await page.goto(base + file, { waitUntil: 'networkidle0' });
      assert.equal(await page.$('.ready'), null);
      assert(!(await page.$eval('#model-error', node => node.hidden)), 'missing-model guard explains the fallback');
    }
    blockOSJourneyModel = true;
    await page.goto(base + 'how-operating-systems-work.html', { waitUntil: 'networkidle0' });
    assert.equal(await page.$('.ready'), null); assert(!(await page.$eval('#model-error', node => node.hidden)));
    assert(await page.$$eval('[data-journey-step]', nodes => nodes.every(node => !node.hidden)));
    assert.deepEqual(errors, []);
    console.log('PASS print restoration, no-JS article fallback, missing-model guards, native controls without shared presentation, and zero script errors');
  } finally { if (browser) await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
