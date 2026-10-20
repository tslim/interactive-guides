'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildJourney, buildComparison } = require('../assets/compute-model.js');

const ids = ['prepare', 'place', 'submit', 'compute', 'finish'];
const frames = journey => journey.stages.flatMap(stage => stage.frames);
const last = journey => frames(journey).at(-1);
const stage = (journey, id) => journey.stages.find(item => item.id === id);
const stateOf = ({ queue, computed, readable, results, active, elapsed, costs, data }) =>
  ({ queue, computed, readable, results, active, elapsed, costs, data });
const sum = costs => Object.values(costs).reduce((total, value) => total + value, 0);

function expectedOutput(journey) {
  return journey.inputs.map(row => journey.weights[0].map((_, column) => {
    const dot = row.reduce((total, x, k) => total + x * journey.weights[k][column], 0);
    return journey.settings.branching ? (dot >= 0 ? dot + 1 : dot - 1) : dot;
  }));
}

function assertFrames(journey) {
  assert.deepEqual(journey.stages.map(item => item.id), ids);
  assert.equal(stage(journey, 'finish').title, 'Finish & use result');
  assert.equal(stage(journey, 'wait'), undefined);
  assert.equal(stage(journey, 'use'), undefined);
  const all = frames(journey);
  assert.ok(all.every(frame => !/^(wait|use)-|consum/i.test(frame.id)));
  assert.equal(new Set(all.map(frame => frame.id)).size, all.length);
  assert.equal(journey.operations, journey.settings.batch * 16);
  assert.equal(journey.output.length, journey.settings.batch);
  assert.deepEqual(journey.output, expectedOutput(journey));
  let previous = null;
  let deltaTotal = 0;
  for (const item of journey.stages) {
    assert.ok(item.frames.length >= 2);
    assert.equal(item.frames[0].id, item.id + '-start');
    assert.equal(item.available, !journey.blocked || ['prepare', 'place', 'submit'].includes(item.id));
    if (previous) assert.deepEqual(stateOf(item.frames[0]), stateOf(previous));
    for (const frame of item.frames) {
      assert.ok(frame.title && frame.description);
      assert.ok(['idle', 'queued', 'running', 'complete', 'blocked'].includes(frame.queue));
      assert.equal(typeof frame.readable, 'boolean');
      assert.equal(frame.results.length, journey.settings.batch * 4);
      assert.equal(frame.computed, frame.results.filter(x => x !== null).length);
      assert.equal(frame.elapsed, sum(frame.costs));
      assert.ok(Number.isInteger(frame.elapsed) && frame.elapsed >= 0);
      assert.deepEqual(Object.keys(frame.costs), ['prepare', 'transfer', 'submit', 'compute', 'wait']);
      assert.deepEqual(Object.keys(frame.data), ['hostInputs', 'hostWeights', 'deviceInputs', 'deviceWeights', 'deviceOutputs', 'hostOutputs']);
      for (const value of Object.values(frame.data)) assert.equal(typeof value, 'boolean');
      for (const value of frame.results) assert.ok(value === null || Number.isFinite(value));
      for (const index of frame.active) {
        assert.ok(Number.isInteger(index) && index >= 0 && index < frame.results.length);
        assert.notEqual(frame.results[index], null);
      }
      assert.equal(new Set(frame.active).size, frame.active.length);
      for (const [key, value] of Object.entries(frame.costs)) {
        assert.ok(Number.isInteger(value) && value >= 0);
        if (previous) assert.ok(value >= previous.costs[key]);
      }
      deltaTotal += frame.elapsed - (previous ? previous.elapsed : 0);
      previous = frame;
    }
  }
  assert.equal(deltaTotal, last(journey).elapsed);
  if (!journey.blocked) {
    assert.equal(last(journey).elapsed, journey.totals[journey.settings.target]);
    assert.deepEqual(last(journey).results, journey.output.flat());
    assert.equal(last(journey).readable, true);
    assert.equal(last(journey).costs.wait, 1);
    assert.equal(last(journey).id, journey.settings.target === 'gpu' ? 'finish-copied' : 'finish-returned');
  }
}

