'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const OSModel = require('../assets/os-model.js');
const journey = require('../assets/os-journey-model.js');
const { buildJourney, crashJourney } = journey;
const { OLD_TEXT: OLD, NEW_TEXT: NEW } = OSModel;
const clone = value => JSON.parse(JSON.stringify(value));
const defaults = { allowed: true, cached: false, slow: false, pressure: false, renamed: false };
const launchIds = ['launch', 'process', 'code-read', 'code-ready', 'running'];
const saveIds = ['save-ready', 'write-return', 'device-accepted', 'sync-request', 'synced'];
const fields = ['id', 'stage', 'title', 'text', 'owner', 'process', 'memory', 'filename', 'handle', 'inode',
  'app', 'cache', 'device', 'disk', 'reads', 'written', 'durable', 'dirty', 'codeResident', 'saveIndex'].sort();
const byId = (run, id) => run.frames.find(frame => frame.id === id);

function expectedIds(settings) {
  const ids = [...launchIds, 'open-request', 'lookup', 'permission'];
  if (!settings.allowed) return [...ids, 'denied'];
  ids.push('opened');
  if (settings.renamed) ids.push('renamed');
  ids.push('cache-check');
  if (!settings.cached) {
    ids.push('document-read');
    if (settings.slow) ids.push('storage-wait-1', 'storage-wait-2');
    ids.push('io-ready');
  }
  ids.push('read-complete', 'editing-start');
  if (settings.pressure) ids.push('code-evict', 'code-reload', 'code-resume');
  return [...ids, 'edited', ...saveIds];
}

function assertSave(frame) {
  const version = OSModel.saveRun()[frame.saveIndex];
  for (const key of ['app', 'cache', 'device', 'disk', 'written']) assert.equal(frame[key], version[key], key);
  assert.equal(frame.durable, version.latestDurable);
  assert.equal(frame.dirty, frame.saveIndex === 2);
}

