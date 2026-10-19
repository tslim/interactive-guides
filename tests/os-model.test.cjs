'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const model = require('../assets/os-model.js');
const { schedule, PAGE_BYTES, pageTable, translate, memoryRun, OLD_TEXT, NEW_TEXT, saveRun, crashSave } = model;
const clone = value => JSON.parse(JSON.stringify(value));

function nonempty(value) {
  assert.equal(typeof value, 'string');
  assert.ok(value.length > 0);
}

test('UMD exports the same API to the browser without dependencies', () => {
  const context = {};
  context.window = context;
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/os-model.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.window.OSModel).sort(), Object.keys(model).sort());
  assert.deepEqual(clone(context.window.OSModel.schedule()), schedule());
  assert.deepEqual(clone(context.window.OSModel.memoryRun()), memoryRun());
  assert.deepEqual(clone(context.window.OSModel.saveRun()), saveRun());
});

test('exact one-core default dispatch trace and boundary states', () => {
  const run = schedule();
  assert.equal(run.work, 9);
  assert.equal(run.totalTicks, 9);
  assert.deepEqual(run.frames.map(frame => frame.cpu), [
    ['editor'], ['player'], ['indexer'], ['editor'], ['player'], ['indexer'], ['player'], ['editor'], ['editor'], [null]
  ]);
  assert.deepEqual(run.frames.map(frame => {
    const editor = frame.tasks[0];
    return [editor.state, editor.cpuDone, editor.waitRemaining];
  }), [
    ['running', 0, 0], ['ready', 1, 0], ['ready', 1, 0], ['running', 1, 0],
    ['blocked', 2, 3], ['blocked', 2, 2], ['blocked', 2, 1],
    ['running', 2, 0], ['running', 3, 0], ['done', 4, 0]
  ]);
});

test('exact two-core traces include idle intervals and wake-before-requeue tie break', () => {
  assert.deepEqual(schedule({ cores: 2 }).frames.map(frame => frame.cpu), [
    ['editor', 'player'], ['indexer', 'editor'], ['player', 'indexer'], ['player', null],
    [null, null], ['editor', null], ['editor', null], [null, null]
  ]);
  assert.deepEqual(schedule({ cores: 2, ioTicks: 1 }).frames.map(frame => frame.cpu), [
    ['editor', 'player'], ['indexer', 'editor'], ['player', 'indexer'], ['editor', 'player'],
    ['editor', null], [null, null]
  ]);
});

for (const cores of [1, 2]) {
  for (let ioTicks = 1; ioTicks <= 6; ioTicks++) {
    test('scheduler invariants and full I/O intervals: cores=' + cores + ', ioTicks=' + ioTicks, () => {
      const { frames, work, totalTicks } = schedule({ cores, ioTicks });
      assert.equal(work, 9);
      assert.equal(frames.length, totalTicks + 1);
      assert.equal(frames.flatMap(frame => frame.cpu).filter(Boolean).length, 9);
      const blocked = frames.filter(frame => frame.tasks[0].state === 'blocked');
      assert.equal(blocked.length, ioTicks);
      assert.deepEqual(blocked.map(frame => frame.tasks[0].waitRemaining),
        Array.from({ length: ioTicks }, (_, index) => ioTicks - index));
      const blockStart = blocked[0].time;
      const before = frames[blockStart - 1];
      assert.ok(before.cpu.includes('editor'));
      assert.equal(before.tasks[0].cpuDone, 1);
      assert.equal(frames[blockStart + ioTicks].tasks[0].waitRemaining, 0);
      assert.ok(['ready', 'running'].includes(frames[blockStart + ioTicks].tasks[0].state));
      assert.ok(blocked.some(frame => frame.cpu.some(id => id === 'player' || id === 'indexer')),
        'other tasks make progress during I/O');
      for (const [index, frame] of frames.entries()) {
        assert.equal(frame.time, index);
        assert.equal(frame.cpu.length, cores);
        nonempty(frame.event);
        const dispatched = frame.cpu.filter(Boolean);
        assert.equal(new Set(dispatched).size, dispatched.length, 'single-thread tasks never occupy two cores');
        assert.deepEqual(frame.tasks.map(task => [task.id, task.label, task.totalCpu]), [
          ['editor', 'Editor', 4], ['player', 'Music player', 3], ['indexer', 'Indexer', 2]
        ]);
        assert.equal(frame.tasks.reduce((sum, task) => sum + task.cpuDone, 0),
          frames.slice(0, index).flatMap(previous => previous.cpu).filter(Boolean).length);
        for (const task of frame.tasks) {
          assert.ok(['ready', 'running', 'blocked', 'done'].includes(task.state));
          assert.equal(task.state === 'running', dispatched.includes(task.id));
          assert.ok(task.cpuDone >= 0 && task.cpuDone <= task.totalCpu);
          assert.equal(task.state === 'done', task.cpuDone === task.totalCpu);
          assert.equal(task.waitRemaining > 0, task.state === 'blocked');
          if (task.state === 'blocked') {
            assert.equal(task.id, 'editor');
            assert.equal(task.cpuDone, 2);
          }
          if (frame.cpu.includes(null)) assert.notEqual(task.state, 'ready', 'do not idle with eligible work');
          if (index < totalTicks) {
            const next = frames[index + 1].tasks.find(nextTask => nextTask.id === task.id);
            assert.equal(next.cpuDone, task.cpuDone + Number(dispatched.includes(task.id)));
          }
        }
      }
      assert.deepEqual(frames.at(-1).cpu, Array(cores).fill(null));
      assert.ok(frames.at(-1).tasks.every(task => task.state === 'done'));
    });
  }
}

