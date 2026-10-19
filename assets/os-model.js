/* Deterministic teaching models, not a simulation of a particular OS.
   Scheduler: integer intervals [t,t+1), zero dispatch cost, quantum one.
   A frame shows dispatch BEFORE that interval's CPU work. Editor starts I/O
   at the boundary after its second CPU tick; it waits ioTicks FULL intervals.
   At each boundary, existing ready tasks stay first, I/O completions join next,
   then unfinished running tasks rejoin in core order. Initial order is
   editor, player, indexer. Each task is single-threaded. The terminal frame
   has no interval or CPU work. CPU ticks and I/O ticks are toy units.
   Memory: cold, clean file-backed pages, deliberately simplified LRU.
   Saving: existing file, atomic whole-file versions, volatile OS/device caches;
   successful sync includes an honored device flush. No directory/rename or
   arbitrary hardware-failure guarantees. Crashes have no intervening writeback.
   Shared by the browser guide and dependency-free Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OSModel = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const PAGE_BYTES = 16;
  const OLD_TEXT = 'Buy milk';
  const NEW_TEXT = 'Buy milk + bread';

  function optionsObject(options) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Options must be an object');
    }
    return options;
  }

  function integerInRange(value, min, max, name) {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new RangeError(name + ' must be an integer from ' + min + ' to ' + max);
    }
  }

  function schedule(options = {}) {
    const { cores = 1, ioTicks = 3 } = optionsObject(options);
    integerInRange(cores, 1, 2, 'cores');
    integerInRange(ioTicks, 1, 6, 'ioTicks');
    const tasks = [
      { id: 'editor', label: 'Editor', totalCpu: 4 },
      { id: 'player', label: 'Music player', totalCpu: 3 },
      { id: 'indexer', label: 'Indexer', totalCpu: 2 }
    ].map(task => Object.assign(task, { state: 'ready', cpuDone: 0, waitRemaining: 0 }));
    const ready = tasks.slice();
    const frames = [];
    let time = 0;
    let changes = [];
    function snapshot(cpu, event) {
      return { time, cpu: cpu.slice(), tasks: tasks.map(task => Object.assign({}, task)), event };
    }
    while (tasks.some(task => task.state !== 'done')) {
      const running = Array.from({ length: cores }, () => ready.shift() || null);
      running.forEach(task => { if (task) task.state = 'running'; });
      const cpu = running.map(task => task ? task.id : null);
      const dispatch = cpu.map((id, core) => 'Core ' + (core + 1) + ': ' + (id || 'idle')).join('; ');
      frames.push(snapshot(cpu, changes.concat(dispatch).join('. ')));
      changes = [];
      // Only tasks already blocked at this interval's start spend an I/O tick.
      tasks.filter(task => task.state === 'blocked').forEach(task => {
        task.waitRemaining--;
        if (task.waitRemaining === 0) {
          task.state = 'ready';
          ready.push(task);
          changes.push(task.label + ' I/O completed');
        }
      });
      running.forEach(task => {
        if (!task) return;
        task.cpuDone++;
        if (task.cpuDone === task.totalCpu) {
          task.state = 'done';
          changes.push(task.label + ' finished');
        } else if (task.id === 'editor' && task.cpuDone === 2) {
          task.state = 'blocked';
          task.waitRemaining = ioTicks;
          changes.push('Editor blocked for ' + ioTicks + ' I/O ticks');
        } else {
          task.state = 'ready';
          ready.push(task);
        }
      });
      time++;
    }
    frames.push(snapshot(Array(cores).fill(null), changes.concat('All tasks finished').join('. ')));
    return { frames, totalTicks: time, work: 9 };
  }

  function pageTable(process) {
    if (process !== 'editor' && process !== 'player') throw new RangeError('Unknown process');
    return [
      { page: 0, frame: process === 'editor' ? 3 : 5, kind: 'resident', writable: true },
      { page: 1, frame: 1, kind: 'resident', writable: false },
      { page: 2, frame: null, kind: process === 'editor' ? 'zero' : 'invalid', writable: process === 'editor' },
      { page: 3, frame: null, kind: 'disk', writable: true }
    ];
  }

  function translate(options = {}) {
    const { process = 'editor', address = 0, access = 'read' } = optionsObject(options);
    const table = pageTable(process);
    integerInRange(address, 0, 63, 'address');
    if (access !== 'read' && access !== 'write') throw new RangeError('Access must be read or write');
    const page = Math.floor(address / PAGE_BYTES);
    const offset = address % PAGE_BYTES;
    const entry = table[page];
    // Invalid mappings remain invalid even on writes; permission checks precede
    // any resident access or backing-store read. This inspection allocates nothing.
    const kind = entry.kind === 'invalid' ? 'invalid'
      : access === 'write' && !entry.writable ? 'protection' : entry.kind;
    const explanations = {
      resident: 'Resident mapping: physical address = frame × 16 + offset; no page fault.',
      zero: 'First-use page fault: supply a zero-filled page, with no storage read. No allocation is performed here.',
      disk: 'Page fault: this modeled backing-store page needs a storage read. No allocation is performed here.',
      invalid: 'Access denied: this virtual page has no valid mapping.',
      protection: 'Access denied: this shared resident page is read-only; a write causes a protection fault.'
    };
    const frame = kind === 'resident' ? entry.frame : null;
    return { page, offset, frame, physical: frame === null ? null : frame * PAGE_BYTES + offset,
      kind, fault: kind !== 'resident', diskRead: kind === 'disk', explanation: explanations[kind] };
  }

  function memoryRun(capacity = 3) {
    integerInRange(capacity, 2, 5, 'capacity');
    const trace = ['A', 'B', 'C', 'A', 'D', 'B', 'E', 'A'];
    const ram = Array(capacity).fill(null);
    const recent = new Map();
    let reads = 0, faults = 0, hits = 0;
    const frames = [{ page: null, hit: false, evicted: null, ram: ram.slice(), reads, faults, hits,
      event: 'Initially empty RAM; all trace pages are cold, clean file-backed pages. LRU is a teaching policy, not a claim about real OS replacement.' }];
    trace.forEach((page, time) => {
      const hit = ram.includes(page);
      let evicted = null;
      if (hit) {
        hits++;
      } else {
        faults++;
        reads++;
        let slot = ram.indexOf(null);
        if (slot === -1) {
          slot = ram.reduce((oldest, resident, index) => recent.get(resident) < recent.get(ram[oldest]) ? index : oldest, 0);
          evicted = ram[slot];
          recent.delete(evicted);
        }
        ram[slot] = page;
      }
      recent.set(page, time);
      frames.push({ page, hit, evicted, ram: ram.slice(), reads, faults, hits,
        event: hit ? page + ' hit in RAM; no storage read.'
          : page + ' fault: read the clean file-backed page from storage.' + (evicted ? ' Evict least-recently-used ' + evicted + '; no writeback needed.' : '') });
    });
    return { frames, trace };
  }

  function saveRun() {
    return [
      { id: 'opened', title: 'Open existing file',
        explanation: 'The existing version is durable. Nothing new is pending; cache and device layers are volatile.',
        app: OLD_TEXT, cache: OLD_TEXT, device: OLD_TEXT, disk: OLD_TEXT, written: false, latestDurable: true },
      { id: 'edited', title: 'Edit in application memory',
        explanation: 'The new text exists only in application memory; no write has returned.',
        app: NEW_TEXT, cache: OLD_TEXT, device: OLD_TEXT, disk: OLD_TEXT, written: false, latestDurable: false },
      { id: 'buffered', title: 'Buffered write returns',
        explanation: 'The buffered write returned after copying to the volatile OS cache. Written does not mean durable.',
        app: NEW_TEXT, cache: NEW_TEXT, device: OLD_TEXT, disk: OLD_TEXT, written: true, latestDurable: false },
      { id: 'device', title: 'Device accepts write',
        explanation: 'Writeback reached a volatile device write cache, not yet durable storage.',
        app: NEW_TEXT, cache: NEW_TEXT, device: NEW_TEXT, disk: OLD_TEXT, written: true, latestDurable: false },
      { id: 'synced', title: 'Explicit sync succeeds',
        explanation: 'Successful explicit sync plus an honored device flush makes this existing file version durable in the model. Atomic whole-file steps simplify reality; this is not a directory/rename or arbitrary hardware-failure guarantee.',
        app: NEW_TEXT, cache: NEW_TEXT, device: NEW_TEXT, disk: NEW_TEXT, written: true, latestDurable: true },
      { id: 'closed', title: 'Close after sync',
        explanation: 'Application memory is released. The version remains durable because sync already succeeded, not merely because the file was closed.',
        app: null, cache: NEW_TEXT, device: NEW_TEXT, disk: NEW_TEXT, written: true, latestDurable: true }
    ];
  }

  function crashSave(index, failure = 'power') {
    integerInRange(index, 0, 5, 'index');
    if (failure !== 'app' && failure !== 'power') throw new RangeError('Failure must be app or power');
    const frame = saveRun()[index];
    return { visible: failure === 'app' ? frame.cache : frame.disk, durable: frame.disk,
      explanation: failure === 'app'
        ? 'Application crash loses app memory only; OS cache and device cache persist. Restart sees the OS cache, but only disk is durable. No further writeback occurs before restart.'
        : 'Power loss discards application memory, OS cache, and device write cache. Restart sees only the durable disk version. No further writeback occurs before restart.' };
  }

  return { schedule, PAGE_BYTES, pageTable, translate, memoryRun, OLD_TEXT, NEW_TEXT, saveRun, crashSave };
});