for (let mask = 0; mask < 32; mask++) {
  const options = Object.fromEntries(Object.keys(defaults).map((key, bit) => [key, Boolean(mask & (1 << bit))]));
  test('full journey invariants for all option combinations: ' + JSON.stringify(options), () => {
    const input = Object.freeze({ ...options });
    const run = buildJourney(input);
    const { frames, checkpoints } = run;
    assert.deepEqual(run.settings, options);
    assert.deepEqual(run, buildJourney(input), 'deterministic');
    assert.deepEqual(frames.map(frame => frame.id), expectedIds(options));
    assert.equal(new Set(frames.map(frame => frame.id)).size, frames.length);
    assert.equal(run.terminalStage, options.allowed ? 4 : 1);
    assert.equal(checkpoints.length, 5);
    const expectedReads = options.allowed ? (options.cached ? 1 : 2) + Number(options.pressure) : 1;
    assert.equal(frames.at(-1).reads, expectedReads);
    let previousStage = 0, reads = 0;
    const editedIndex = frames.findIndex(frame => frame.id === 'edited');
    const renameIndex = frames.findIndex(frame => frame.id === 'renamed');
    const openIndex = frames.findIndex(frame => frame.id === 'opened');
    const readIndex = frames.findIndex(frame => frame.id === 'read-complete');
    for (const [index, frame] of frames.entries()) {
      assert.deepEqual(Object.keys(frame).sort(), fields);
      for (const key of ['title', 'text', 'owner', 'process', 'memory']) {
        assert.equal(typeof frame[key], 'string');
        assert.ok(frame[key].length > 0);
      }
      assert.ok(frame.stage >= previousStage && frame.stage <= run.terminalStage, 'stages are monotonic');
      previousStage = frame.stage;
      if (['code-read', 'document-read', 'code-reload'].includes(frame.id)) reads++;
      assert.equal(frame.reads, reads, 'only actual read requests increment reads');
      assert.equal(frame.filename, renameIndex !== -1 && index >= renameIndex ? 'shopping.txt' : 'todo.txt');
      assert.equal(frame.handle, openIndex !== -1 && index >= openIndex ? 3 : null);
      assert.equal(frame.inode, openIndex !== -1 && index >= openIndex ? 42 : null);
      if (readIndex === -1 || index < readIndex) assert.equal(frame.app, null);
      if (editedIndex === -1 || index < editedIndex) {
        assert.equal(frame.durable, null, 'no new edit has durability yet');
        assert.equal(frame.saveIndex, null);
        assert.equal(frame.written, false);
        assert.equal(frame.dirty, false);
        assert.equal(frame.disk, OLD);
        assert.equal(frame.device, OLD);
      } else {
        assertSave(frame);
      }
    }
    for (let stage = 0; stage < 5; stage++) {
      const indexes = frames.flatMap((frame, index) => frame.stage === stage ? [index] : []);
      assert.equal(checkpoints[stage], indexes.length ? indexes[0] : null);
    }
    assert.deepEqual(frames.slice(0, 5).map(frame => frame.process), ['Not started', 'Ready', 'Blocked', 'Ready', 'Running']);
    assert.deepEqual(frames.slice(0, 5).map(frame => frame.codeResident), [false, false, false, true, true]);
    assert.deepEqual(frames.slice(0, 5).map(frame => frame.reads), [0, 0, 1, 1, 1]);
    assert.equal(frames[0].cache, options.cached ? OLD : null);
    if (!options.allowed) {
      assert.equal(frames.at(-1).process, 'Running');
      assert.ok(frames.every(frame => frame.handle === null && frame.inode === null && frame.app === null));
      assert.ok(frames.every(frame => frame.stage < 2 && frame.saveIndex === null && !frame.written));
      assert.ok(frames.every(frame => frame.filename === 'todo.txt'));
      assert.deepEqual(checkpoints, [0, 5, null, null, null]);
      return;
    }
    if (options.cached) {
      assert.deepEqual(frames.filter(frame => frame.stage === 2).map(frame => frame.id), ['cache-check', 'read-complete']);
      assert.ok(frames.filter(frame => frame.stage === 2).every(frame => frame.process === 'Running'));
    } else {
      const pending = frames.filter(frame => ['document-read', 'storage-wait-1', 'storage-wait-2'].includes(frame.id));
      assert.equal(pending.length, options.slow ? 3 : 1);
      assert.ok(pending.every(frame => frame.reads === 2 && frame.process === 'Blocked' && frame.cache === null));
      assert.equal(byId(run, 'io-ready').process, 'Ready');
      assert.equal(byId(run, 'io-ready').cache, OLD);
      assert.equal(byId(run, 'io-ready').app, null);
    }
    assert.equal(byId(run, 'read-complete').process, 'Running');
    assert.equal(byId(run, 'read-complete').app, OLD);
    if (options.pressure) {
      assert.deepEqual(['code-evict', 'code-reload', 'code-resume'].map(id => byId(run, id).codeResident), [false, false, true]);
      assert.deepEqual(['code-evict', 'code-reload', 'code-resume'].map(id => byId(run, id).process), ['Running', 'Blocked', 'Running']);
      for (const id of ['code-evict', 'code-reload', 'code-resume']) {
        const frame = byId(run, id);
        assert.equal(frame.app, OLD);
        assert.equal(frame.cache, OLD, 'pressure preserves the document cache');
        assert.equal(frame.disk, OLD);
        assert.equal(frame.written, false, 'clean executable eviction requires no writeback');
      }
    }
    assert.equal(byId(run, 'edited').app, NEW);
    assert.equal(byId(run, 'device-accepted').device, NEW);
    assert.equal(byId(run, 'device-accepted').disk, OLD);
    assert.equal(byId(run, 'device-accepted').durable, false, 'device cache is volatile');
    assert.equal(byId(run, 'sync-request').process, 'Blocked');
    assert.equal(frames.at(-1).process, 'Running');
    assert.equal(frames.at(-1).app, NEW, 'no final close');
    assert.equal(frames.at(-1).durable, true);
    assert.deepEqual(frames.filter(frame => frame.saveIndex !== null).map(frame => frame.saveIndex), [1, 1, 2, 3, 3, 4]);
  });
}

test('defaults and rename change only the name from the rename event onward', () => {
  assert.deepEqual(buildJourney().settings, defaults);
  assert.deepEqual(buildJourney(), buildJourney(defaults));
  const plain = buildJourney();
  const renamed = buildJourney({ renamed: true });
  const event = byId(renamed, 'renamed');
  const opened = byId(renamed, 'opened');
  assert.equal(opened.filename, 'todo.txt');
  assert.equal(event.filename, 'shopping.txt');
  for (const frame of plain.frames) {
    assert.deepEqual({ ...byId(renamed, frame.id), filename: 'todo.txt' }, frame);
  }
  for (const key of fields.filter(key => !['id', 'title', 'text', 'filename'].includes(key))) {
    assert.equal(event[key], opened[key], key + ' unchanged by rename');
  }
});

