/* Compare two alternative executions, not a concurrent hardware benchmark. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!window.ComputeModel?.buildComparison) { $('compute-error').hidden = false; return; }
  const model = window.ComputeModel, paths = ['cpu', 'gpu'];
  let journey = model.buildComparison(), settings = { ...journey.settings };
  let stage = 0, positions = Array(journey.stages.length).fill(0), selectedCell = 0, timer = null;
  const panels = [...document.querySelectorAll('[data-compute-stage]')];
  const stageButtons = [...document.querySelectorAll('[data-stage]')];
  const stageNames = ['Prepare', 'Place data', 'Submit', 'Compute', 'Finish & use'];
  const introductions = [
    ['Prepare the same workload.', 'The CPU prepares inputs for either alternative. The matrices are configured-value previews until preparation finishes.'],
    ['Compare the memory placement.', 'CPU work uses host data; the discrete-GPU path copies inputs and any missing weights.'],
    ['Submission is not completion.', 'Each alternative starts its work. Neither has returned a finished result to the caller.'],
    ['Advance their illustrative waves.', 'Each event advances one unfinished wave on each path. Different lane counts expose different amounts of parallel work.'],
    ['Finish the handoff, then use the result.', 'The CPU call returns; the GPU synchronizes and copies its output. Once both callers can read, the application outcome and cost summary appear.']
  ];
  function createPaths() {
    $('compute-paths').innerHTML = paths.map(target => `<article class="path" data-path="${target}" id="compute-${target}-path" aria-labelledby="compute-${target}-title">
      <div class="path-header"><svg class="icon" aria-hidden="true"><use href="#compute-icon-${target}"/></svg><h3 id="compute-${target}-title">${target.toUpperCase()}</h3><span class="held" id="compute-${target}-held" hidden title="This path has no additional step at this checkpoint">Held</span></div>
      <p class="path-step" id="compute-${target}-step"></p><div class="path-body">
      <section class="memory" id="compute-${target}-memory" aria-label="${target === 'cpu' ? 'System memory' : 'GPU path memory'}" hidden><h4>${target === 'cpu' ? 'System RAM' : 'GPU + host RAM'}</h4>
      <div class="memory-item"><span>Inputs</span><strong id="compute-${target}-inputs"></strong></div><div class="memory-item"><span>Weights</span><strong id="compute-${target}-weights"></strong></div>
      ${target === 'gpu' ? '<div class="memory-item"><span>On GPU</span><strong id="compute-gpu-device-output"></strong></div>' : ''}
      <div class="memory-item"><span>${target === 'gpu' ? 'On host' : 'Output'}</span><strong id="compute-${target}-host-output"></strong></div>${target === 'cpu' ? '<div class="memory-item"><span>Caller</span><strong id="compute-cpu-caller-output"></strong></div>' : ''}</section>
      <section class="path-lanes" id="compute-${target}-lanes" aria-label="${target.toUpperCase()} illustrative lanes" hidden><span class="label">${target === 'cpu' ? '2 lanes' : '8 lanes'}</span><div class="lane-groups" id="compute-${target}-lane-groups"></div></section>
      <section id="compute-${target}-output" aria-label="${target.toUpperCase()} calculation buffer"><div class="output-heading"><h4>Output</h4><span class="badge" id="compute-${target}-output-state">Not yet readable</span></div><div class="matrix" id="compute-${target}-output-grid" role="group" aria-label="${target.toUpperCase()} output cells; choose one to inspect its equation"></div></section>
      </div></article>`).join('');
  }
  function beat() { return journey.stages[stage].frames[positions[stage]]; }
  function neighbor(direction) {
    const index = positions[stage] + direction;
    if (index >= 0 && index < journey.stages[stage].frames.length) return [stage, index];
    const nextStage = stage + direction;
    return nextStage < 0 || nextStage >= journey.stages.length ? null : [nextStage, direction > 0 ? 0 : journey.stages[nextStage].frames.length - 1];
  }
  function controls() {
    $('compute-previous').disabled = !neighbor(-1); $('compute-next').disabled = !neighbor(1);
    $('compute-play').textContent = timer !== null ? 'Pause' : neighbor(1) ? 'Play' : 'Replay';
    $('compute-play').setAttribute('aria-pressed', String(timer !== null));
    $('compute-event-count').textContent = stageNames[stage] + ' · event ' + (positions[stage] + 1) + ' of ' + journey.stages[stage].frames.length;
  }
  function pause() { clearInterval(timer); timer = null; controls(); }
  function keepStageVisible() {
    const strip = document.querySelector('.stage-buttons'); if (!strip.clientWidth) return;
    const item = stageButtons[stage].getBoundingClientRect(), bounds = strip.getBoundingClientRect();
    if (item.left < bounds.left) strip.scrollLeft += item.left - bounds.left;
    else if (item.right > bounds.right) strip.scrollLeft += item.right - bounds.right;
  }
  function updateHash(push) {
    const hash = '#' + journey.stages[stage].id;
    if (location.hash !== hash) history[push ? 'pushState' : 'replaceState'](null, '', hash);
  }
  function inspectionDefaults() { $('compute-inputs').open = false; $('compute-calculation').open = stage === 0; }
  function changeStage(index, push = false) {
    pause(); stage = Number.isInteger(index) && index >= 0 && index < journey.stages.length ? index : 0;
    inspectionDefaults(); updateHash(push); render(); keepStageVisible();
  }
  function advance(direction) {
    const address = neighbor(direction); if (!address) { pause(); return; }
    const changed = stage !== address[0]; stage = address[0]; positions[stage] = address[1];
    if (changed) { inspectionDefaults(); updateHash(false); keepStageVisible(); }
    render(); if (!neighbor(1)) pause();
  }
  function rebuild() {
    pause(); journey = model.buildComparison(settings); settings = { ...journey.settings }; positions.fill(0);
    selectedCell = Math.min(selectedCell, settings.batch * 4 - 1); render();
  }
  function numbers(id, rows) {
    $(id).replaceChildren(...rows.flat().map(value => {
      const cell = document.createElement('span'); cell.className = 'number'; cell.textContent = value; return cell;
    }));
  }
  function renderLanes(target, current, holding) {
    const groups = $('compute-' + target + '-lane-groups'); groups.replaceChildren();
    const width = target === 'cpu' ? 2 : 8;
    for (let first = 0; first < width; first += 4) {
      const group = document.createElement('div'); group.className = 'lane-group' + (target === 'cpu' ? ' cpu-lanes' : '');
      for (let lane = first; lane < Math.min(first + 4, width); lane++) {
        const index = !holding ? current.active[lane] : undefined;
        const tile = document.createElement('span'); tile.className = 'lane' + (index !== undefined ? ' busy' : '');
        tile.textContent = 'L' + (lane + 1); tile.title = 'Lane ' + (lane + 1) + (index !== undefined ? ': row ' + (Math.floor(index / 4) + 1) + ', column ' + (index % 4 + 1) : holding ? ': holding completed step' : ': idle');
        group.append(tile);
      }
      groups.append(group);
    }
  }
  function renderPath(target, current, advanced, resultReady) {
    const prefix = 'compute-' + target + '-', holding = !advanced;
    $(prefix + 'path').dataset.frame = current.id; $(prefix + 'path').dataset.holding = String(holding);
    $(prefix + 'held').hidden = !holding; $(prefix + 'step').textContent = current.title;
    $(prefix + 'queue').textContent = ({ idle: 'Not started', queued: 'Queued', running: 'Running', complete: 'Calculated' })[current.queue];
    $(prefix + 'cells').textContent = current.computed + ' / ' + (settings.batch * 4);
    $(prefix + 'readable').textContent = current.readable ? 'Ready' : 'Not yet'; $(prefix + 'units').textContent = current.elapsed;
    $(prefix + 'memory').hidden = ![1, 2, 4].includes(stage) || resultReady;
    const inputs = target === 'cpu' ? current.data.hostInputs : current.data.deviceInputs;
    const weights = target === 'cpu' ? current.data.hostWeights : current.data.deviceWeights;
    $(prefix + 'inputs').textContent = inputs ? settings.batch * 4 + ' ready' : 'Missing';
    $(prefix + 'weights').textContent = weights ? '16 ' + (target === 'gpu' && settings.resident ? 'resident' : 'ready') : 'Missing';
    $(prefix + 'host-output').textContent = !current.data.hostOutputs ? 'Empty' : current.readable ? 'Ready' : current.computed + ' calculated';
    if (target === 'gpu') $('compute-gpu-device-output').textContent = current.data.deviceOutputs ? current.computed + ' calculated' : 'Empty';
    else $('compute-cpu-caller-output').textContent = current.readable ? 'Ready' : 'Waiting';
    $(prefix + 'lanes').hidden = stage !== 3; renderLanes(target, current, holding);
    $(prefix + 'output').hidden = stage === 1 || stage === 2;
    $(prefix + 'output-state').textContent = current.readable ? 'Caller-ready' : 'Not yet readable';
    $(prefix + 'output-state').dataset.state = current.readable ? 'readable' : 'pending';
    const grid = $(prefix + 'output-grid'); grid.replaceChildren();
    current.results.forEach((value, index) => {
      const cell = document.createElement('button'); cell.type = 'button'; cell.dataset.cell = String(index); cell.dataset.value = value === null ? '' : String(value);
      cell.className = 'number' + (value !== null ? ' calculated' : '') + (stage === 3 && advanced && current.active.includes(index) ? ' active' : '');
      cell.textContent = value === null ? '·' : value;
      cell.setAttribute('aria-pressed', String(selectedCell === index));
      cell.setAttribute('aria-label', target.toUpperCase() + ' output row ' + (Math.floor(index / 4) + 1) + ', column ' + (index % 4 + 1) + ': ' + (value === null ? 'not calculated' : value));
      cell.addEventListener('click', () => {
        selectedCell = index; render(); $('compute-calculation').open = true;
        $(prefix + 'output-grid').querySelector('[data-cell="' + index + '"]').focus({ preventScroll: true });
      });
      grid.append(cell);
    });
  }
  function equation(current) {
    const row = Math.floor(selectedCell / 4), column = selectedCell % 4;
    const terms = journey.inputs[row].map((value, k) => '(' + value + ' × ' + journey.weights[k][column] + ')');
    const dot = journey.inputs[row].reduce((sum, value, k) => sum + value * journey.weights[k][column], 0);
    const anyComputed = paths.some(target => current[target].results[selectedCell] !== null);
    $('compute-equation').textContent = 'Row ' + (row + 1) + ', column ' + (column + 1) + ': ' + terms.join(' + ') + ' = ' + (anyComputed ? dot : '?') + (settings.branching ? anyComputed ? ' → ' + (dot >= 0 ? '+1' : '−1') + ' path → ' + journey.output[row][column] : '. Then nonnegative +1; negative −1 (pending).' : '');
    $('compute-output-note').textContent = paths.map(target => target.toUpperCase() + ': ' + (current[target].results[selectedCell] === null ? 'cell pending' : 'cell calculated = ' + current[target].results[selectedCell])).join(' · ') + '. Buffer values are not caller-readable until that path returns its result. A dot means pending, not zero.';
  }
  function printReference() {
    $('compute-print-reference').textContent = 'Workload: ' + settings.batch + ' × 4 inputs, 4 × 4 weights; ' + (settings.branching ? 'toy conditional enabled' : 'plain dot products') + '.\nReference matrix, identical on CPU and GPU (not a claim that the current trace has finished):\n' + journey.output.map(row => row.join('  ')).join('\n') + '\nChosen work units: CPU ' + journey.totals.cpu + '; GPU ' + journey.totals.gpu + '. Not measured time.\nPaired events align narrative steps, not hardware time; held snapshots add no work. GPU output is not caller-readable until this workflow’s synchronization and output copy complete.';
  }
  function render() {
    const current = beat(); $('compute-simulator').dataset.stage = String(stage); $('compute-simulator').dataset.frame = current.id;
    panels.forEach((panel, i) => { panel.hidden = i !== stage; });
    stageButtons.forEach((button, i) => { button.disabled = false; if (i === stage) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current'); });
    $('compute-batch').value = String(settings.batch); $('compute-resident').checked = settings.resident; $('compute-branching').checked = settings.branching;
    $('compute-event-label').textContent = stageNames[stage] + ' · paired alternatives';
    const resultReady = stage === 4 && current.cpu.readable && current.gpu.readable;
    $('compute-event-title').textContent = resultReady ? 'Both results are ready to use.' : positions[stage] === 0 ? introductions[stage][0] : stage === 4 ? 'CPU ready; GPU handoff still pending.' : !current.advanced.cpu ? 'GPU advances; CPU holds its step.' : !current.advanced.gpu ? 'CPU advances; GPU holds its step.' : 'Both paths advance one step.';
    $('compute-event-description').textContent = resultReady ? 'The returned matrices match. These activations can feed the next AI layer; compare the cost summary below.' : positions[stage] === 0 ? introductions[stage][1] : stage === 4 ? 'GPU synchronization is finished, but the output copy is still pending. The CPU caller can already read its result.' : 'Each path has its own memory, calculated cells, readiness, and work-unit total. Holding a step performs no additional work; this is not a real-time race.';
    for (const target of paths) renderPath(target, current[target], current.advanced[target], resultReady);
    numbers('compute-input-matrix', journey.inputs); numbers('compute-weight-matrix', journey.weights);
    $('compute-input-shape').textContent = 'Input · ' + settings.batch + ' × 4'; equation(current);
    $('compute-result-summary').hidden = !resultReady;
    $('compute-application-result').textContent = settings.batch * 4 + ' activations are equal on both paths and ready for the next AI layer.';
    const max = Math.max(journey.totals.cpu, journey.totals.gpu);
    for (const target of paths) {
      $('compute-' + target + '-bar').style.width = journey.totals[target] / max * 100 + '%';
      $('compute-' + target + '-total').textContent = journey.totals[target] + ' work units';
    }
    $('compute-cost-breakdown').textContent = paths.map(target => {
      const c = current[target].costs;
      return target.toUpperCase() + ': prepare ' + c.prepare + ', transfer ' + c.transfer + ', submit ' + c.submit + ', compute ' + c.compute + ', completion ' + c.wait + '.';
    }).join(' ');
    printReference(); controls();
  }
  stageButtons.forEach((button, index) => {
    button.addEventListener('click', () => changeStage(index, true));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const count = journey.stages.length;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (index + (event.key === 'ArrowRight' ? 1 : count - 1)) % count;
      changeStage(next, true); stageButtons[next].focus({ preventScroll: true });
    });
  });
  for (const [id, key, getValue] of [['compute-batch', 'batch', node => Number(node.value)], ['compute-resident', 'resident', node => node.checked], ['compute-branching', 'branching', node => node.checked]]) {
    $(id).addEventListener('change', event => { settings[key] = getValue(event.target); rebuild(); });
  }
  $('compute-previous').addEventListener('click', () => { pause(); advance(-1); });
  $('compute-next').addEventListener('click', () => { pause(); advance(1); });
  function restart() { pause(); positions.fill(0); stage = 0; selectedCell = 0; inspectionDefaults(); updateHash(false); render(); }
  $('compute-restart').addEventListener('click', restart);
  $('compute-play').addEventListener('click', () => {
    if (timer !== null) { pause(); return; }
    if (!neighbor(1)) restart();
    timer = setInterval(() => advance(1), 1400); controls();
  });
  function followHash() {
    let id; try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    if (id === 'wait' || id === 'use') id = 'finish';
    const index = journey.stages.findIndex(item => item.id === id); if (index >= 0) changeStage(index);
  }
  window.addEventListener('hashchange', followHash); window.addEventListener('popstate', followHash);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', pause); window.addEventListener('beforeprint', () => { pause(); printReference(); });
  createPaths(); inspectionDefaults(); render(); document.documentElement.classList.add('compute-ready'); followHash();
  const nav = document.querySelector('.journey-nav');
  new ResizeObserver(() => { document.documentElement.style.setProperty('--compute-nav-height', nav.getBoundingClientRect().height + 'px'); keepStageVisible(); }).observe(nav);
})();
