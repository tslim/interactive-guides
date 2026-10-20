/* Optional standalone real-browser suite. No browser dependency for the guide.
 * PUPPETEER_MODULE selects Puppeteer; CHROME_PATH selects its browser binary. */
'use strict';
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const root = resolve(__dirname, '..');
const { buildComparison } = require(resolve(root, 'assets/compute-model.js'));
const file = 'how-cpus-and-gpus-work.html';
const targets = ['cpu', 'gpu'];
const stageIDs = ['prepare', 'place', 'submit', 'compute', 'finish'];
const profiles = [];
for (const batch of [1, 8]) for (const resident of [false, true]) for (const branching of [false, true])
  profiles.push({ batch, resident, branching });
const flat = comparison => comparison.stages.flatMap((stage, index) =>
  stage.frames.map((beat, position) => ({ ...beat, stage: index, position })));
const queueLabels = { idle: 'Not started', queued: 'Queued', running: 'Running', complete: 'Calculated' };
const plain = [[-3, 0, 5, 5], [-3, 14, 5, -9], [5, 2, -3, -5], [5, -12, -3, 9],
  [3, 6, -3, -7], [-5, -6, 4, 13], [4, -6, -4, 2], [0, 0, 0, 0]];

// Independent indexing checks: do not let identical controller/model mistakes
// pass merely because the browser agrees with the exported comparison builder.
function pathIDs(target, profile) {
  const waves = Math.ceil(profile.batch * 4 / (target === 'cpu' ? 2 : 8));
  return [['prepare-start', 'prepare-ready'], ['place-start', ...(target === 'cpu' ? ['place-ready'] :
    [...(profile.resident ? [] : ['place-weights']), 'place-inputs'])], ['submit-start', 'submit-queued'],
  ['compute-start', ...Array.from({ length: waves }, (_, i) => `compute-wave-${i + 1}`)],
  ['finish-start', ...(target === 'cpu' ? ['finish-returned'] : ['finish-synchronized', 'finish-copied'])]];
}
function checkComparison(profile) {
  const comparison = buildComparison(profile), frames = flat(comparison);
  assert.deepEqual(comparison.settings, profile);
  assert.equal(comparison.stages.length, 5);
  assert.deepEqual(comparison.output, plain.slice(0, profile.batch).map(row =>
    row.map(value => profile.branching ? value + (value >= 0 ? 1 : -1) : value)));
  const ids = Object.fromEntries(targets.map(target => [target, pathIDs(target, profile)]));
  comparison.stages.forEach((stage, s) => {
    assert.equal(stage.id, stageIDs[s]); assert.equal(stage.available, true);
    assert.equal(stage.frames.length, Math.max(ids.cpu[s].length, ids.gpu[s].length));
    stage.frames.forEach((beat, i) => {
      assert.equal(beat.id, `${stageIDs[s]}-beat-${i + 1}`);
      for (const target of targets) {
        const endpoint = Math.min(i, ids[target][s].length - 1), current = beat[target];
        assert.equal(current.id, ids[target][s][endpoint]);
        assert.equal(beat.advanced[target], i < ids[target][s].length);
        assert.deepEqual(current, comparison.paths[target].stages[s].frames[endpoint]);
        if (!beat.advanced[target]) {
          assert.deepEqual(current, stage.frames[i - 1][target], `${target} hold cannot do work`);
          assert.notEqual(current, stage.frames[i - 1][target], 'held frames are independently owned');
        }
        if (s === 3) {
          const computed = Math.min(endpoint * (target === 'cpu' ? 2 : 8), profile.batch * 4);
          assert.equal(current.computed, computed);
          assert.deepEqual(current.results, comparison.output.flat().map((value, cell) => cell < computed ? value : null));
        }
        assert.equal(current.readable, s === 4 && endpoint >= (target === 'cpu' ? 1 : 2));
      }
    });
  });
  for (const target of targets) {
    assert.equal(comparison.paths[target].settings.environment, 'native');
    assert.equal(comparison.paths[target].blocked, false);
    assert.deepEqual(frames[0][target].results, Array(profile.batch * 4).fill(null));
    assert.deepEqual(frames.at(-1)[target].results, comparison.output.flat());
    assert.equal(frames.at(-1)[target].elapsed, comparison.totals[target]);
  }
  assert.deepEqual(buildComparison({ ...profile, target: 'gpu', environment: 'vm', assignment: 'none', deviceAllowed: false }), comparison,
    'execution/access options cannot reconfigure either comparison path');
  return comparison;
}
for (const profile of profiles) checkComparison(profile);
console.log('PASS Node comparison: all 8 profiles, independent paired indices, matrices, native paths and no-work holds');