test('exact per-process page tables and default translation', () => {
  assert.equal(PAGE_BYTES, 16);
  assert.deepEqual(pageTable('editor'), [
    { page: 0, frame: 3, kind: 'resident', writable: true },
    { page: 1, frame: 1, kind: 'resident', writable: false },
    { page: 2, frame: null, kind: 'zero', writable: true },
    { page: 3, frame: null, kind: 'disk', writable: true }
  ]);
  assert.deepEqual(pageTable('player'), [
    { page: 0, frame: 5, kind: 'resident', writable: true },
    { page: 1, frame: 1, kind: 'resident', writable: false },
    { page: 2, frame: null, kind: 'invalid', writable: false },
    { page: 3, frame: null, kind: 'disk', writable: true }
  ]);
  const { explanation, ...translation } = translate();
  nonempty(explanation);
  assert.deepEqual(translation, { page: 0, offset: 0, frame: 3, physical: 48, kind: 'resident', fault: false, diskRead: false });
});

test('all addresses and access modes: mappings, permissions, and fault distinctions', () => {
  for (const process of ['editor', 'player']) {
    const tableBefore = pageTable(process);
    for (let address = 0; address < 64; address++) {
      for (const access of ['read', 'write']) {
        const result = translate({ process, address, access });
        const page = Math.floor(address / 16), offset = address % 16;
        const expectedKind = page === 0 ? 'resident'
          : page === 1 ? (access === 'write' ? 'protection' : 'resident')
            : page === 2 ? (process === 'editor' ? 'zero' : 'invalid') : 'disk';
        const frame = expectedKind === 'resident' ? (page === 1 ? 1 : process === 'editor' ? 3 : 5) : null;
        const { explanation, ...actual } = result;
        assert.deepEqual(actual, { page, offset, frame, physical: frame === null ? null : frame * 16 + offset,
          kind: expectedKind, fault: expectedKind !== 'resident', diskRead: expectedKind === 'disk' });
        nonempty(explanation);
        assert.deepEqual(translate({ process, address, access }), result, 'inspection never allocates');
      }
    }
    assert.deepEqual(pageTable(process), tableBefore);
  }
  assert.equal(translate({ process: 'editor', address: 31 }).physical, 31);
  assert.equal(translate({ process: 'player', address: 31 }).physical, 31);
});

const expectedMemory = {
  2: { ram: ['A-', 'AB', 'CB', 'CA', 'DA', 'DB', 'EB', 'EA'], evicted: [null, null, 'A', 'B', 'C', 'A', 'D', 'B'], hits: [] },
  3: { ram: ['A--', 'AB-', 'ABC', 'ABC', 'ADC', 'ADB', 'EDB', 'EAB'], evicted: [null, null, null, null, 'B', 'C', 'A', 'D'], hits: [3] },
  4: { ram: ['A---', 'AB--', 'ABC-', 'ABC-', 'ABCD', 'ABCD', 'ABED', 'ABED'], evicted: [null, null, null, null, null, null, 'C', null], hits: [3, 5, 7] },
  5: { ram: ['A----', 'AB---', 'ABC--', 'ABC--', 'ABCD-', 'ABCD-', 'ABCDE', 'ABCDE'], evicted: Array(8).fill(null), hits: [3, 5, 7] }
};
for (const capacity of [2, 3, 4, 5]) {
  test('exact clean file-backed LRU trace, capacity=' + capacity, () => {
    const { frames, trace } = memoryRun(capacity);
    assert.deepEqual(trace, ['A', 'B', 'C', 'A', 'D', 'B', 'E', 'A']);
    assert.equal(frames.length, 9);
    const { event, ...initial } = frames[0];
    nonempty(event);
    assert.deepEqual(initial, { page: null, hit: false, evicted: null, ram: Array(capacity).fill(null), reads: 0, faults: 0, hits: 0 });
    let hits = 0;
    frames.slice(1).forEach((frame, index) => {
      const expected = expectedMemory[capacity];
      const hit = expected.hits.includes(index);
      hits += Number(hit);
      const { event, ...actual } = frame;
      assert.deepEqual(actual, { page: trace[index], hit, evicted: expected.evicted[index],
        ram: [...expected.ram[index]].map(page => page === '-' ? null : page),
        reads: index + 1 - hits, faults: index + 1 - hits, hits });
      nonempty(event);
    });
  });
}

