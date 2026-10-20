/* One editor story. Close-up inspectors are explicitly independent examples;
   only OSJourneyModel changes the main document, copies, and read counter. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!window.OSModel || !window.OSJourneyModel) { $('model-error').hidden = false; return; }
  const model = window.OSModel, journeyModel = window.OSJourneyModel;
  const panels = [...document.querySelectorAll('[data-journey-step]')], links = [...document.querySelectorAll('[data-step]')];
  const names = ['Launch', 'Open', 'Read', 'Edit', 'Save'];
  const defaults = () => ({ allowed: true, cached: false, slow: false, pressure: false, renamed: false });
  let options = defaults(), run, positions = [], stage = 0, timer = null;
  const nav = document.querySelector('.journey-nav'), dashboard = document.querySelector('.os-dashboard');
  const frame = () => run.frames[positions[stage]];
  const indices = index => run.frames.map((f, i) => f.stage === index ? i : -1).filter(i => i >= 0);
  const lastInStage = () => indices(stage).at(-1);
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function syncControls() {
    const finished = run && positions[stage] === lastInStage();
    $('stage-play').textContent = timer ? 'Pause' : finished ? 'Replay stage' : 'Play stage';
    $('stage-play').setAttribute('aria-pressed', String(Boolean(timer)));
    $('stage-event-next').disabled = Boolean(finished);
    $('stage-event-previous').disabled = !run || positions[stage] === indices(stage)[0];
  }
  function stop() { clearInterval(timer); timer = null; syncControls(); }
  function clearCrash() { $('save-result').hidden = true; $('save-result').replaceChildren(); }
  function rebuild(focusId = null) {
    stop(); const prior = positions.map(index => run?.frames[index]?.id);
    run = journeyModel.buildJourney(options);
    positions = run.checkpoints.map((index, s) => {
      const preserved = run.frames.findIndex(f => f.id === prior[s] && f.stage === s);
      return preserved >= 0 ? preserved : index;
    });
    stage = Math.min(stage, run.terminalStage);
    if (focusId) {
      const index = run.frames.findIndex(f => f.id === focusId && f.stage === stage);
      if (index >= 0) positions[stage] = index;
    }
    clearCrash(); render();
  }
  function renderScene() {
    const f = frame();
    $('journey').dataset.event = f.id;
    $('process-state').textContent = f.process;
    $('storage-reads').textContent = String(f.reads);
    $('edit-durable').textContent = f.durable === null ? 'No new edit' : f.durable ? 'Yes · synced' : 'Not yet';
    const announcement = names[stage] + ': ' + f.title + '. Process ' + f.process + '; ' + f.reads + ' storage reads; latest edit: ' + $('edit-durable').textContent + '.';
    if ($('os-event-announcement').textContent !== announcement) $('os-event-announcement').textContent = announcement;
    $('os-owner').textContent = 'Active: ' + f.owner;
    $('os-event-title').textContent = f.title;
    $('os-event-description').textContent = f.text;
    document.querySelector('.editor').hidden = stage === 0 && f.id !== 'running';
    $('editor-path').textContent = f.handle === null ? 'No document open' : '/notes/' + f.filename + ' · descriptor ' + f.handle;
    $('editor-tabs').hidden = f.handle === null;
    $('editor-filename').textContent = f.filename;
    $('editor-pending').hidden = f.durable !== false;
    $('editor-file-state').textContent = f.id === 'denied' ? 'Access denied' : f.app === null ? (f.handle === null ? 'No file' : 'Not read') : f.durable === null ? 'Original' : f.durable ? 'Durable' : f.written ? 'Sync pending' : 'Unsaved';
    $('editor-file-state').dataset.state = f.durable === true ? 'durable' : f.durable === false ? 'pending' : 'original';
    $('editor-document').hidden = f.app === null;
    $('editor-text').hidden = f.app === null;
    $('editor-text').setAttribute('aria-label', 'Simulated editor document: ' + f.filename);
    $('editor-wait').hidden = f.app !== null;
    if (f.app !== null) $('editor-text').value = f.app;
    const heading = f.id === 'denied' ? 'Access denied.' : f.process === 'Not started' ? 'Editor not running.' : f.handle === null ? 'Editor ready. No document open.' : 'File opened. Bytes not read yet.';
    const body = f.id === 'denied' ? 'The editor can handle this error. No document bytes were read, edited, or written.' : f.handle === null ? 'Open a note to get a file descriptor.' : 'Descriptor 3 refers to inode 42. The read stage brings its contents into this buffer.';
    $('editor-wait-message').replaceChildren(element('strong', heading), element('span', body));
    $('editor-status').textContent = f.app === null ? 'No document buffer yet.' : f.durable === null ? 'Original version loaded. No new edit.' : f.durable ? 'Saved durably in this model.' : f.written ? 'Write returned. Synchronization still pending.' : 'Unsaved edit · only the application buffer changed.';
    $('memory-status').hidden = stage !== 0 && stage !== 3;
    $('memory-status').textContent = f.memory;
    document.querySelector('.copy-board').hidden = stage < 2;
    $('copy-os').hidden = stage < 2;
    $('copy-device').hidden = stage !== 4;
    $('copy-disk').hidden = stage < 2;
    document.querySelectorAll('[data-copy-filename]').forEach(node => { node.textContent = f.filename; });
    $('copy-os-value').textContent = f.cache ?? 'Not cached';
    $('copy-device-value').textContent = f.device;
    $('copy-disk-value').textContent = f.disk;
    $('copy-os-note').textContent = f.cache === null ? 'A document read will need storage.' : f.dirty ? 'Dirty: the changed bytes still need writeback.' : f.written && !f.durable ? 'OS page clean; the device flush / sync is still pending.' : 'Clean cached copy. This is not the application buffer.';
    $('copy-disk-note').textContent = f.durable === true ? 'The new file version is durable after successful synchronization.' : 'Existing durable version; opening or editing does not replace it.';
    $('copy-os').classList.toggle('dirty', f.dirty);
    $('copy-disk').classList.toggle('durable', f.durable === true);
    $('cpu-handoff').hidden = !((stage === 2 && f.id !== 'cache-check') || (stage === 3 && f.process === 'Blocked'));
    $('handoff-title').textContent = f.process === 'Blocked' ? 'Editor blocked · CPU available to other ready work' : f.process === 'Ready' ? 'Editor ready · waiting for a CPU turn' : 'Editor running · the read can return';
    $('handoff-description').textContent = f.process === 'Blocked' ? 'The device can work while another ready thread, such as a music player, uses the CPU.' : f.process === 'Ready' ? 'I/O completion is not CPU dispatch. The scheduler still chooses when the editor resumes.' : options.cached ? 'The document cache supplied the bytes without a device request.' : 'After completion and scheduling, the editor receives the document bytes.';
    const events = indices(stage), eventIndex = events.indexOf(positions[stage]);
    $('event-position').textContent = names[stage] + ' · event ' + (eventIndex + 1) + ' / ' + events.length;
    syncControls();
    document.documentElement.style.setProperty('--os-dashboard-height', dashboard.getBoundingClientRect().height + 'px');
  }
  function render() {
    panels.forEach((panel, index) => { panel.hidden = stage !== index; });
    links.forEach((link, index) => {
      if (index === stage) link.setAttribute('aria-current', 'step'); else link.removeAttribute('aria-current');
      link.setAttribute('aria-disabled', String(index > run.terminalStage));
    });
    $('journey-position').textContent = (stage + 1) + ' / 5';
    $('journey-status').textContent = 'Stage ' + (stage + 1) + ' of 5 · ' + names[stage] + '. ' + (frame().id === 'denied' ? 'Open denied. Allow access above to continue.' : 'The same editor and file throughout.');
    $('previous').disabled = stage === 0; $('next').disabled = stage === run.terminalStage;
    $('next').textContent = stage === run.terminalStage ? (!options.allowed ? (frame().id === 'denied' ? 'Open denied' : 'Checking access') : frame().durable ? 'Journey complete' : 'Save pending') : 'Next stage →';
    $('allow-file').checked = options.allowed; $('document-cached').checked = options.cached;
    $('slow-storage').checked = options.slow; $('slow-storage').disabled = options.cached;
    $('memory-pressure').checked = options.pressure;
    $('rename-file').disabled = !options.allowed || frame().handle === null;
    $('rename-file').textContent = options.renamed ? 'Restore todo.txt name' : 'Rename to shopping.txt';
    $('rename-note').textContent = frame().filename === 'shopping.txt' ? 'The directory now names shopping.txt. Descriptor 3 still refers to inode 42; the bytes are unchanged.' : options.renamed ? 'The rename is scheduled after the descriptor is returned. Play the open stage to follow it.' : 'After opening, renaming changes the name—not the object referenced by descriptor 3.';
    $('file-identity').textContent = frame().id === 'denied' ? 'File-open request → permission error\nNo descriptor returned · no document read' : 'Path: /notes/' + frame().filename + '\nDescriptor: ' + (frame().handle ?? 'not returned yet') + ' → inode ' + (frame().inode ?? 'not opened yet');
    $('read-description').textContent = options.cached ? 'The document is already cached. The kernel supplies its bytes without a device read; the editor can continue without this storage wait.' : 'A cache miss goes through a driver to the device. The editor blocks while I/O runs. Completion makes it ready; a later CPU turn lets the read return.';
    $('cache-note').textContent = options.cached ? 'Document cache hit: no document I/O. The one cold executable-page read still counts. Slow storage does not affect this cache hit.' : options.slow ? 'The same document read takes more waiting events—not more read requests. Play this stage to follow the handoff.' : 'This changes the document read. The executable still starts with one cold code-page read.';
    renderScene(); window.GuidePresentation?.refresh();
  }
  function writeHash(replace = false) {
    const hash = '#' + panels[stage].id;
    if (location.hash !== hash) try { history[replace ? 'replaceState' : 'pushState'](null, '', hash); } catch { location.hash = hash; }
  }
  function show(index, { focus = false, scroll = false, hash = true } = {}) {
    if (index < 0 || index > run.terminalStage) return;
    stop(); stage = index; clearCrash(); render(); if (hash) writeHash();
    const link = links[stage], strip = link.parentElement.getBoundingClientRect(), box = link.getBoundingClientRect();
    if (box.left < strip.left) link.parentElement.scrollLeft -= strip.left - box.left;
    else if (box.right > strip.right) link.parentElement.scrollLeft += box.right - strip.right;
    if (focus) panels[stage].querySelector('h2').focus({ preventScroll: true });
    if (scroll) (focus && matchMedia('(max-width:760px)').matches ? panels[stage] : $('journey')).scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  function advance() {
    positions[stage] = Math.min(lastInStage(), positions[stage] + 1); clearCrash(); render();
    if (positions[stage] === lastInStage()) stop();
  }
  links.forEach((link, index) => {
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); show(index, { focus: true, scroll: true });
    });
    link.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const end = run.terminalStage;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? end : (index + (event.key === 'ArrowRight' ? 1 : end)) % (end + 1);
      show(next); links[next].focus({ preventScroll: true });
    });
  });
  $('previous').addEventListener('click', () => show(stage - 1, { focus: true, scroll: true }));
  $('next').addEventListener('click', () => show(stage + 1, { focus: true, scroll: true }));
  $('stage-event-previous').addEventListener('click', () => {
    stop(); positions[stage] = Math.max(indices(stage)[0], positions[stage] - 1);
    clearCrash(); render();
  });
  $('stage-event-next').addEventListener('click', () => { stop(); advance(); });
  $('stage-play').addEventListener('click', () => {
    if (timer) { stop(); return; }
    if (positions[stage] === lastInStage()) { positions[stage] = indices(stage)[0]; clearCrash(); render(); }
    timer = setInterval(advance, 1400); syncControls();
    if (matchMedia('(max-width:760px)').matches) document.querySelector('.scene').scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  $('replay').addEventListener('click', () => {
    stop(); options = defaults(); positions = []; stage = 0;
    rebuild(); show(0, { focus: true, scroll: true });
  });
  $('allow-file').addEventListener('change', event => { options.allowed = event.target.checked; rebuild(options.allowed ? (options.renamed ? 'renamed' : 'opened') : 'denied'); writeHash(true); });
  $('rename-file').addEventListener('click', () => { options.renamed = !options.renamed; rebuild(options.renamed ? 'renamed' : 'opened'); });
  $('document-cached').addEventListener('change', event => {
    options.cached = event.target.checked; if (options.cached) options.slow = false;
    rebuild(options.cached ? 'read-complete' : 'document-read');
  });
  $('slow-storage').addEventListener('change', event => { options.slow = event.target.checked; rebuild('document-read'); });
  $('memory-pressure').addEventListener('change', event => { options.pressure = event.target.checked; rebuild(options.pressure ? 'code-evict' : 'edited'); });
  for (const [id, failure] of [['save-app-crash', 'app'], ['save-power-loss', 'power']]) $(id).addEventListener('click', () => {
    stop(); const result = journeyModel.crashJourney(frame(), failure);
    const box = $('save-result'); box.hidden = false;
    box.replaceChildren(element('strong', 'What-if: ' + (failure === 'app' ? 'application crash' : 'power loss')), element('p', 'After restart the file reads “' + result.visible + '”. Persistent copy: “' + result.durable + '”. ' + result.explanation), element('p', 'This inspects a possible failure at the selected event; the editor snapshot above is unchanged. Next event continues the original save.'));
  });
  // Independent explanatory close-ups, never silently driving the main story.
  let cpuRun, cpuPosition = 0;
  function renderCpu() {
    const f = cpuRun.frames[cpuPosition];
    $('cpu-lanes').replaceChildren(...f.cpu.map((id, i) => element('div', 'Core ' + (i + 1) + ': ' + (id ? f.tasks.find(task => task.id === id).label : 'idle'))));
    $('cpu-tasks').replaceChildren(...f.tasks.map(task => {
      const node = element('div', undefined, 'mini-card ' + (task.state === 'running' ? 'active' : task.state === 'blocked' ? 'blocked' : task.state === 'done' ? 'done' : ''));
      node.append(element('strong', task.label), element('small', task.state + ' · ' + task.cpuDone + '/' + task.totalCpu + ' CPU ticks')); return node;
    }));
    $('cpu-description').textContent = 'Tick ' + f.time + ': ' + f.event;
    $('cpu-next').disabled = cpuPosition === cpuRun.frames.length - 1;
  }
  function rebuildCpu() { stop(); cpuRun = model.schedule({ cores: Number($('cpu-cores').value), ioTicks: 3 }); cpuPosition = 0; renderCpu(); }
  $('cpu-cores').addEventListener('change', rebuildCpu);
  $('cpu-next').addEventListener('click', () => { stop(); cpuPosition = Math.min(cpuRun.frames.length - 1, cpuPosition + 1); renderCpu(); });
  $('cpu-reset').addEventListener('click', () => { stop(); cpuPosition = 0; renderCpu(); });
  function renderMemory() {
    const process = $('memory-process').value, address = Number($('memory-address').value), access = $('memory-access').value;
    const result = model.translate({ process, address, access });
    $('memory-address-value').textContent = address + ' · page ' + result.page + ', offset ' + result.offset;
    $('memory-address').setAttribute('aria-valuetext', 'Virtual address ' + address + ', page ' + result.page + ', offset ' + result.offset);
    $('memory-pages').replaceChildren(...model.pageTable(process).map(entry => {
      const node = element('button', undefined, 'mini-card'); node.type = 'button'; node.dataset.page = entry.page;
      const destination = entry.kind === 'resident' ? 'Frame ' + entry.frame : ({ zero: 'Zero-fill on first use', disk: 'Needs backing storage', invalid: 'Unmapped' })[entry.kind];
      node.append(element('strong', 'Page ' + entry.page), element('small', destination + (entry.kind === 'invalid' ? '' : entry.writable ? ' · read/write' : ' · read-only')));
      node.setAttribute('aria-pressed', String(entry.page === result.page));
      node.addEventListener('click', () => { stop(); $('memory-address').value = String(entry.page * model.PAGE_BYTES + result.offset); renderMemory(); $('memory-pages').querySelector('[data-page="' + entry.page + '"]').focus({ preventScroll: true }); }); return node;
    }));
    $('memory-description').textContent = (result.kind === 'resident' ? 'Virtual ' + address + ' → physical ' + result.physical + '. ' : '') + result.explanation;
  }
  ['memory-process', 'memory-access'].forEach(id => $(id).addEventListener('change', () => { stop(); renderMemory(); }));
  $('memory-address').addEventListener('input', () => { stop(); renderMemory(); });
  let pressureRun, pressurePosition = 0;
  function renderPressure() {
    const f = pressureRun.frames[pressurePosition];
    $('pressure-ram').replaceChildren(...f.ram.map((page, i) => {
      const node = element('div', undefined, 'mini-card' + (page !== null && page === f.page ? ' active' : ''));
      node.append(element('strong', 'Frame ' + i), element('small', page ?? 'empty')); return node;
    }));
    $('pressure-stats').textContent = f.reads + ' storage reads · ' + f.hits + ' resident hits · reference ' + pressurePosition + '/' + pressureRun.trace.length;
    $('pressure-description').textContent = f.event;
    $('pressure-next').disabled = pressurePosition === pressureRun.frames.length - 1;
  }
  function rebuildPressure() { stop(); pressureRun = model.memoryRun(Number($('pressure-capacity').value)); pressurePosition = 0; renderPressure(); }
  $('pressure-capacity').addEventListener('change', rebuildPressure);
  $('pressure-next').addEventListener('click', () => { stop(); pressurePosition = Math.min(pressureRun.frames.length - 1, pressurePosition + 1); renderPressure(); });
  $('pressure-reset').addEventListener('click', () => { stop(); pressurePosition = 0; renderPressure(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', stop);
  window.addEventListener('beforeprint', () => {
    stop(); const previousStage = stage, previousPosition = positions[run.terminalStage];
    stage = run.terminalStage; positions[stage] = indices(stage).at(-1); renderScene();
    stage = previousStage; positions[run.terminalStage] = previousPosition;
  });
  window.addEventListener('afterprint', renderScene);
  function followHash(initial = false) {
    let id; try { id = decodeURIComponent(location.hash.slice(1)); } catch { id = ''; }
    if (id === 'machines' || id.startsWith('vm-')) { location.replace('how-virtual-machines-work.html#machines'); return; }
    const aliases = { 'kernel-title': 'kernel', 'processes-title': 'processes', 'memory-title': 'memory', 'memory-heading': 'memory', 'pressure-title': 'pressure', 'files-title': 'files', 'drivers-title': 'drivers', 'journey-title': 'launch' };
    const target = document.getElementById(aliases[id] || id), panel = target?.closest('[data-journey-step]');
    const index = !id || id === 'journey' ? 0 : panel ? panels.indexOf(panel) : -1;
    if (index < 0) { if (initial) show(0, { hash: false }); return; }
    show(Math.min(index, run.terminalStage), { hash: false });
    if (target && panel && !panel.hidden) for (let parent = target; parent && parent !== panel; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
    if (!initial) $('journey').scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  window.addEventListener('hashchange', () => followHash()); window.addEventListener('popstate', () => followHash());
  new ResizeObserver(() => document.documentElement.style.setProperty('--os-nav-height', nav.getBoundingClientRect().height + 'px')).observe(nav);
  new ResizeObserver(() => document.documentElement.style.setProperty('--os-dashboard-height', dashboard.getBoundingClientRect().height + 'px')).observe(dashboard);
  run = journeyModel.buildJourney(options); positions = run.checkpoints.slice();
  rebuildCpu(); renderMemory(); rebuildPressure();
  document.documentElement.classList.add('ready'); followHash(true);
})();