test('CPU and GPU produce the same full calculation across all workload and access settings', () => {
  for (const batch of [1, 8]) for (const branching of [false, true]) {
    for (const resident of [false, true]) for (const environment of ['native', 'container', 'vm']) {
      for (const deviceAllowed of [false, true]) for (const assignment of ['none', 'passthrough', 'shared']) {
        const options = { batch, branching, resident, environment, deviceAllowed, assignment };
        const cpu = buildJourney({ ...options, target: 'cpu' });
        const gpu = buildJourney({ ...options, target: 'gpu' });
        assert.deepEqual(cpu.settings, { target: 'cpu', ...options });
        assert.deepEqual(gpu.settings, { target: 'gpu', ...options });
        assert.deepEqual(cpu.inputs, gpu.inputs);
        assert.deepEqual(cpu.weights, gpu.weights);
        assert.deepEqual(cpu.output, gpu.output);
        assert.deepEqual(cpu.totals, gpu.totals);
        assert.equal(cpu.blocked, false);
        assert.equal(cpu.reason, '');
        const blocked = (environment === 'container' && !deviceAllowed) ||
          (environment === 'vm' && assignment === 'none');
        assert.equal(gpu.blocked, blocked);
        assert.equal(Boolean(gpu.reason), blocked);
        assertFrames(cpu);
        assertFrames(gpu);
      }
    }
  }
});

test('fixed dot products include negative values; the conditional is not ReLU', () => {
  const plain = buildJourney({ batch: 8 });
  const branched = buildJourney({ batch: 8, branching: true });
  assert.deepEqual(plain.output[0], [-3, 0, 5, 5]);
  assert.deepEqual(branched.output[0], [-4, 1, 6, 6]);
  assert.deepEqual(plain.output[7], [0, 0, 0, 0]);
  assert.deepEqual(branched.output[7], [1, 1, 1, 1]);
  assert.equal(plain.inputs.length, 8);
  assert.ok(plain.inputs.every(row => row.length === 4));
  assert.ok(plain.weights.every(row => row.length === 4));
  assert.ok(plain.weights.flat().some(value => value < 0));
  assert.deepEqual(buildJourney().inputs, [plain.inputs[0]]);
});

test('teaching costs have the intended crossover and residency savings', () => {
  const small = buildJourney();
  const large = buildJourney({ batch: 8 });
  assert.deepEqual(small.totals, { cpu: 12, gpu: 19 });
  assert.deepEqual(large.totals, { cpu: 68, gpu: 37 });
  assert.ok(small.totals.gpu > small.totals.cpu);
  assert.ok(large.totals.gpu < large.totals.cpu);
  for (const batch of [1, 8]) for (const branching of [false, true]) {
    const cold = buildJourney({ target: 'gpu', batch, branching });
    const warm = buildJourney({ target: 'gpu', batch, branching, resident: true });
    assert.equal(cold.totals.gpu - warm.totals.gpu, 8);
    assert.equal(last(cold).costs.transfer - last(warm).costs.transfer, 8);
    assert.equal(cold.totals.cpu, warm.totals.cpu);
    assert.equal(last(cold).costs.transfer, 8 + 2 * Math.ceil(batch * 4 / 8));
    assert.equal(last(warm).costs.transfer, 2 * Math.ceil(batch * 4 / 8));
    assert.equal(frames(warm)[0].data.deviceWeights, true);
    assert.equal(frames(cold)[0].data.deviceWeights, false);
  }
  for (const target of ['cpu', 'gpu']) {
    for (const environment of ['native', 'container', 'vm']) {
      const journey = buildJourney({ target, batch: 8, environment, deviceAllowed: true, assignment: 'shared' });
      assert.deepEqual(journey.totals, large.totals);
      assert.equal(last(journey).elapsed, large.totals[target]);
    }
  }
});