test('save steps and complete application/power crash matrix', () => {
  assert.equal(OLD_TEXT, 'Buy milk');
  assert.equal(NEW_TEXT, 'Buy milk + bread');
  const frames = saveRun();
  const before = clone(frames);
  const old = OLD_TEXT, fresh = NEW_TEXT;
  assert.deepEqual(frames.map(({ id, app, cache, device, disk, written, latestDurable }) =>
    [id, app, cache, device, disk, written, latestDurable]), [
    ['opened', old, old, old, old, false, true],
    ['edited', fresh, old, old, old, false, false],
    ['buffered', fresh, fresh, old, old, true, false],
    ['device', fresh, fresh, fresh, old, true, false],
    ['synced', fresh, fresh, fresh, fresh, true, true],
    ['closed', null, fresh, fresh, fresh, true, true]
  ]);
  frames.forEach((frame, index) => {
    nonempty(frame.title);
    nonempty(frame.explanation);
    for (const failure of ['app', 'power']) {
      const { visible, durable, explanation } = crashSave(index, failure);
      assert.equal(durable, index < 4 ? old : fresh);
      assert.equal(visible, failure === 'app' ? (index < 2 ? old : fresh) : (index < 4 ? old : fresh));
      nonempty(explanation);
    }
    assert.deepEqual(crashSave(index), crashSave(index, 'power'));
  });
  assert.deepEqual(frames, before);
});

test('input validation rejects unsupported values, fractions, coercions, and nonfinite numbers', () => {
  const badNumbers = [null, '1', true, false, NaN, Infinity, -Infinity, {}, [], 1.5];
  for (const value of [...badNumbers, -1, 0, 3]) assert.throws(() => schedule({ cores: value }), RangeError);
  for (const value of [...badNumbers, -1, 0, 7]) assert.throws(() => schedule({ ioTicks: value }), RangeError);
  for (const value of [...badNumbers, -1, 0, 1, 6]) assert.throws(() => memoryRun(value), RangeError);
  for (const value of [...badNumbers, -1, 64]) assert.throws(() => translate({ address: value }), RangeError);
  for (const value of [...badNumbers, -1, 6, undefined]) assert.throws(() => crashSave(value), RangeError);
  for (const value of [null, 'other', '', 0, {}, []]) {
    assert.throws(() => pageTable(value), RangeError);
    assert.throws(() => translate({ process: value }), RangeError);
    assert.throws(() => translate({ access: value }), RangeError);
    assert.throws(() => crashSave(0, value), RangeError);
  }
  assert.throws(() => pageTable(), RangeError);
  for (const value of [null, [], 'editor', 0, true, () => {}]) {
    assert.throws(() => schedule(value), TypeError);
    assert.throws(() => translate(value), TypeError);
  }
  assert.deepEqual(schedule({ cores: undefined, ioTicks: undefined }), schedule());
  assert.deepEqual(translate({ process: undefined, address: undefined, access: undefined }), translate());
  assert.deepEqual(memoryRun(), memoryRun(3));
});

test('all returned snapshots and later runs are independent', () => {
  const run = schedule();
  const cleanSchedule = schedule();
  run.frames[0].cpu[0] = 'changed';
  run.frames[0].tasks[0].cpuDone = 99;
  run.frames[0].tasks[0].label = 'changed';
  assert.deepEqual(run.frames.slice(1), cleanSchedule.frames.slice(1));
  assert.deepEqual(schedule(), cleanSchedule);
  const memory = memoryRun();
  const cleanMemory = memoryRun();
  memory.frames[0].ram[0] = 'changed';
  memory.frames[1].ram[0] = 'changed';
  memory.frames[1].reads = 99;
  memory.trace[0] = 'changed';
  assert.deepEqual(memory.frames.slice(2), cleanMemory.frames.slice(2));
  assert.deepEqual(memoryRun(), cleanMemory);
  const table = pageTable('editor');
  table[1].frame = 99;
  table[2].kind = 'resident';
  assert.equal(pageTable('editor')[1].frame, 1);
  assert.equal(pageTable('player')[1].frame, 1);
  assert.equal(translate({ address: 32 }).kind, 'zero');
  const result = translate();
  result.physical = -1;
  assert.equal(translate().physical, 48);
  const saves = saveRun();
  const cleanSaves = saveRun();
  saves[0].cache = 'changed';
  saves[3].disk = 'changed';
  assert.deepEqual(saves.slice(4), cleanSaves.slice(4));
  assert.deepEqual(saveRun(), cleanSaves);
  assert.equal(crashSave(3).durable, OLD_TEXT);
  const crash = crashSave(3);
  crash.visible = 'changed';
  assert.equal(crashSave(3).visible, OLD_TEXT);
});
