/* A deterministic teaching model, not a benchmark or a hardware API.
 * CPUs also vectorize. Real compilers may predicate or remove branches.
 * Lanes, waves, and costs below are chosen teaching units, not cycles,
 * measured timings, speed estimates, or virtualization overheads.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ComputeModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Row-major W[k][n]; each output is sum_k inputs[row][k] * W[k][n].
  const WEIGHTS = [
    [1, -2, 0, 3],
    [-1, 1, 2, 0],
    [2, 0, -1, -2],
    [0, 3, 1, -1]
  ];
  const INPUTS = [
    [1, 2, -1, 0],
    [-2, 1, 0, 3],
    [0, -1, 2, 1],
    [3, 0, 1, -2],
    [-1, -2, 1, 2],
    [2, 1, -3, -1],
    [1, -1, 1, -1],
    [0, 0, 0, 0]
  ];
  const DEFINITIONS = [
    ['prepare', 'Prepare inputs and weights'],
    ['place', 'Place data'],
    ['submit', 'Submit work'],
    ['compute', 'Compute output waves'],
    ['finish', 'Finish & use result']
  ];

  function normalize(options) {
    const o = options && typeof options === 'object' ? options : {};
    return {
      target: o.target === 'gpu' ? 'gpu' : 'cpu',
      batch: o.batch === 8 ? 8 : 1,
      resident: o.resident === true,
      branching: o.branching === true,
      environment: ['native', 'container', 'vm'].includes(o.environment) ? o.environment : 'native',
      deviceAllowed: o.deviceAllowed === true,
      assignment: ['none', 'passthrough', 'shared'].includes(o.assignment) ? o.assignment : 'none'
    };
  }

  function accessReason(s) {
    if (s.target === 'cpu' || s.environment === 'native') return '';
    if (s.environment === 'container' && !s.deviceAllowed) {
      return 'The container has not been allowed access to the GPU device.';
    }
    if (s.environment === 'vm' && s.assignment === 'none') {
      return 'The VM needs a passthrough or shared GPU assignment.';
    }
    return '';
  }

  function wavesFor(target, dots, branching) {
    const width = target === 'cpu' ? 2 : 8;
    const waves = [];
    for (let start = 0; start < dots.length; start += width) {
      const end = Math.min(start + width, dots.length);
      let penalty = 0;
      if (branching) {
        penalty = 1;
        if (target === 'gpu') {
          // Groups of four execute together in this illustration. A wave
          // pays the maximum group penalty, not the sum of parallel groups.
          for (let group = start; group < end; group += 4) {
            const signs = dots.slice(group, Math.min(group + 4, end)).map(x => x >= 0);
            if (signs.some(Boolean) && signs.some(sign => !sign)) penalty = 2;
          }
        }
      }
      waves.push({ start, end, cost: 4 + penalty, penalty });
    }
    return waves;
  }

  function idealTotal(target, s, dots) {
    const compute = wavesFor(target, dots, s.branching).reduce((sum, wave) => sum + wave.cost, 0);
    if (target === 'cpu') return 2 + 1 + compute + 1;
    const inputCopy = Math.ceil(s.batch * 4 / 8);
    const outputCopy = inputCopy;
    return 2 + (s.resident ? 0 : 8) + inputCopy + 2 + compute + 1 + outputCopy;
  }

  function buildJourney(options) {
    const settings = normalize(options);
    const gpu = settings.target === 'gpu';
    const reason = accessReason(settings);
    const blocked = reason !== '';
    const inputs = INPUTS.slice(0, settings.batch).map(row => row.slice());
    const weights = WEIGHTS.map(row => row.slice());
    const dots = inputs.flatMap(row => weights[0].map((_, column) =>
      row.reduce((sum, value, k) => sum + value * weights[k][column], 0)));
    // This explicit toy conditional is NOT ReLU (negative values remain negative).
    const values = dots.map(dot => settings.branching ? (dot >= 0 ? dot + 1 : dot - 1) : dot);
    const output = inputs.map((_, row) => values.slice(row * 4, row * 4 + 4));
    const stages = DEFINITIONS.map(([id, title], index) => ({
      id, title, available: !blocked || index < 3, frames: []
    }));
    const state = {
      queue: 'idle', computed: 0, readable: false,
      results: Array(values.length).fill(null), active: [],
      costs: { prepare: 0, transfer: 0, submit: 0, compute: 0, wait: 0 },
      data: {
        hostInputs: false, hostWeights: false,
        deviceInputs: false, deviceWeights: gpu && !blocked && settings.resident,
        deviceOutputs: false, hostOutputs: false
      }
    };

    // Every frame owns all of its nested data. No frame refers to mutable state,
    // another frame, or the full mathematical answer exposed above.
    function frame(stage, event, title, description) {
      stage.frames.push({
        id: stage.id + '-' + event, title, description,
        queue: state.queue, computed: state.computed, readable: state.readable,
        results: state.results.slice(), active: state.active.slice(),
        elapsed: Object.values(state.costs).reduce((sum, cost) => sum + cost, 0),
        costs: { ...state.costs }, data: { ...state.data }
      });
    }
    function start(stage) {
      frame(stage, 'start', 'Before: ' + stage.title, 'State carried from the preceding stage, before this stage does any work.');
    }

    const [prepare, place, submit, compute, finish] = stages;
    start(prepare);
    state.costs.prepare += 2;
    state.data.hostInputs = true;
    state.data.hostWeights = true;
    frame(prepare, 'ready', 'Host data prepared', 'Prepare the fixed input rows and weights in host memory (2 teaching units).');

    start(place);
    if (blocked) {
      frame(place, 'planned', 'Device placement planned, not performed', reason + ' No data is copied to an unavailable device.');
    } else if (gpu) {
      if (!settings.resident) {
        state.costs.transfer += 8;
        state.data.deviceWeights = true;
        frame(place, 'weights', 'Copy weights to device', 'Copy the 4 × 4 weights (8 teaching units).');
      }
      state.costs.transfer += Math.ceil(settings.batch * 4 / 8);
      state.data.deviceInputs = true;
      frame(place, 'inputs', 'Copy inputs to device', settings.resident
        ? 'Weights were already resident; only inputs need copying.'
        : 'Inputs and weights are now on the discrete GPU.');
    } else {
      frame(place, 'ready', 'Keep data in host memory', 'The CPU uses the prepared host data; no device transfer is needed.');
    }

    start(submit);
    if (blocked) {
      state.queue = 'blocked';
      frame(submit, 'blocked', 'GPU submission blocked', reason);
      for (const stage of [compute, finish]) {
        start(stage);
        frame(stage, 'blocked', 'Unavailable: ' + stage.title, 'No device work, synchronization, transfer, or readable result is produced.');
      }
    } else {
      state.costs.submit += gpu ? 2 : 1;
      state.queue = 'queued';
      frame(submit, 'queued', 'Work submitted', 'Submission is not completion; the caller cannot consume results yet.');

      start(compute);
      const waves = wavesFor(settings.target, dots, settings.branching);
      waves.forEach((wave, index) => {
        state.active = [];
        for (let cell = wave.start; cell < wave.end; cell++) {
          state.results[cell] = values[cell];
          state.active.push(cell);
        }
        state.computed += wave.end - wave.start;
        state.costs.compute += wave.cost;
        state.queue = index === waves.length - 1 ? 'complete' : 'running';
        if (gpu) state.data.deviceOutputs = true;
        else state.data.hostOutputs = true;
        frame(compute, 'wave-' + (index + 1), 'Finish output wave ' + (index + 1),
          (gpu ? 'Up to eight illustrative lanes in groups of four. ' : 'Two illustrative output lanes. ') +
          'Dot products cost 4 teaching units' + (settings.branching ? '; the toy conditional adds ' + wave.penalty + '.' : '.') +
          (gpu ? ' Results remain device-only.' : ' Partial host outputs do not mean the call has returned.'));
      });

      start(finish);
      state.costs.wait += 1;
      if (gpu) {
        frame(finish, 'synchronized', 'Device synchronized; not yet readable', 'Device work is complete, but results are still device-only. Synchronization costs 1 teaching unit.');
        state.costs.transfer += Math.ceil(settings.batch * 4 / 8);
        state.data.hostOutputs = true;
        state.readable = true;
        frame(finish, 'copied', 'Copy outputs to host; result ready to use', 'The output copy makes every cell of the completed matrix available to the caller.');
      } else {
        state.readable = true;
        frame(finish, 'returned', 'CPU call returned; result ready to use', 'Returning costs 1 teaching unit; every cell of the completed matrix is now available to the caller.');
      }
    }

    return {
      settings, inputs, weights, output,
      operations: settings.batch * 16,
      blocked, reason, stages,
      // Completed idealized comparisons with accessible hardware, even when
      // this particular journey is blocked. No recursive journey construction.
      totals: {
        cpu: idealTotal('cpu', settings, dots),
        gpu: idealTotal('gpu', settings, dots)
      }
    };
  }

  function buildComparison(options) {
    const { batch, resident, branching } = normalize(options);
    const settings = { batch, resident, branching };
    // Only workload flags reach these native, accessible alternatives.
    const cpu = buildJourney({ ...settings, target: 'cpu' });
    const gpu = buildJourney({ ...settings, target: 'gpu' });
    const copy = value => JSON.parse(JSON.stringify(value));

    // Beats align narrative step indices, NOT elapsed hardware time or
    // cross-path synchronization. Each event advances one unfinished step
    // per alternative; a shorter path holds its endpoint without more work
    // or cost. Copy even held frames so every snapshot remains independent.
    const stages = cpu.stages.map((cpuStage, index) => {
      const gpuStage = gpu.stages[index];
      const cpuCount = cpuStage.frames.length;
      const gpuCount = gpuStage.frames.length;
      return {
        id: cpuStage.id, title: cpuStage.title, available: true,
        frames: Array.from({ length: Math.max(cpuCount, gpuCount) }, (_, i) => ({
          id: cpuStage.id + '-beat-' + (i + 1),
          cpu: copy(cpuStage.frames[Math.min(i, cpuCount - 1)]),
          gpu: copy(gpuStage.frames[Math.min(i, gpuCount - 1)]),
          advanced: { cpu: i < cpuCount, gpu: i < gpuCount }
        }))
      };
    });

    return {
      settings,
      inputs: copy(cpu.inputs), weights: copy(cpu.weights), output: copy(cpu.output),
      operations: cpu.operations, totals: copy(cpu.totals),
      paths: { cpu, gpu }, stages
    };
  }

  return { buildJourney, buildComparison };
});