test('waves commit only their cells and branch penalties use groups of four', () => {
  for (const target of ['cpu', 'gpu']) for (const batch of [1, 8]) {
    for (const branching of [false, true]) {
      const journey = buildJourney({ target, batch, branching });
      const width = target === 'cpu' ? 2 : 8;
      const events = stage(journey, 'compute').frames.slice(1);
      const dots = buildJourney({ batch }).output.flat();
      assert.equal(events.length, Math.ceil(batch * 4 / width));
      events.forEach((frame, wave) => {
        const start = wave * width;
        const end = Math.min(start + width, dots.length);
        assert.deepEqual(frame.active, Array.from({ length: end - start }, (_, i) => start + i));
        assert.equal(frame.computed, end);
        assert.ok(frame.results.slice(end).every(value => value === null));
        assert.equal(frame.queue, wave === events.length - 1 ? 'complete' : 'running');
        const prior = stage(journey, 'compute').frames[wave];
        let extra = branching ? 1 : 0;
        if (target === 'gpu' && branching) {
          for (let group = start; group < end; group += 4) {
            const chunk = dots.slice(group, Math.min(group + 4, end));
            if (chunk.some(x => x >= 0) && chunk.some(x => x < 0)) extra = 2;
          }
        }
        assert.equal(frame.costs.compute - prior.costs.compute, 4 + extra);
      });
    }
  }
});

test('results are unreadable until CPU return or GPU copy, even after synchronization', () => {
  for (const target of ['cpu', 'gpu']) {
    const journey = buildJourney({ target, batch: 8 });
    const initial = frames(journey)[0];
    assert.equal(initial.computed, 0);
    assert.ok(initial.results.every(x => x === null));
    assert.ok(Object.values(initial.data).every(x => x === false));
    assert.equal(initial.elapsed, 0);
    for (const id of ['prepare', 'place', 'submit', 'compute']) {
      assert.ok(stage(journey, id).frames.every(frame => !frame.readable));
    }
    const computed = stage(journey, 'compute').frames.at(-1);
    assert.equal(computed.queue, 'complete');
    assert.equal(computed.readable, false);
    const finish = stage(journey, 'finish').frames;
    assert.equal(finish[0].readable, false);
    assert.deepEqual(finish.map(frame => frame.id), target === 'gpu'
      ? ['finish-start', 'finish-synchronized', 'finish-copied']
      : ['finish-start', 'finish-returned']);
    if (target === 'gpu') {
      assert.equal(finish[1].queue, 'complete');
      assert.equal(finish[1].readable, false);
      assert.equal(finish[1].data.deviceOutputs, true);
      assert.equal(finish[1].data.hostOutputs, false);
      assert.equal(finish[1].costs.wait, 1);
      assert.ok(stage(journey, 'compute').frames.every(frame => !frame.data.hostOutputs));
    } else {
      assert.equal(computed.data.hostOutputs, true);
      assert.equal(computed.data.deviceOutputs, false);
    }
    assert.equal(finish.at(-1), last(journey));
    assert.equal(finish.at(-1).readable, true);
    assert.equal(finish.at(-1).data.hostOutputs, true);
    assert.deepEqual(finish.at(-1).results, journey.output.flat());
    assert.ok(frames(journey).slice(0, -1).every(frame => !frame.readable));
  }
});