(async () => {
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const path = resolve(root, decodeURIComponent(pathname).replace(/^\/interactive-guides\//, ''));
      if (!path.startsWith(root + sep)) throw Error('Outside project');
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream');
      res.end(await readFile(path));
    } catch { res.statusCode = 404; res.end('Not found'); }
  });
  let browser;
  const errors = [];
  try {
    await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const urls = { http: `${origin}/interactive-guides/${file}`, file: pathToFileURL(resolve(root, file)).href };
    browser = await puppeteer.launch({ headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox'] });
    async function newPage(missing) {
      const page = await browser.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => errors.push(`${page.url()}: ${error}`));
      await page.setRequestInterception(true);
      page.on('request', request => {
        const url = request.url();
        if (!(url.startsWith(origin + '/') || url.startsWith(pathToFileURL(root + sep).href) || /^(about:|data:)/.test(url))) {
          errors.push('Unexpected network: ' + url); void request.abort();
        } else if (missing && new URL(url).pathname.endsWith('/assets/' + missing)) void request.abort();
        else void request.continue();
      });
      await page.evaluateOnNewDocument(() => {
        const set = window.setInterval.bind(window), clear = window.clearInterval.bind(window);
        window.__computeTimers = new Set(); window.__computeFast = false;
        window.setInterval = (fn, ms, ...args) => {
          const id = set(fn, window.__computeFast ? 10 : ms, ...args);
          window.__computeTimers.add(id); return id;
        };
        window.clearInterval = id => { window.__computeTimers.delete(id); clear(id); };
      });
      return page;
    }
    const page = await newPage();
    const go = async url => {
      // A hash-only goto retains per-stage positions; deep links need a fresh document.
      await page.goto('about:blank'); await page.goto(url, { waitUntil: 'load' });
    };
    const click = selector => page.$eval(selector, node => node.click());
    const stage = index => click(`button[data-stage="${index}"]`);
    const text = id => page.$eval('#' + id, node => node.textContent);
    const frameID = () => page.$eval('#compute-simulator', node => node.dataset.frame);
    const timerCount = () => page.evaluate(() => window.__computeTimers.size);
    async function pointer(selector) {
      await page.$eval(selector, node => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
      await page.click(selector);
    }
    async function change(id, value) {
      await page.$eval('#' + id, (node, value) => {
        if (node.type === 'checkbox') node.checked = value; else node.value = String(value);
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
    }
    async function configure(profile) {
      for (const [key, id] of Object.entries({ batch: 'compute-batch', resident: 'compute-resident', branching: 'compute-branching' }))
        await change(id, profile[key]);
      await click('#compute-restart');
    }
    // This same complete DOM snapshot is used for both directions, every beat.
    function readSnapshot() {
      const $ = id => document.getElementById(id), paths = {};
      for (const target of ['cpu', 'gpu']) {
        const prefix = 'compute-' + target + '-', value = key => $(prefix + key).textContent;
        paths[target] = {
          frame: $(prefix + 'path').dataset.frame, holding: $(prefix + 'path').dataset.holding,
          heldHidden: $(prefix + 'held').hidden, step: value('step'), queue: value('queue'),
          cells: value('cells'), readable: value('readable'), units: value('units'),
          values: [...$(prefix + 'output-grid').children].map(n => n.dataset.value === '' ? null : Number(n.dataset.value)),
          indices: [...$(prefix + 'output-grid').children].map(n => n.dataset.cell),
          selected: [...$(prefix + 'output-grid').querySelectorAll('[aria-pressed="true"]')].map(n => n.dataset.cell),
          calculated: [...$(prefix + 'output-grid').querySelectorAll('.calculated')].map(n => Number(n.dataset.cell)),
          active: [...$(prefix + 'output-grid').querySelectorAll('.active')].map(n => Number(n.dataset.cell)),
          busyLanes: [...$(prefix + 'lane-groups').querySelectorAll('.busy')].map(n => n.textContent),
          laneCount: $(prefix + 'lane-groups').querySelectorAll('.lane').length,
          state: $(prefix + 'output-state').dataset.state,
          memoryHidden: $(prefix + 'memory').hidden, lanesHidden: $(prefix + 'lanes').hidden,
          outputHidden: $(prefix + 'output').hidden,
          inputs: value('inputs'), weights: value('weights'), hostOutput: value('host-output'),
          deviceOutput: target === 'gpu' ? value('device-output') : null
        };
      }
      return {
        stage: $('compute-simulator').dataset.stage, frame: $('compute-simulator').dataset.frame,
        target: $('compute-simulator').getAttribute('data-target'), paths,
        panels: [...document.querySelectorAll('[data-compute-stage]:not([hidden])')].map(n => n.dataset.computeStage),
        selectedStages: [...document.querySelectorAll('[data-stage][aria-current="step"]')].map(n => n.dataset.stage),
        resultHidden: $('compute-result-summary').hidden,
        equation: $('compute-equation').textContent, note: $('compute-output-note').textContent
      };
    }
    function checkSnapshot(actual, expected, comparison, context) {
      const s = expected.stage, total = comparison.settings.batch * 4;
      assert.equal(actual.stage, String(s), context); assert.equal(actual.frame, expected.id, context);
      assert.equal(actual.target, null, 'comparison has no selected target');
      assert.deepEqual(actual.panels, [String(s)], context);
      assert.deepEqual(actual.selectedStages, [String(s)], context);
      const resultReady = s === 4 && expected.cpu.readable && expected.gpu.readable;
      assert.equal(actual.resultHidden, !resultReady, context);
      for (const target of targets) {
        const current = expected[target], holding = !expected.advanced[target];
        const present = key => current.data[(target === 'cpu' ? 'host' : 'device') + key];
        assert.deepEqual(actual.paths[target], {
          frame: current.id, holding: String(holding), heldHidden: !holding, step: current.title,
          queue: queueLabels[current.queue], cells: `${current.computed} / ${total}`,
          readable: current.readable ? 'Ready' : 'Not yet', units: String(current.elapsed),
          values: current.results, indices: Array.from({ length: total }, (_, i) => String(i)), selected: ['0'],
          calculated: current.results.flatMap((value, i) => value === null ? [] : [i]),
          active: s === 3 && !holding ? current.active : [],
          busyLanes: holding ? [] : current.active.map((_, i) => 'L' + (i + 1)),
          laneCount: target === 'cpu' ? 2 : 8,
          state: current.readable ? 'readable' : 'pending',
          memoryHidden: ![1, 2, 4].includes(s) || resultReady, lanesHidden: s !== 3, outputHidden: s === 1 || s === 2,
          inputs: present('Inputs') ? `${total} ready` : 'Missing',
          weights: present('Weights') ? '16 ' + (target === 'gpu' && comparison.settings.resident ? 'resident' : 'ready') : 'Missing',
          hostOutput: !current.data.hostOutputs ? 'Empty' : current.readable ? 'Ready' : `${current.computed} calculated`,
          deviceOutput: target === 'gpu' ? current.data.deviceOutputs ? `${current.computed} calculated` : 'Empty' : null
        }, `${context}: ${target}`);
        assert(actual.note.includes(`${target.toUpperCase()}: ${current.results[0] === null ? 'cell pending' : 'cell calculated = ' + current.results[0]}`), context);
      }
      const computed = targets.some(target => expected[target].results[0] !== null);
      assert.equal(actual.equation, 'Row 1, column 1: (1 × 1) + (2 × -1) + (-1 × 2) + (0 × 0) = ' +
        (computed ? '-3' : '?') + (comparison.settings.branching ? computed ? ' → −1 path → -4' :
          '. Then nonnegative +1; negative −1 (pending).' : ''), context);
    }
    async function walk(profile) {
      const comparison = checkComparison(profile), expected = flat(comparison);
      const actual = await page.evaluate((source, limit) => {
        const read = (0, eval)('(' + source + ')'), $ = id => document.getElementById(id);
        function direction(id) {
          const snapshots = [read()], seen = new Set([snapshots[0].frame]);
          for (let i = 1; i < limit && !$(id).disabled; i++) {
            $(id).click(); const snapshot = read();
            if (seen.has(snapshot.frame)) throw Error(`${id} cycles at ${snapshot.frame}`);
            seen.add(snapshot.frame); snapshots.push(snapshot);
          }
          if (!$(id).disabled) throw Error(`${id} exceeded finite ${limit}-beat guard`);
          const endpoint = JSON.stringify(read()); $(id).click();
          if (JSON.stringify(read()) !== endpoint) throw Error(`${id} moved past endpoint`);
          return snapshots;
        }
        return { forward: direction('compute-next'), reverse: direction('compute-previous') };
      }, readSnapshot.toString(), expected.length);
      assert.equal(actual.forward.length, expected.length, JSON.stringify(profile) + ' forward count');
      assert.equal(actual.reverse.length, expected.length, JSON.stringify(profile) + ' reverse count');
      expected.forEach((beat, i) => {
        checkSnapshot(actual.forward[i], beat, comparison, `${JSON.stringify(profile)} Next ${i}`);
        checkSnapshot(actual.reverse[expected.length - 1 - i], beat, comparison, `${JSON.stringify(profile)} Prev ${i}`);
        if (beat.stage === 3 && !beat.advanced.gpu) {
          const before = actual.forward[i - 1].paths.gpu, held = actual.forward[i].paths.gpu;
          assert.equal(held.units, before.units, 'GPU compute hold adds no units');
          assert.deepEqual(held.values, before.values, 'GPU compute hold performs no recalculation');
          assert.deepEqual(held.calculated, before.calculated);
          assert.deepEqual(held.active, [], 'GPU compute hold has no highlighted cell');
          assert.deepEqual(held.busyLanes, [], 'GPU compute hold has no busy lane');
        }
        if (beat.stage === 4 && beat.position === 1) {
          assert.equal(actual.forward[i].paths.cpu.readable, 'Ready', 'Finish event 1 returns CPU result');
          assert.equal(actual.forward[i].paths.gpu.readable, 'Not yet', 'synchronization is not host output copy');
        }
        if (beat.stage === 4 && beat.position === 2) {
          assert.equal(actual.forward[i].paths.cpu.holding, 'true');
          assert.equal(actual.forward[i].paths.gpu.readable, 'Ready', 'Finish event 2 copies GPU result');
          assert.equal(actual.forward[i].paths.cpu.units, actual.forward[i - 1].paths.cpu.units);
        }
      });
      assert.equal(await timerCount(), 0);
      return expected.length;
    }
    async function documentChecks(current = page) {
      assert.deepEqual(await current.$$eval('[id]', nodes => nodes.map(n => n.id).filter((id, i, ids) => ids.indexOf(id) !== i)), [], 'duplicate IDs');
      assert.equal(await current.$('.guide-dock'), null, 'no generic topic dock');
      assert.equal(await current.$('.comparison-label'), null, 'no redundant CPU/GPU header above stage navigation');
      assert.equal(await current.$('[data-target]'), null, 'no target toggle or selected target attribute');
      assert.equal(await current.$('#compute-environment'), null);
      assert.equal(await current.$$eval('#compute-access input, #compute-access select, #compute-access button', ns => ns.length), 0, 'access explanation is read-only');
      assert.deepEqual(await current.$$eval('[data-path]', ns => ns.map(n => [n.tagName, n.dataset.path, n.id])),
        [['ARTICLE', 'cpu', 'compute-cpu-path'], ['ARTICLE', 'gpu', 'compute-gpu-path']]);
      assert.deepEqual(await current.$$eval('button[data-stage]', ns => ns.map(n => n.disabled)), Array(5).fill(false));
    }

    for (const protocol of ['http', 'file']) {
      await go(urls[protocol]); await documentChecks();
      let beats = 0;
      for (const profile of profiles) { await configure(profile); beats += await walk(profile); }
      console.log(`PASS ${protocol}: all 8 profiles, ${beats} forward + ${beats} reverse paired snapshots, both paths (no sampling)`);

      // Both articles retain the same side-by-side geometry, even on phones.
      for (const theme of ['light', 'dark']) for (const width of [320, 390, 1280]) {
        await page.setViewport({ width, height: 950 });
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
        await go(urls[protocol]);
        assert.equal(await frameID(), 'prepare-beat-1'); assert.equal(await timerCount(), 0);
        assert(await page.$eval('.dashboard', node => {
          const style = getComputedStyle(node), box = node.getBoundingClientRect();
          return box.bottom <= document.querySelector('.playback').getBoundingClientRect().top + 1 &&
            parseFloat(style.borderTopWidth) > 0 && parseFloat(style.borderRadius) > 0 &&
            node.querySelector('table').getBoundingClientRect().width <= box.width;
        }), 'shared status table is boxed above playback');
        assert.equal(await page.$eval('#compute-play', n => n.getAttribute('aria-pressed')), 'false');
        assert.match(await text('compute-inputs'), /previews—not proof/);
        await configure({ batch: 8, resident: false, branching: true });
        for (let s = 0; s < 5; s++) {
          await stage(s);
          assert.equal(await page.$eval('#compute-inputs', n => n.open), false);
          assert.equal(await page.$eval('#compute-calculation', n => n.open), s === 0);
          assert.equal(await page.$eval('#compute-result-summary', n => n.hidden), true, 'outcome is not revealed at a checkpoint before both callers are ready');
          assert.equal(await page.$$eval('#compute-input-matrix .number', ns => ns.length), 32);
          assert.equal(await page.$$eval('#compute-weight-matrix .number', ns => ns.length), 16);
          const layout = await page.evaluate(() => {
            const rect = selector => document.querySelector(selector).getBoundingClientRect();
            const cpu = rect('#compute-cpu-path'), gpu = rect('#compute-gpu-path');
            return { topDelta: Math.abs(cpu.top - gpu.top), widthDelta: Math.abs(cpu.width - gpu.width),
              gap: gpu.left - cpu.right, overflow: document.documentElement.scrollWidth - innerWidth,
              spacing: rect('.compute-board').top - rect('.playback').bottom,
              targets: [...document.querySelectorAll('[data-path] section:not([hidden]) .matrix button')].map(n => {
                const r = n.getBoundingClientRect(); return [r.width, r.height];
              }) };
          });
          assert(layout.topDelta < 1 && layout.widthDelta < 1 && layout.gap > 0, `${protocol} ${theme} ${width}px stage ${s}: equal-width paths in one row`);
          assert(layout.overflow <= 1, `${protocol} ${theme} ${width}px stage ${s}: no horizontal overflow`);
          assert(layout.spacing >= 16, `${protocol} ${theme} ${width}px stage ${s}: board/playback spacing ${layout.spacing}`);
          if (![1, 2].includes(s)) {
            assert.equal(layout.targets.length, 64);
            assert(layout.targets.every(([w, h]) => w >= 24 && h >= 24), `${width}px stage ${s}: output target >=24px`);
          }
          for (const target of targets) {
            assert.equal(await page.$eval(`#compute-${target}-memory`, n => n.hidden), ![1, 2, 4].includes(s));
            assert.equal(await page.$eval(`#compute-${target}-lanes`, n => n.hidden), s !== 3);
            assert.equal(await page.$eval(`#compute-${target}-output`, n => n.hidden), [1, 2].includes(s));
          }
          assert(await page.$eval(`button[data-stage="${s}"]`, n => {
            const r = n.getBoundingClientRect(), p = n.parentElement.getBoundingClientRect();
            return r.left >= p.left - 2 && r.right <= p.right + 2;
          }), 'current stage remains visible within the strip');
        }
        await documentChecks();
        console.log(`PASS layout: ${protocol}, ${theme}, ${width}px, five stages, equal side-by-side paths and usable cells`);
      }
      await page.setViewport({ width: 1280, height: 950 });
      await go(urls[protocol]);

      // Workload controls are shared, remain available in their stages, and
      // reset every paired position without changing the current checkpoint.
      for (const [s, id, value] of [[0, 'compute-batch', 8], [1, 'compute-resident', true], [3, 'compute-branching', true]]) {
        await stage(s); await click('#compute-next');
        assert(await page.$eval('#' + id, n => !n.disabled && !n.closest('section').hidden));
        await change(id, value);
        assert.equal(await frameID(), `${stageIDs[s]}-beat-1`);
        assert.equal(await page.$eval('#compute-simulator', n => n.dataset.stage), String(s));
        for (const target of targets) assert.equal(await text(`compute-${target}-cells`), '0 / 32');
      }
      await stage(1); assert.equal(await frameID(), 'place-beat-1', 'rebuild clears other stage positions too');
      assert.equal(await page.$eval('#compute-batch', n => n.value), '8');
      assert.equal(await page.$eval('#compute-resident', n => n.checked), true);
      assert.equal(await page.$eval('#compute-branching', n => n.checked), true);
      console.log(`PASS ${protocol}: shared workload controls reset paired positions and preserve the current stage`);

      await configure({ batch: 8, resident: true, branching: true });
      await stage(2); await click('#compute-next');
      const beforeCloseup = await page.evaluate(readSnapshot);
      await pointer('#compute-access > summary');
      assert.deepEqual(await page.evaluate(readSnapshot), beforeCloseup, 'native disclosure opening does not alter either trace');
      assert.match(await text('compute-access'), /explanatory only/);
      assert.match(await text('compute-access'), /container shares its hosting kernel/);
      await page.focus('#compute-access > summary'); await page.keyboard.press('Space');
      assert.equal(await page.$eval('#compute-access', n => n.open), false);
      assert.deepEqual(await page.evaluate(readSnapshot), beforeCloseup, 'keyboard disclosure closing does not alter either trace');
      await documentChecks();
      await click('#compute-next'); assert.equal(await frameID(), 'compute-beat-1');
      await click('#compute-previous'); assert.equal(await frameID(), 'submit-beat-2');
      console.log(`PASS ${protocol}: read-only native OS/container/VM close-up never gates or resets either path`);

      // Real pointer/keyboard input complements exhaustive programmatic walks.
      await go(urls[protocol]);
      await pointer('button[data-stage="1"]'); assert.equal(await frameID(), 'place-beat-1');
      await page.keyboard.press('ArrowRight'); assert.equal(await frameID(), 'submit-beat-1');
      await page.keyboard.press('End'); assert.equal(await frameID(), 'finish-beat-1');
      await page.keyboard.press('Home'); assert.equal(await frameID(), 'prepare-beat-1');
      await page.keyboard.press('ArrowLeft'); assert.equal(await frameID(), 'finish-beat-1');
      await page.keyboard.press('Home');
      await pointer('[data-choice-for="compute-batch"] [data-choice-value="8"]');
      assert.equal(await page.$eval('#compute-batch', n => n.value), '8');
      await page.keyboard.press('Home'); assert.equal(await page.$eval('#compute-batch', n => n.value), '1');
      await page.keyboard.press('ArrowRight'); assert.equal(await page.$eval('#compute-batch', n => n.value), '8');
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('End');
      assert.equal(await page.$eval('[data-choice-for="compute-batch"] [aria-checked="true"]', n => n.dataset.choiceValue), '8');
      await pointer('button[data-stage="1"]'); await pointer('#compute-resident');
      assert.equal(await page.$eval('#compute-resident', n => n.checked), true);
      await page.keyboard.press('Space'); assert.equal(await page.$eval('#compute-resident', n => n.checked), false);
      await pointer('button[data-stage="3"]'); await page.focus('#compute-branching'); await page.keyboard.press('Space');
      assert.equal(await page.$eval('#compute-branching', n => n.checked), true);
      await pointer('#compute-restart'); await pointer('#compute-next');
      assert.equal(await frameID(), 'prepare-beat-2');
      await pointer('#compute-previous'); assert.equal(await frameID(), 'prepare-beat-1');
      for (const target of targets) {
        const selector = `#compute-${target}-output-grid [data-cell="3"]`;
        const before = await frameID(); await pointer(selector);
        assert.equal(await frameID(), before, 'cell selection does not advance paired work');
        assert(await page.$eval('#compute-calculation', n => n.open));
        assert(await page.$eval(selector, n => document.activeElement === n), 'clicked cell retains focus after matrices rerender');
        for (const path of targets) assert.deepEqual(await page.$$eval(`#compute-${path}-output-grid [aria-pressed="true"]`, ns => ns.map(n => n.dataset.cell)), ['3']);
        assert.match(await text('compute-equation'), /^Row 1, column 4:/);
        const keyboardCell = `#compute-${target}-output-grid [data-cell="2"]`;
        await page.focus(keyboardCell); await page.keyboard.press('Enter');
        assert(await page.$eval(keyboardCell, n => document.activeElement === n));
        for (const path of targets) assert.deepEqual(await page.$$eval(`#compute-${path}-output-grid [aria-pressed="true"]`, ns => ns.map(n => n.dataset.cell)), ['2']);
        assert.match(await text('compute-equation'), /^Row 1, column 3:/);
      }
      console.log(`PASS ${protocol}: actual pointer/keyboard stages, choices, checkboxes, playback and shared cell inspector/focus`);

      for (const [hash, expected] of [...stageIDs.map(id => ['#' + id, id + '-beat-1']),
        ['#%70lace', 'place-beat-1'], ['#wait', 'finish-beat-1'], ['#use', 'finish-beat-1'], ['#%', 'prepare-beat-1'], ['#%E0%A4%A', 'prepare-beat-1'],
        ['#not-a-stage', 'prepare-beat-1'], ['#compute-title', 'prepare-beat-1']]) {
        await go(urls[protocol] + hash); assert.equal(await frameID(), expected, hash);
      }
      await go(urls[protocol]); await stage(1); await click('#compute-next'); await stage(4);
      await page.goBack(); await page.waitForFunction(() => document.getElementById('compute-simulator').dataset.stage === '1');
      assert.equal(await frameID(), 'place-beat-2', 'history retains a checkpoint position');
      await page.goForward(); await page.waitForFunction(() => document.getElementById('compute-simulator').dataset.stage === '4');
      await page.evaluate(() => { location.hash = '#%'; });
      await page.waitForFunction(() => location.hash === '#%');
      assert.equal(await frameID(), 'finish-beat-1');
      console.log(`PASS ${protocol}: deep links, encoded/malformed/unknown hashes, position-preserving history`);

      await go(urls[protocol]);
      await new Promise(done => setTimeout(done, 1500)); // Longer than the real interval: no implicit consent.
      assert.equal(await frameID(), 'prepare-beat-1'); assert.equal(await timerCount(), 0);
      await page.evaluate(() => { window.__computeFast = true; });
      await pointer('#compute-play');
      await page.waitForFunction(() => document.getElementById('compute-next').disabled && window.__computeTimers.size === 0);
      assert.equal(await frameID(), 'finish-beat-3');
      assert.equal(await page.$eval('#compute-result-summary', n => n.hidden), false, 'application and cost summary are part of completion, with no separate Use step');
      await click('#compute-previous');
      assert.equal(await page.$eval('#compute-result-summary', n => n.hidden), true, 'rewinding the output copy hides the outcome again');
      await click('#compute-next');
      for (const target of targets) assert.equal(await text(`compute-${target}-readable`), 'Ready');
      await page.evaluate(() => { window.__computeFast = false; });
      for (const action of ['previous', 'stage', 'restart', 'batch', 'resident', 'branching', 'print', 'pagehide', 'pause']) {
        await configure({ batch: 1, resident: false, branching: false });
        const s = action === 'resident' ? 1 : action === 'branching' ? 3 : 0;
        await stage(s); await click('#compute-next'); await pointer('#compute-play');
        assert.equal(await timerCount(), 1, action + ' starts one timer');
        if (action === 'previous') await pointer('#compute-previous');
        if (action === 'stage') await pointer('button[data-stage="2"]');
        if (action === 'restart') await pointer('#compute-restart');
        if (action === 'batch') await pointer('[data-choice-for="compute-batch"] [data-choice-value="8"]');
        if (action === 'resident') await pointer('#compute-resident');
        if (action === 'branching') { await page.focus('#compute-branching'); await page.keyboard.press('Space'); }
        if (action === 'print') await page.evaluate(() => { dispatchEvent(new Event('beforeprint')); dispatchEvent(new Event('afterprint')); });
        if (action === 'pagehide') await page.evaluate(() => dispatchEvent(new Event('pagehide')));
        if (action === 'pause') await pointer('#compute-play');
        assert.equal(await timerCount(), 0, action + ' clears timer');
        assert.equal(await page.$eval('#compute-play', n => n.getAttribute('aria-pressed')), 'false');
      }
      console.log(`PASS ${protocol}: consent-only autoplay completes; Prev/stage/restart/all workload changes/print/pagehide/pause stop timers`);

      // Partial trace, both workloads and both initially open/closed disclosures.
      for (const branching of [false, true]) {
        const profile = { batch: 8, resident: true, branching };
        await configure(profile); await stage(3); await click('#compute-next');
        await page.$eval('#compute-inputs', (n, open) => { n.open = open; }, branching);
        await page.$eval('#compute-calculation', (n, open) => { n.open = open; }, !branching);
        const before = await page.evaluate(readSnapshot);
        const disclosures = await page.$$eval('details', ns => ns.map(n => n.open));
        await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
        await page.emulateMediaType('print');
        assert(await page.$$eval('[data-compute-stage]', ns => ns.length === 5 && ns.every(n =>
          getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().height > 0 && n.querySelector('.stage-article').innerText.length > 100)));
        assert(await page.$$eval('.stage-article', ns => ns.length === 5 && ns.every(n =>
          getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().height > 0)), 'all five full articles print');
        assert(await page.$eval('#compute-print-reference', n => n.getBoundingClientRect().height > 0));
        const reference = await text('compute-print-reference');
        assert.match(reference, /not a claim that the current trace has finished/);
        assert.match(reference, /not caller-readable until.*synchronization and output copy complete/);
        assert.match(reference, /identical on CPU and GPU/);
        for (const row of buildComparison(profile).output) assert(reference.includes(row.join('  ')), 'fresh workload reference matrix');
        for (const target of targets) assert.equal(await text(`compute-${target}-readable`), 'Not yet');
        await page.emulateMediaType('screen'); await page.evaluate(() => dispatchEvent(new Event('afterprint')));
        assert.deepEqual(await page.evaluate(readSnapshot), before, 'print restores exact paired state');
        assert.deepEqual(await page.$$eval('details', ns => ns.map(n => n.open)), disclosures, 'print restores every disclosure');
        assert.equal(await page.$$eval('[data-compute-stage]:not([hidden])', ns => ns.length), 1);
        assert.equal(await page.$eval('#compute-print-reference', n => n.getBoundingClientRect().height), 0);
      }
      console.log(`PASS ${protocol}: five full printed articles, current reference matrix, partial-state disclaimer, state/disclosure restoration`);

      for (const missing of ['javascript', 'compute-model.js', 'compute-guide.js', 'guide-layout.js']) {
        const fallback = await newPage(missing === 'javascript' ? undefined : missing);
        try {
          if (missing === 'javascript') await fallback.setJavaScriptEnabled(false);
          await fallback.goto(urls[protocol], { waitUntil: 'load' });
          if (missing === 'guide-layout.js') {
            assert.equal(await fallback.$('.choice-cards'), null);
            assert(await fallback.$eval('#compute-batch', n => !n.hidden && n.getBoundingClientRect().height > 0));
            // Native select menus use platform UI in Chrome; Puppeteer's select
            // dispatches their input/change contract without OS-menu timing.
            await fallback.select('#compute-batch', '8');
            assert.equal(await fallback.$eval('#compute-batch', n => n.value), '8', 'native select works without presentation helper');
            for (const target of targets) assert.equal(await fallback.$eval(`#compute-${target}-cells`, n => n.textContent), '0 / 32');
            await fallback.click('button[data-stage="2"]'); await fallback.click('#compute-next'); await fallback.click('#compute-next');
            assert.equal(await fallback.$eval('#compute-simulator', n => n.dataset.frame), 'compute-beat-1');
            await documentChecks(fallback);
          } else {
            assert(await fallback.$$eval('[data-compute-stage]', ns => ns.length === 5 && ns.every(n =>
              !n.hidden && getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().height > 0 &&
              n.querySelector('.stage-article').innerText.length > 100)), `${protocol}: readable full article without ${missing}`);
            assert.equal(await fallback.$eval('html', n => n.classList.contains('compute-ready')), false);
            if (missing === 'compute-model.js') assert.equal(await fallback.$eval('#compute-error', n => n.hidden), false);
          }
          assert.deepEqual(await fallback.$$eval('[id]', ns => ns.map(n => n.id).filter((id, i, ids) => ids.indexOf(id) !== i)), []);
        } finally { await fallback.close(); }
      }
      await documentChecks(); assert.equal(await timerCount(), 0);
      console.log(`PASS ${protocol}: JS-off/model-missing/controller-missing articles, missing-layout native select`);
    }
    assert.deepEqual(errors, [], 'script errors or unexpected external requests');
    console.log('PASS compute comparison: no script errors, duplicate IDs, external requests or leaked playback timers');
  } finally {
    try { if (browser) await browser.close(); }
    finally { if (server.listening) await new Promise((done, reject) => server.close(error => error ? reject(error) : done())); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