test('application and power crash matrix covers edited and every save frame without mutation', () => {
  const run = buildJourney({ pressure: true, slow: true, renamed: true });
  const before = clone(run);
  for (const frame of run.frames.filter(frame => frame.saveIndex !== null)) {
    for (const failure of ['app', 'power']) {
      const actual = crashJourney(Object.freeze(frame), failure);
      assert.deepEqual(actual, OSModel.crashSave(frame.saveIndex, failure));
      assert.equal(actual.visible, failure === 'app' ? (frame.saveIndex >= 2 ? NEW : OLD) : (frame.saveIndex === 4 ? NEW : OLD));
      assert.equal(actual.durable, frame.saveIndex === 4 ? NEW : OLD);
      assert.ok(actual.explanation.length > 0);
      actual.visible = 'changed';
      assert.deepEqual(crashJourney(frame, failure), OSModel.crashSave(frame.saveIndex, failure));
    }
    assert.deepEqual(crashJourney(frame), crashJourney(frame, 'power'));
  }
  assert.deepEqual(run, before);
});

test('all snapshots, settings, checkpoints, and later runs are independent', () => {
  const input = { allowed: true, cached: true, pressure: true, slow: true, renamed: true };
  const original = buildJourney(input);
  const baseline = clone(original);
  assert.equal(new Set(original.frames).size, original.frames.length);
  for (let index = 0; index < original.frames.length; index++) {
    const run = buildJourney(input);
    for (const key of fields) run.frames[index][key] = { changed: true };
    assert.deepEqual(run.frames.filter((_, i) => i !== index), baseline.frames.filter((_, i) => i !== index));
    assert.deepEqual(buildJourney(input), baseline);
  }
  input.cached = false;
  assert.deepEqual(original.settings, baseline.settings);
  original.settings.allowed = false;
  original.checkpoints.fill(999);
  original.frames.length = 0;
  assert.deepEqual(buildJourney(baseline.settings), baseline);
  assert.deepEqual(OSModel.saveRun()[3].disk, OLD);
});

test('UMD browser export matches the Node API with OSModel loaded first', () => {
  const context = {};
  context.window = context;
  for (const file of ['../assets/os-model.js', '../assets/os-journey-model.js']) {
    vm.runInNewContext(fs.readFileSync(require.resolve(file), 'utf8'), context);
  }
  assert.deepEqual(Object.keys(context.OSJourneyModel).sort(), Object.keys(journey).sort());
  for (const options of [{}, { cached: true, pressure: true }, { allowed: false }, { slow: true, renamed: true }]) {
    const browserRun = context.OSJourneyModel.buildJourney(options);
    assert.deepEqual(clone(browserRun), buildJourney(options));
    for (const frame of browserRun.frames.filter(frame => frame.saveIndex !== null)) {
      for (const failure of ['app', 'power']) {
        assert.deepEqual(clone(context.OSJourneyModel.crashJourney(frame, failure)), crashJourney(frame, failure));
      }
    }
  }
});

test('validation rejects nonboolean options, unknown keys, unavailable crashes, and invalid failures', () => {
  for (const value of [null, [], '', 0, 1, true, () => {}]) assert.throws(() => buildJourney(value), TypeError);
  for (const key of Object.keys(defaults)) {
    for (const value of [undefined, null, 0, 1, 'true', 'false', {}, [], NaN]) {
      assert.throws(() => buildJourney({ [key]: value }), TypeError);
    }
  }
  for (const key of ['unknown', 'constructor', 'toString', '__proto__']) {
    assert.throws(() => buildJourney({ [key]: true }), RangeError);
  }
  for (const frame of [null, undefined, [], 'edited', 1, true, () => {}]) {
    assert.throws(() => crashJourney(frame), TypeError);
  }
  for (const saveIndex of [undefined, null, 0, 5, -1, 1.5, NaN, Infinity, '1', true, {}, []]) {
    assert.throws(() => crashJourney({ saveIndex }), RangeError);
  }
  for (const frame of buildJourney().frames.filter(frame => frame.saveIndex === null)) {
    assert.throws(() => crashJourney(frame), RangeError);
  }
  const frame = byId(buildJourney(), 'save-ready');
  for (const failure of [null, '', 'device', 'APP', 0, {}, [], true]) {
    assert.throws(() => crashJourney(frame, failure), RangeError);
  }
});