test('blocked GPU journeys never transfer, compute, synchronize, or expose device data', () => {
  for (const options of [
    { environment: 'container', deviceAllowed: false, assignment: 'passthrough' },
    { environment: 'vm', deviceAllowed: true, assignment: 'none' }
  ]) for (const resident of [false, true]) {
    const journey = buildJourney({ ...options, target: 'gpu', resident, batch: 8 });
    assert.equal(journey.blocked, true);
    assert.ok(journey.reason.length > 0);
    assertFrames(journey);
    assert.deepEqual(journey.stages.map(item => item.available), [true, true, true, false, false]);
    for (const id of ['compute', 'finish']) {
      const unavailable = stage(journey, id).frames;
      assert.deepEqual(unavailable.map(frame => frame.id), [id + '-start', id + '-blocked']);
      assert.deepEqual(stateOf(unavailable[0]), stateOf(unavailable[1]));
      assert.equal(unavailable[1].queue, 'blocked');
    }
    for (const frame of frames(journey)) {
      assert.equal(frame.computed, 0);
      assert.equal(frame.readable, false);
      assert.ok(frame.results.every(value => value === null));
      assert.deepEqual(frame.active, []);
      assert.equal(frame.costs.transfer, 0);
      assert.equal(frame.costs.compute, 0);
      assert.equal(frame.costs.submit, 0);
      assert.equal(frame.costs.wait, 0);
      assert.equal(frame.data.deviceInputs, false);
      assert.equal(frame.data.deviceWeights, false);
      assert.equal(frame.data.deviceOutputs, false);
      assert.equal(frame.data.hostOutputs, false);
    }
    assert.equal(stage(journey, 'prepare').frames.at(-1).data.hostInputs, true);
    assert.equal(stage(journey, 'prepare').frames.at(-1).data.hostWeights, true);
    assert.equal(stage(journey, 'submit').frames.at(-1).queue, 'blocked');
    assert.equal(last(journey).elapsed, 2);
    assert.equal(journey.totals.gpu, resident ? 29 : 37);
    assert.equal(buildJourney({ ...options, target: 'cpu' }).blocked, false);
  }
});

test('frames and builds are independent deep snapshots', () => {
  const journey = buildJourney({ target: 'gpu', batch: 8, resident: true });
  const all = frames(journey);
  for (const key of ['results', 'active', 'costs', 'data']) {
    assert.equal(new Set(all.map(frame => frame[key])).size, all.length);
  }
  assert.equal(new Set(all).size, all.length);
  const before = JSON.stringify(journey);
  assert.equal(JSON.stringify(buildJourney({ target: 'gpu', batch: 8, resident: true })), before);
  const nextFrame = JSON.stringify(all[1]);
  all[0].results[0] = 999;
  all[0].active.push(999);
  all[0].costs.compute = 999;
  all[0].data.hostInputs = true;
  assert.equal(JSON.stringify(all[1]), nextFrame);
  const finalResult = last(journey).results[0];
  journey.output[0][0] = 999;
  assert.equal(last(journey).results[0], finalResult);
  journey.inputs[0][0] = 999;
  journey.weights[0][0] = 999;
  assert.equal(JSON.stringify(buildJourney({ target: 'gpu', batch: 8, resident: true })), before);
});

test('invalid options normalize safely without mutating the supplied object', () => {
  const defaults = {
    target: 'cpu', batch: 1, resident: false, branching: false,
    environment: 'native', deviceAllowed: false, assignment: 'none'
  };
  for (const options of [undefined, null, false, 42, 'gpu', [], {
    target: 'GPU', batch: '8', resident: 'true', branching: 1,
    environment: 'cloud', deviceAllowed: 'true', assignment: 'automatic'
  }, {
    target: null, batch: NaN, resident: {}, branching: [],
    environment: Infinity, deviceAllowed: 1, assignment: null
  }]) {
    const journey = buildJourney(options);
    assert.deepEqual(journey.settings, defaults);
    assertFrames(journey);
  }
  const options = Object.freeze({ target: 'gpu', batch: 8, resident: true });
  assert.deepEqual(buildJourney(options).settings, { ...defaults, ...options });
  assert.equal(buildJourney({ target: 'gpu', environment: 'container', deviceAllowed: 'true' }).blocked, true);
});

