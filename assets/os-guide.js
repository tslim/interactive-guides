/* UI for the local OS teaching models. No real OS operations are performed. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!window.OSModel) { $('model-error').hidden = false; return; }
  const model = window.OSModel;
  const players = [];
  let activePlayer = null;
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function card(title, detail, active = false) {
    const node = element('div', undefined, 'card' + (active ? ' active' : ''));
    node.append(element('strong', title), element('small', detail)); return node;
  }
  function route(id, labels, index, numbered = true) {
    $(id).replaceChildren(...labels.map((label, i) => card((numbered ? (i + 1) + ' · ' : '') + label, i === index ? 'Current focus' : 'Not active at this step', i === index)));
  }
  function narration(prefix, title, description) {
    $(prefix + '-heading').textContent = title; $(prefix + '-description').textContent = description;
  }
  function player(id, initialFrames, draw, pace = () => 1700) {
    const root = $(id), bar = element('div', undefined, 'toolbar');
    const button = (suffix, text) => { const b = element('button', text); b.type = 'button'; b.id = id + '-' + suffix; bar.append(b); return b; };
    const back = button('back', '← Back'), next = button('next', 'Next step →'), play = button('play', 'Autoplay'), reset = button('reset', 'Restart');
    const seekControl = element('div', undefined, 'control'), label = element('label', 'Inspect a step'), seek = element('input'), count = element('output');
    seek.type = 'range'; seek.min = '0'; seek.step = '1'; seek.id = id + '-seek'; label.htmlFor = seek.id; count.setAttribute('for', seek.id);
    seekControl.append(label, seek, count); root.append(bar, seekControl);
    let frames = initialFrames, position = 0, timer = null;
    const api = {
      pause() { clearInterval(timer); timer = null; if (activePlayer === api) activePlayer = null; controls(); },
      go(index) { api.pause(); position = Math.max(0, Math.min(frames.length - 1, index)); paint(); },
      replace(nextFrames) { api.pause(); frames = nextFrames; position = 0; paint(); },
      redraw() { draw(frames[position], position); },
      get position() { return position; },
      get current() { return frames[position]; }
    };
    function controls() {
      back.disabled = position === 0; next.disabled = position === frames.length - 1;
      play.textContent = timer ? 'Pause' : position === frames.length - 1 ? 'Replay' : 'Autoplay';
      play.setAttribute('aria-pressed', String(Boolean(timer)));
      seek.max = String(frames.length - 1); seek.value = String(position);
      seek.setAttribute('aria-valuetext', 'Step ' + (position + 1) + ' of ' + frames.length);
      count.textContent = 'Step ' + (position + 1) + ' of ' + frames.length;
    }
    function paint() { if (position === frames.length - 1) api.pause(); controls(); draw(frames[position], position); }
    back.addEventListener('click', () => api.go(position - 1)); next.addEventListener('click', () => api.go(position + 1));
    reset.addEventListener('click', () => api.go(0)); seek.addEventListener('input', () => api.go(Number(seek.value)));
    play.addEventListener('click', () => {
      if (timer) { api.pause(); return; }
      if (activePlayer) activePlayer.pause();
      if (position === frames.length - 1) { position = 0; paint(); }
      activePlayer = api;
      timer = setInterval(() => { position = Math.min(position + 1, frames.length - 1); paint(); }, pace()); controls();
    });
    players.push(api); paint(); return api;
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) players.forEach(p => p.pause()); });
  window.addEventListener('pagehide', () => players.forEach(p => p.pause()));
  document.addEventListener('guide:change', () => players.forEach(p => p.pause()));

  // 1. Mode transitions are deliberately separate from process scheduling.
  function kernelFrames(action) {
    if (action === 'calculate') return [
      { title: 'The app prepares a calculation.', text: 'The running thread already has a CPU turn. Its instructions execute in user mode.', part: 0 },
      { title: 'The CPU computes 2 + 2 = 4.', text: 'Ordinary arithmetic needs no system call. The kernel did not interpret this instruction for the application.', part: 1 }
    ];
    return [
      { title: 'Application requests a file.', text: 'A library wrapper prepares an open request. The application is still executing in user mode.', part: 0 },
      { title: 'Enter through a system call.', text: 'Hardware transfers control to an approved kernel entry point. Kernel code runs with privilege; the application does not gain unrestricted privilege.', part: 1 },
      { title: 'Validate arguments and access.', text: action === 'denied' ? 'The caller lacks read permission for this file. The kernel refuses this request.' : 'The kernel resolves the path and checks permissions. This caller may open the file.', part: 2 },
      { title: action === 'denied' ? 'Return an error, not the bytes.' : 'Return a file handle.', text: action === 'denied' ? 'The application resumes in user mode with a permission error. The process can handle the error; denial does not inherently crash it.' : 'The application resumes in user mode with a handle for future operations. Opening the handle is not the same as reading the file contents.', part: 3 }
    ];
  }
  const kernel = player('kernel-player', kernelFrames('allowed'), f => {
    route('kernel-route', $('kernel-action').value === 'calculate' ? ['Application instructions', 'CPU arithmetic · user mode'] : ['Application', 'System-call entry', 'Kernel validation', 'Application resumes'], f.part);
    narration('kernel', f.title, f.text);
  });
  $('kernel-action').addEventListener('change', () => kernel.replace(kernelFrames($('kernel-action').value)));

  // 2. CPU scheduling.
  const cpu = player('cpu-player', model.schedule().frames, f => {
    $('cpu-lanes').replaceChildren(...f.cpu.map((id, i) => element('div', 'Core ' + (i + 1) + ': ' + (id ? f.tasks.find(t => t.id === id).label : 'idle'), 'cpu-lane')));
    $('cpu-tasks').replaceChildren(...f.tasks.map(task => {
      const node = card(task.label, task.state + ' · ' + task.cpuDone + '/' + task.totalCpu + ' CPU ticks complete' + (task.state === 'blocked' ? ' · ' + task.waitRemaining + ' I/O ticks left' : ''), task.state === 'running');
      node.dataset.task = task.id; node.dataset.state = task.state;
      node.classList.toggle('blocked', task.state === 'blocked'); node.classList.toggle('done', task.state === 'done');
      const progress = element('progress', undefined, 'task-bar'); progress.max = task.totalCpu; progress.value = task.cpuDone;
      progress.setAttribute('aria-label', task.label + ' CPU work completed'); node.append(progress); return node;
    }));
    narration('cpu', f.tasks.every(t => t.state === 'done') ? 'All nine CPU ticks of work are complete.' : 'Tick ' + f.time + ' → ' + (f.time + 1) + ': who runs now?', f.event);
  });
  function rebuildCpu() {
    const ioTicks = Number($('cpu-io').value);
    $('cpu-io-value').textContent = ioTicks + ' ticks'; $('cpu-io').setAttribute('aria-valuetext', ioTicks + ' I/O ticks');
    cpu.replace(model.schedule({ cores: Number($('cpu-cores').value), ioTicks }).frames);
  }
  $('cpu-cores').addEventListener('change', rebuildCpu); $('cpu-io').addEventListener('input', rebuildCpu); rebuildCpu();

  // 3. Address inspection does not allocate memory or change the table.
  function renderMemory() {
    const process = $('memory-process').value, address = Number($('memory-address').value), access = $('memory-access').value;
    const result = model.translate({ process, address, access });
    $('memory-address-value').textContent = address + ' (0x' + address.toString(16).toUpperCase() + ')';
    $('memory-address').setAttribute('aria-valuetext', 'Virtual address ' + address + ', page ' + result.page + ', offset ' + result.offset);
    $('memory-pages').replaceChildren(...model.pageTable(process).map(entry => {
      const button = element('button', undefined, 'card'); button.type = 'button'; button.dataset.page = entry.page;
      const destination = entry.kind === 'resident' ? 'Frame ' + entry.frame : ({ zero: 'First use · zero-fill', disk: 'Needs storage read', invalid: 'Unmapped' })[entry.kind];
      button.append(element('strong', 'Page ' + entry.page), element('small', destination + (entry.kind === 'invalid' ? '' : entry.writable ? ' · read/write' : ' · read-only')));
      button.setAttribute('aria-pressed', String(entry.page === result.page));
      button.addEventListener('click', () => { $('memory-address').value = String(entry.page * model.PAGE_BYTES + result.offset); renderMemory(); $('memory-pages').querySelector('[data-page="' + entry.page + '"]').focus({ preventScroll: true }); });
      return button;
    }));
    $('memory-ram').replaceChildren(...Array.from({ length: 8 }, (_, frame) => card('Frame ' + frame, ({ 1: 'Shared read-only page', 3: 'Editor page 0', 5: 'Player page 0' })[frame] || 'Other use / not shown', result.frame === frame && result.kind === 'resident')));
    narration('memory', result.kind === 'resident' ? 'Virtual ' + address + ' → physical ' + result.physical : ({ zero: 'Fault: allocate a zero-filled page.', disk: 'Fault: load the modeled backing page.', invalid: 'Fault: this address is not mapped.', protection: 'Fault: this write is not permitted.' })[result.kind], result.explanation);
  }
  ['memory-process', 'memory-access'].forEach(id => $(id).addEventListener('change', renderMemory));
  $('memory-address').addEventListener('input', renderMemory); renderMemory();

  // 4. Clean-page cache pressure.
  const trace = model.memoryRun().trace;
  const pressure = player('pressure-player', model.memoryRun().frames, (f, index) => {
    $('pressure-ram').replaceChildren(...f.ram.map((page, i) => card('Frame ' + i, page || 'empty', page !== null && page === f.page)));
    $('pressure-reads').textContent = f.reads; $('pressure-hits').textContent = f.hits; $('pressure-faults').textContent = f.faults;
    document.querySelectorAll('[data-reference]').forEach(button => {
      if (Number(button.dataset.reference) === index) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    });
    const insight = index === trace.length && f.ram.length >= 4 ? ' Four and five frames both need only the five initial page reads in this trace. The fifth frame avoids an eviction, but not an additional storage read.' : '';
    narration('pressure', index === 0 ? 'The working set starts cold.' : f.hit ? 'Page ' + f.page + ' is still in RAM.' : 'Page ' + f.page + ' needs a storage read.', f.event + insight);
  });
  trace.forEach((page, i) => {
    const button = element('button', (i + 1) + ' · ' + page); button.type = 'button'; button.dataset.reference = i + 1;
    button.setAttribute('aria-label', 'Inspect reference ' + (i + 1) + ', page ' + page);
    button.addEventListener('click', () => pressure.go(i + 1)); $('pressure-trace').append(button);
  });
  $('pressure-capacity').addEventListener('change', () => pressure.replace(model.memoryRun(Number($('pressure-capacity').value)).frames));

  // 5. A deliberately tiny, Unix-like name-to-object explorer.
  const files = [
    { inode: 42, name: 'todo.txt', blocks: [2, 7], chunks: ['Buy ', 'milk'] },
    { inode: 81, name: 'ideas.txt', blocks: [4, 5, 8], chunks: ['Plan', 't oa', 'k'] }
  ];
  let handle = null;
  function currentFile() { return files.find(file => file.inode === Number($('file-choice').value)); }
  function renderHandle() {
    $('file-open').textContent = handle === null ? 'Open a handle' : 'Close handle 3';
    $('file-handle').textContent = handle === null ? 'No open handle in this example.' : 'Open descriptor 3 → inode ' + handle + '. It still refers to this object even if the name changes.';
  }
  const filePlayer = player('file-player', [0, 1, 2, 3], step => {
    const file = currentFile(), path = '/notes/' + file.name;
    route('file-route', [path, '/ → notes directory → ' + file.name, 'Inode ' + file.inode + ' · ' + file.chunks.join('').length + ' bytes', 'Blocks ' + file.blocks.join(', ') + ' → “' + file.chunks.join('') + '”'], step);
    const captions = [
      ['Start with a pathname.', 'The root directory resolves “notes” to a directory. That directory will resolve the final filename.'],
      ['Resolve a directory entry.', 'Inside /notes, “' + file.name + '” names inode ' + file.inode + '. The name is in this directory entry, not embedded in the file’s data.'],
      ['Inspect file metadata.', 'Inode ' + file.inode + ' describes this regular file, its size, access attributes, and allocation. Our tiny file uses blocks ' + file.blocks.join(', ') + '.'],
      ['Read logical bytes in order.', 'The blocks hold “' + file.chunks.join('” + “') + '”. Their physical positions need not be consecutive. The application sees “' + file.chunks.join('') + '”.']
    ];
    narration('file', ...captions[step]); renderHandle();
  });
  $('file-choice').addEventListener('change', () => { $('file-rename-result').textContent = ''; filePlayer.go(0); });
  $('file-open').addEventListener('click', () => { filePlayer.pause(); handle = handle === null ? currentFile().inode : null; renderHandle(); });
  $('file-rename').addEventListener('click', () => {
    filePlayer.pause(); const name = $('file-name').value.trim(), file = currentFile();
    if (!/^[\w .-]{1,24}$/.test(name) || name === '.' || name === '..') { $('file-rename-result').textContent = 'Use 1–24 letters, digits, spaces, dots, hyphens, or underscores; not “.” or “..”.'; return; }
    if (files.some(other => other !== file && other.name === name)) { $('file-rename-result').textContent = 'That name already exists in /notes. Choose another name.'; return; }
    const previous = file.name; file.name = name;
    $('file-choice').querySelector('[value="' + file.inode + '"]').textContent = '/notes/' + name;
    filePlayer.redraw(); $('file-rename-result').textContent = 'Renamed ' + previous + ' → ' + name + '. Inode ' + file.inode + ' and blocks ' + file.blocks.join(', ') + ' are unchanged. This shows identity, not crash-durability of the rename.';
  });

  // 6. One blocking I/O path, contrasted with a cache hit.
  function ioFrames(hit) {
    const start = [
      { at: 0, title: 'The app calls read.', text: 'Its thread enters the kernel using an existing file handle.' },
      { at: 1, title: 'Check the page cache.', text: hit ? 'The requested bytes are resident. The kernel can copy them without issuing a device read.' : 'The requested bytes are absent. The kernel needs storage I/O.' }
    ];
    if (!hit) start.push(
      { at: 2, title: 'The driver submits a request.', text: 'The request enters the device’s queue. This blocking reader sleeps; it is not a runnable task spinning on a CPU.' },
      { at: 3, title: 'Storage works while another task runs.', text: 'Device work and CPU work can overlap. The editor remains blocked, but an unrelated ready thread can run.' },
      { at: 2, title: 'Completion arrives via an interrupt.', text: 'The device has finished its transfer. Driver/OS handling records completion and makes the editor ready—not automatically running.' },
      { at: 1, title: 'The scheduler gives the editor a turn.', text: 'Once selected, the editor continues its read. I/O readiness and CPU dispatch are distinct events.' }
    );
    start.push({ at: 0, title: 'The read returns bytes.', text: hit ? 'The application resumes in user mode. No storage-device request was needed for this cache hit.' : 'The application resumes in user mode with the bytes. Other work could proceed during its I/O wait.' });
    return start;
  }
  const io = player('io-player', ioFrames(false), f => {
    const labels = $('io-path').value === 'hit' ? ['Application', 'Kernel / cache · device bypassed'] : ['Application', 'Kernel / cache / scheduler', 'Driver / completion', 'Storage device'];
    route('io-route', labels, f.at, false); narration('io', f.title, f.text);
  });
  $('io-path').addEventListener('change', () => io.replace(ioFrames($('io-path').value === 'hit')));

  // 7. Volatile layers and durable storage are intentionally separate.
  const save = player('save-player', model.saveRun(), (f, index) => {
    const names = ['Application buffer', 'OS page cache · volatile', 'Device cache · volatile', 'Persistent storage'];
    $('save-layers').replaceChildren(...['app', 'cache', 'device', 'disk'].map((key, i) => {
      const node = card(names[i], f[key] === null ? 'Application closed' : f[key], [0,0,1,2,3,3][index] === i);
      node.dataset.layer = key; return node;
    }));
    narration('save', f.title, f.explanation); $('save-result').hidden = true;
  });
  function showSaveCrash(failure) {
    save.pause(); const result = model.crashSave(save.position, failure);
    $('save-result').hidden = false;
    $('save-result').textContent = (failure === 'app' ? 'App crash' : 'Power loss') + ' → after restart, the file reads “' + result.visible + '”. Persistent copy: “' + result.durable + '”. ' + result.explanation + ' Move to another step to continue inspecting the original save sequence.';
  }
  $('save-app-crash').addEventListener('click', () => showSaveCrash('app')); $('save-power-loss').addEventListener('click', () => showSaveCrash('power'));

  // 8. Layer diagrams are conceptual, not a universal hypervisor topology.
  let environment = 'native';
  function vmFrames(kind) {
    if (kind === 'vm') return [
      ['Guest application', 'The guest application makes a system call to its guest kernel—not directly to the host’s filesystem.'],
      ['Guest kernel', 'The guest OS checks permissions and interprets its own filesystem and virtual disk.'],
      ['Virtual device', 'A virtual disk request crosses into the virtualization machinery. This is the modeled virtual-device path, not passthrough.'],
      ['Hypervisor / hosting support', 'Virtualization and device-model support arrange the underlying host-side I/O. Hardware-assisted guest CPU execution need not emulate every instruction.'],
      ['Host driver', 'A host-side driver handles the eventual physical device request in this example.'],
      ['Physical hardware', 'Guest work ultimately uses real CPU time, RAM, and devices, shared with other workloads.']
    ];
    return kind === 'container' ? [
      ['Container process', 'This is still a process executing on the host machine. Its views and resource access are isolated by OS mechanisms.'],
      ['Shared hosting kernel', 'System calls enter the same hosting kernel used by other ordinary containers. There is no separate guest kernel here.'],
      ['Host driver', 'The kernel and its drivers service permitted device requests.'],
      ['Physical hardware', 'Resource controls limit use; the container does not create another physical machine.']
    ] : [
      ['Application process', 'The application uses its process address space and requests OS services through system calls.'],
      ['Host kernel', 'The host OS validates the request and manages its filesystem and resources.'],
      ['Host driver', 'A driver submits the needed device work.'],
      ['Physical hardware', 'The device performs the work. Cache hits could avoid this device path.']
    ];
  }
  const vm = player('vm-player', vmFrames(environment), (f, index) => {
    route('vm-route', vmFrames(environment).map(item => item[0]), index); narration('vm', f[0], f[1]); $('vm-result').hidden = true;
    document.querySelectorAll('[data-environment]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.environment === environment)));
    document.querySelectorAll('[data-stack]').forEach(node => node.classList.toggle('active', node.dataset.stack === environment));
  });
  document.querySelectorAll('[data-environment]').forEach(button => button.addEventListener('click', () => { environment = button.dataset.environment; vm.replace(vmFrames(environment)); }));
  function crashEnvironment(kernelCrash) {
    vm.pause(); $('vm-result').hidden = false;
    $('vm-result').textContent = !kernelCrash ? 'Simulated application crash: this process stops. Its kernel and other isolated processes can continue; shared services or application dependencies can still be affected.' : environment === 'vm' ? 'Simulated guest-kernel crash: this guest and its applications stop. The host and other guests can continue under the intended isolation boundary. This is not a hypervisor crash.' : 'Simulated hosting-kernel crash: the host stops normal operation, affecting native processes and ordinary containers sharing this kernel. Container isolation does not supply a separate kernel.';
  }
  $('vm-app-crash').addEventListener('click', () => crashEnvironment(false)); $('vm-kernel-crash').addEventListener('click', () => crashEnvironment(true));

  // 9. A discrete narrative, not a real-time performance model. State patches
  // make the copies and I/O counts explicit, with independent snapshots.
  function journeyFrames(scenario) {
    const frames = [];
    let state = { process: 'Not started', memory: 'No address space yet', app: 'Not opened', cache: 'Not cached', disk: model.OLD_TEXT, reads: 0, written: false, durable: 'No new edit', dirty: false };
    function add(id, title, text, owner, highlight, patch = {}) {
      state = { ...state, ...patch }; frames.push({ ...state, id, title, text, owner, highlight });
    }
    add('launch', 'Launch the editor.', 'The launcher asks the OS to start a process. It does not hand the application unrestricted access to the machine.', 'Launcher · user mode', 'process');
    add('process', 'Create a process and its mappings.', 'The kernel prepares resources and a virtual address space. Mapping executable pages does not mean every page is already resident.', 'Kernel', 'process', { process: 'Ready', memory: 'Virtual mappings created; code page not resident' });
    add('code', 'First instruction: resolve a code-page fault.', 'In this cold-start story, the needed executable page must be read from storage. This is a storage-backed fault, not the only kind of page fault.', 'Kernel / storage', 'process', { process: 'Blocked for code I/O', memory: 'Code-page read requested', reads: 1 });
    add('running', 'The editor gets a CPU turn.', 'Its code page is resident. Ordinary instructions execute directly on the CPU; address translation uses the OS-managed mappings.', 'Application · user mode', 'process', { process: 'Running', memory: 'Code resident; private virtual address space' });
    if (scenario === 'denied') {
      add('denied', 'The file-open request is denied.', 'The kernel checks this caller’s permissions and returns an error. The editor can handle it; no file bytes are read, edited, or written. The code read earlier was for the executable, not this document.', 'Kernel → application', 'disk', { process: 'Running · handling permission error' });
      return frames;
    }
    add('open', 'Open the existing notes file.', 'The kernel resolves /notes/todo.txt and approves access. It returns a descriptor for the object. The document bytes are not loaded just by this step.', 'Kernel / filesystem', 'cache');
    add('read', 'Request the document bytes.', 'The document is not cached. The kernel submits a storage request through the driver; this blocking reader sleeps while other tasks can run.', 'Kernel / driver / device', 'cache', { process: 'Blocked for document I/O', reads: 2 });
    if (scenario === 'slow') {
      add('wait1', 'The device is still working.', 'No extra CPU calculation can make these requested bytes available yet. Another ready task can use the CPU.', 'Storage device', 'process');
      add('wait2', 'Still waiting—not repeatedly reading.', 'This is the same outstanding read. The storage-read count stays at two: one code read and one document read. These beats illustrate delay, not measured milliseconds.', 'Storage device', 'process');
    }
    add('loaded', 'The read completes; the editor resumes.', 'Completion makes the editor ready. After a scheduler turn, it receives “Buy milk”. The OS also has a clean cached copy.', 'Driver → scheduler → application', 'app', { process: 'Running', app: model.OLD_TEXT, cache: model.OLD_TEXT });
    if (scenario === 'pressure') {
      add('evict', 'Memory pressure reclaims a clean code page.', 'Other memory demand competes for the small RAM budget. The OS reclaims a clean executable page that can be read again later. The document’s contents are unchanged.', 'Kernel / memory manager', 'process', { memory: 'Needed code page reclaimed; other code can still run' });
      add('reload', 'Touch the reclaimed code page again.', 'Execution reaches that nonresident code page. Another fault requests a reload. This extra read is caused by memory pressure—not by changing the notes file.', 'Kernel / storage', 'process', { process: 'Blocked for code reload', memory: 'Code-page reload in progress', reads: 3 });
      add('resume', 'Resume after the extra read.', 'The page is resident and the editor has a CPU turn again. Less RAM added storage work to the same task.', 'Scheduler → application', 'process', { process: 'Running', memory: 'Code resident again' });
    }
    add('edit', 'Add “+ bread” in application memory.', 'Typing changes the editor’s own document buffer. The cached and persistent file still contain the previous version.', 'Application · user mode', 'app', { app: model.NEW_TEXT, durable: 'Not yet' });
    add('write', 'The buffered write returns.', 'The application writes the existing file. The kernel copies the changed bytes into its page cache and marks them dirty. Other reads can see the new bytes before they are durable.', 'Kernel / page cache', 'cache', { cache: model.NEW_TEXT, dirty: true, written: true });
    add('writeback', 'Writeback reaches the device cache.', 'Completed writeback can leave the OS page clean while the device still holds volatile data. In this model, reaching the device cache is not yet the durability milestone.', 'Driver / storage device', 'cache', { dirty: false });
    add('sync', 'Synchronization succeeds.', 'Required writes and cache flushes finish. With the modeled stack honoring its contract, the existing file’s new data is durable. This is not a guarantee against arbitrary hardware failure.', 'Kernel / storage', 'disk', { disk: model.NEW_TEXT, dirty: false, durable: 'Yes · sync completed' });
    add('close', 'Close the file and exit.', 'The OS releases this process’s resources. File-cache pages may remain useful to other work. Closing was not what made the edit durable; synchronization already did that.', 'Application → kernel', 'process', { process: 'Exited', app: 'Application closed', memory: 'Private mappings released; file cache may remain' });
    return frames;
  }
  const journey = player('journey-player', journeyFrames('normal'), f => {
    narration('journey', f.title, f.text); $('journey-owner').textContent = 'Active component: ' + f.owner;
    $('journey-process-value').textContent = f.process; $('journey-memory').textContent = f.memory;
    $('journey-app-value').textContent = f.app; $('journey-cache-value').textContent = f.cache; $('journey-disk-value').textContent = f.disk;
    $('journey-cache-note').textContent = f.dirty ? 'Dirty: updated bytes await writeback.' : f.cache === 'Not cached' ? 'Document is not cached in this story.' : f.written && f.disk !== model.NEW_TEXT ? 'Clean OS page; device flush / synchronization still pending.' : 'Clean cached copy; memory use can outlive the process.';
    $('journey-disk-note').textContent = f.disk === model.NEW_TEXT ? 'New version durable in this model' : 'Previous durable version';
    $('journey-reads').textContent = f.reads; $('journey-write').textContent = f.written ? 'Yes' : 'Not yet'; $('journey-durable').textContent = f.durable;
    ['process', 'app', 'cache', 'disk'].forEach(id => $('journey-' + id).classList.toggle('active', f.highlight === id));
    $('journey-board').dataset.stage = f.id;
  }, () => Number($('journey-speed').value));
  $('journey-scenario').addEventListener('change', () => journey.replace(journeyFrames($('journey-scenario').value)));
  $('journey-speed').addEventListener('change', () => journey.pause());
  document.documentElement.classList.add('ready');
})();