test('browser global and CommonJS expose buildJourney without DOM, timers, or hardware', () => {
  const source = fs.readFileSync(path.join(__dirname, '../assets/compute-model.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  assert.equal(typeof context.ComputeModel.buildJourney, 'function');
  assert.deepEqual(JSON.parse(JSON.stringify(context.ComputeModel.buildJourney({ target: 'gpu' }))), buildJourney({ target: 'gpu' }));
  assert.equal(context.document, undefined);
  assert.equal(context.setTimeout, undefined);
  assert.equal(context.navigator, undefined);
});

const profiles = [];
for (const batch of [1, 8]) for (const resident of [false, true]) {
  for (const branching of [false, true]) profiles.push({ batch, resident, branching });
}

test('comparison exposes complete native alternatives for all eight workload profiles', () => {
  assert.equal(profiles.length, 8);
  for (const options of profiles) {
    const comparison = buildComparison(options);
    assert.deepEqual(Object.keys(comparison), [
      'settings', 'inputs', 'weights', 'output', 'operations', 'totals', 'paths', 'stages'
    ]);
    assert.deepEqual(comparison.settings, options);
    const expectedTotals = {
      '1,false,false': { cpu: 12, gpu: 19 },
      '1,false,true': { cpu: 14, gpu: 21 },
      '1,true,false': { cpu: 12, gpu: 11 },
      '1,true,true': { cpu: 14, gpu: 13 },
      '8,false,false': { cpu: 68, gpu: 37 },
      '8,false,true': { cpu: 84, gpu: 45 },
      '8,true,false': { cpu: 68, gpu: 29 },
      '8,true,true': { cpu: 84, gpu: 37 }
    }[[options.batch, options.resident, options.branching].join(',')];
    assert.deepEqual(comparison.totals, expectedTotals);
    assert.equal(comparison.operations, options.batch * 16);
    assert.deepEqual(comparison.output, expectedOutput(comparison));
    assert.deepEqual(Object.keys(comparison.paths), ['cpu', 'gpu']);
    for (const target of ['cpu', 'gpu']) {
      const journey = comparison.paths[target];
      assert.deepEqual(journey, buildJourney({ ...options, target }));
      assertFrames(journey);
      assert.equal(journey.blocked, false);
      assert.equal(journey.reason, '');
      assert.equal(journey.settings.environment, 'native');
      for (const key of ['inputs', 'weights', 'output', 'totals']) {
        assert.deepEqual(comparison[key], journey[key]);
        assert.notStrictEqual(comparison[key], journey[key]);
      }
      assert.equal(last(journey).readable, true);
      assert.deepEqual(last(journey).results, comparison.output.flat());
      const transfer = target === 'gpu' ? (options.resident ? 0 : 8) + 2 * Math.ceil(options.batch * 4 / 8) : 0;
      const submit = target === 'gpu' ? 2 : 1;
      assert.deepEqual(last(journey).costs, {
        prepare: 2, transfer, submit, compute: expectedTotals[target] - 2 - transfer - submit - 1, wait: 1
      });
    }
    assert.deepEqual(comparison.paths.cpu.output, comparison.paths.gpu.output);
  }
});

test('comparison beats use exact stage-local indices and hold endpoints without extra cost', () => {
  for (const options of profiles) {
    const comparison = buildComparison(options);
    assert.deepEqual(comparison.stages.map(item => item.id), ids);
    assert.equal(stage(comparison, 'finish').title, 'Finish & use result');
    assert.equal(stage(comparison, 'wait'), undefined);
    assert.equal(stage(comparison, 'use'), undefined);
    const all = frames(comparison);
    assert.ok(all.every(beat => [beat.id, beat.cpu.id, beat.gpu.id].every(id => !/^(wait|use)-|consum/i.test(id))));
    assert.equal(new Set(all.map(frame => frame.id)).size, all.length);
    for (const item of comparison.stages) {
      const cpuStage = stage(comparison.paths.cpu, item.id);
      const gpuStage = stage(comparison.paths.gpu, item.id);
      assert.deepEqual(Object.keys(item), ['id', 'title', 'available', 'frames']);
      assert.equal(item.title, cpuStage.title);
      assert.equal(item.title, gpuStage.title);
      assert.equal(item.available, true);
      assert.equal(item.frames.length, Math.max(cpuStage.frames.length, gpuStage.frames.length));
      item.frames.forEach((beat, i) => {
        assert.deepEqual(Object.keys(beat), ['id', 'cpu', 'gpu', 'advanced']);
        assert.equal(beat.id, item.id + '-beat-' + (i + 1));
        for (const target of ['cpu', 'gpu']) {
          const originals = stage(comparison.paths[target], item.id).frames;
          const expected = originals[Math.min(i, originals.length - 1)];
          assert.deepEqual(beat[target], expected);
          assert.notStrictEqual(beat[target], expected);
          assert.equal(beat.advanced[target], i < originals.length);
          if (!beat.advanced[target]) {
            assert.deepEqual(beat[target], item.frames[i - 1][target]);
            assert.equal(beat[target].elapsed, item.frames[i - 1][target].elapsed);
            assert.deepEqual(beat[target].costs, item.frames[i - 1][target].costs);
          }
        }
      });
    }
  }
});

test('GPU compute holds its completed waves while CPU steps continue, not at equal hardware times', () => {
  for (const options of profiles) {
    const comparison = buildComparison(options);
    const beats = stage(comparison, 'compute').frames;
    const gpuCount = stage(comparison.paths.gpu, 'compute').frames.length;
    assert.ok(gpuCount < beats.length);
    assert.notEqual(beats[1].cpu.elapsed, beats[1].gpu.elapsed);
    const gpuEnd = beats[gpuCount - 1].gpu;
    assert.equal(gpuEnd.queue, 'complete');
    assert.equal(gpuEnd.computed, options.batch * 4);
    assert.equal(gpuEnd.readable, false);
    for (let i = gpuCount; i < beats.length; i++) {
      assert.deepEqual(beats[i].advanced, { cpu: true, gpu: false });
      assert.deepEqual(beats[i].gpu, gpuEnd);
      assert.equal(beats[i].cpu.computed - beats[i - 1].cpu.computed, 2);
      assert.ok(beats[i].cpu.costs.compute > beats[i - 1].cpu.costs.compute);
    }
  }
});

test('Finish returns CPU, then copies GPU output while CPU holds its usable result', () => {
  for (const options of profiles) {
    const comparison = buildComparison(options);
    const finish = stage(comparison, 'finish');
    assert.equal(finish, comparison.stages.at(-1));
    assert.equal(finish.frames.length, 3);
    const [start, synchronized, copied] = finish.frames;
    assert.deepEqual(finish.frames.map(beat => beat.id), ['finish-beat-1', 'finish-beat-2', 'finish-beat-3']);
    assert.deepEqual(start.advanced, { cpu: true, gpu: true });
    assert.equal(start.cpu.readable, false);
    assert.equal(start.gpu.readable, false);
    assert.deepEqual(synchronized.advanced, { cpu: true, gpu: true });
    assert.equal(synchronized.cpu.id, 'finish-returned');
    assert.equal(synchronized.cpu.readable, true);
    assert.equal(synchronized.cpu.data.hostOutputs, true);
    assert.equal(synchronized.gpu.id, 'finish-synchronized');
    assert.equal(synchronized.gpu.queue, 'complete');
    assert.equal(synchronized.gpu.readable, false);
    assert.equal(synchronized.gpu.data.deviceOutputs, true);
    assert.equal(synchronized.gpu.data.hostOutputs, false);
    assert.deepEqual(copied.advanced, { cpu: false, gpu: true });
    assert.deepEqual(copied.cpu, synchronized.cpu);
    assert.equal(copied.gpu.id, 'finish-copied');
    assert.equal(copied.gpu.readable, true);
    assert.equal(copied.gpu.data.hostOutputs, true);
    assert.equal(copied.gpu.costs.transfer - synchronized.gpu.costs.transfer, Math.ceil(options.batch * 4 / 8));
    assert.deepEqual(copied.cpu.results, copied.gpu.results);
    assert.deepEqual(copied.cpu.results, comparison.output.flat());
    for (const target of ['cpu', 'gpu']) {
      assert.deepEqual(copied[target], last(comparison.paths[target]));
      assert.equal(copied[target].elapsed, comparison.totals[target]);
      assert.equal(copied[target].costs.wait, 1);
    }
  }
});

test('comparison ignores target and every access gate, including denied containers and unassigned VMs', () => {
  for (const options of profiles) for (const target of ['cpu', 'gpu', 'invalid']) {
    for (const environment of ['native', 'container', 'vm']) {
      for (const deviceAllowed of [false, true]) for (const assignment of ['none', 'passthrough', 'shared']) {
        const supplied = Object.freeze({ ...options, target, environment, deviceAllowed, assignment });
        const comparison = buildComparison(supplied);
        assert.deepEqual(comparison, buildComparison(options));
        for (const journey of Object.values(comparison.paths)) {
          assert.equal(journey.blocked, false);
          assert.ok(journey.stages.every(item => item.available));
          assert.equal(last(journey).readable, true);
        }
      }
    }
  }
});

test('every comparison object and nested snapshot is independent, including held frames and builds', () => {
  for (const options of profiles) {
    const comparison = buildComparison(options);
    const seen = new Set();
    function assertNoAliases(value) {
      if (value === null || typeof value !== 'object') return;
      assert.equal(seen.has(value), false, 'no object or array may be shared');
      seen.add(value);
      Object.values(value).forEach(assertNoAliases);
    }
    assertNoAliases(comparison);
    assertNoAliases(buildComparison(options));
    const before = JSON.stringify(comparison);
    const pathsBefore = JSON.stringify(comparison.paths);
    for (const [id, target] of [['compute', 'gpu'], ['finish', 'cpu']]) {
      const held = stage(comparison, id).frames.at(-1);
      assert.equal(held.advanced[target], false);
      const otherBeats = frames(comparison).filter(beat => beat !== held);
      const othersBefore = JSON.stringify(otherBeats);
      held[target].results[0] = 999;
      held[target].active.push(999);
      held[target].costs.compute = 999;
      held[target].data.hostOutputs = !held[target].data.hostOutputs;
      held.advanced[target] = true;
      assert.equal(JSON.stringify(otherBeats), othersBefore);
      assert.equal(JSON.stringify(comparison.paths), pathsBefore);
    }
    comparison.inputs[0][0] = 999;
    comparison.weights[0][0] = 999;
    comparison.output[0][0] = 999;
    comparison.totals.cpu = 999;
    assert.equal(JSON.stringify(comparison.paths), pathsBefore);
    assert.equal(JSON.stringify(buildComparison(options)), before);
  }
});

test('comparison reuses strict workload normalization without exposing execution controls', () => {
  const defaults = { batch: 1, resident: false, branching: false };
  for (const options of [undefined, null, false, 42, 'gpu', [], {
    target: 'GPU', batch: '8', resident: 'true', branching: 1,
    environment: 'cloud', deviceAllowed: 'true', assignment: 'automatic'
  }, {
    batch: NaN, resident: {}, branching: [], environment: Infinity
  }]) {
    assert.deepEqual(buildComparison(options).settings, defaults);
    assert.deepEqual(buildComparison(options), buildComparison());
  }
  for (const options of profiles) {
    const supplied = Object.freeze({ ...options, target: 'gpu', environment: 'vm', assignment: 'none' });
    const normalized = buildJourney(supplied).settings;
    assert.deepEqual(buildComparison(supplied).settings, {
      batch: normalized.batch, resident: normalized.resident, branching: normalized.branching
    });
    assert.deepEqual(supplied, { ...options, target: 'gpu', environment: 'vm', assignment: 'none' });
  }
});

test('browser global exports the same comparison API as CommonJS without browser services', () => {
  const source = fs.readFileSync(path.join(__dirname, '../assets/compute-model.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  assert.equal(typeof context.ComputeModel.buildComparison, 'function');
  for (const options of profiles) {
    const supplied = { ...options, target: 'gpu', environment: 'vm', assignment: 'none' };
    assert.deepEqual(
      JSON.parse(JSON.stringify(context.ComputeModel.buildComparison(supplied))),
      buildComparison(supplied)
    );
  }
  assert.equal(context.document, undefined);
  assert.equal(context.setTimeout, undefined);
  assert.equal(context.navigator, undefined);
});
