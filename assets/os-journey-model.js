/* A deterministic five-stage editor journey, not a simulation of a specific OS.
   Executable pages and document cache entries are separate. Storage reads count
   requests, not waiting frames. Durability uses OSModel's whole-file save model. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./os-model.js'));
  } else {
    root.OSJourneyModel = factory(root.OSModel);
  }
})(typeof globalThis === 'object' ? globalThis : this, function (OSModel) {
  'use strict';

  function settingsFor(options) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Options must be an object');
    }
    const settings = { allowed: true, cached: false, slow: false, pressure: false, renamed: false };
    for (const key of Object.keys(options)) {
      if (!Object.prototype.hasOwnProperty.call(settings, key)) {
        throw new RangeError('Unknown option: ' + key);
      }
      if (typeof options[key] !== 'boolean') throw new TypeError(key + ' must be a boolean');
      settings[key] = options[key];
    }
    return settings;
  }

  function buildJourney(options = {}) {
    const settings = settingsFor(options);
    const frames = [];
    const checkpoints = [null, null, null, null, null];
    // All state values are primitives: each emitted object is a complete,
    // independent snapshot, never a reference to a previous frame or save step.
    const state = {
      process: 'Not started', memory: 'No process mappings', filename: 'todo.txt',
      handle: null, inode: null, app: null, cache: settings.cached ? OSModel.OLD_TEXT : null,
      device: OSModel.OLD_TEXT, disk: OSModel.OLD_TEXT, reads: 0, written: false,
      durable: null, dirty: false, codeResident: false, saveIndex: null
    };
    function emit(stage, id, title, text, owner, changes = {}) {
      Object.assign(state, changes);
      frames.push(Object.assign({ id, stage, title, text, owner }, state));
    }
    function checkpoint(stage) { checkpoints[stage] = frames.findIndex(frame => frame.stage === stage); }
    const saves = OSModel.saveRun();
    function saveState(index) {
      const version = saves[index];
      return {
        app: version.app, cache: version.cache, device: version.device, disk: version.disk,
        written: version.written, durable: version.latestDurable, dirty: index === 2, saveIndex: index
      };
    }

    emit(0, 'launch', 'Launch the editor', 'The editor has not started; its executable page is cold.', 'User');
    emit(0, 'process', 'Create a process', 'The OS creates the process and virtual mappings, not resident executable bytes.', 'Kernel',
      { process: 'Ready', memory: 'Virtual mappings ready; executable page absent' });
    emit(0, 'code-read', 'Read executable code', 'A cold executable-page fault requests one storage read, even if the document is cached.', 'Storage driver',
      { process: 'Blocked', reads: state.reads + 1 });
    emit(0, 'code-ready', 'Executable page arrives', 'The driver completes I/O; the interrupt makes the editor ready, not running.', 'Driver / interrupt',
      { process: 'Ready', codeResident: true, memory: 'Executable page resident' });
    emit(0, 'running', 'Schedule the editor', 'The scheduler dispatches the ready editor onto the CPU.', 'Scheduler', { process: 'Running' });
    // Every stage opens before its work, rather than at a completed checkpoint.
    checkpoint(0);

    emit(1, 'open-request', 'Request an open', 'The editor asks the OS to open todo.txt with a system call.', 'Editor / syscall');
    emit(1, 'lookup', 'Look up the name', 'The directory maps todo.txt to a file object; no descriptor has been returned yet.', 'Filesystem');
    emit(1, 'permission', 'Check access', 'The OS checks permission before granting a file handle or reading document contents.', 'Kernel');
    if (!settings.allowed) {
      emit(1, 'denied', 'Open denied', 'The editor handles the permission error and keeps running. No file handle or document I/O follows.', 'Editor',
        { process: 'Running' });
      checkpoint(1);
      return { settings, frames, checkpoints, terminalStage: 1 };
    }
    emit(1, 'opened', 'File opened', 'Descriptor 3 refers to inode 42. Opening does not yet copy document contents into the editor.', 'Filesystem',
      { handle: 3, inode: 42 });
    if (settings.renamed) {
      emit(1, 'renamed', 'The filename changes', 'The directory name becomes shopping.txt. The open descriptor still refers to the same inode and contents.', 'Filesystem',
        { filename: 'shopping.txt' });
    }
    checkpoint(1);

    emit(2, 'cache-check', 'Check the document cache', 'The OS checks for document bytes separately from the executable page.', 'Page cache');
    if (!settings.cached) {
      emit(2, 'document-read', 'Read the document', 'A cache miss requests one document read and blocks the editor.', 'Storage driver',
        { process: 'Blocked', reads: state.reads + 1 });
      if (settings.slow) {
        emit(2, 'storage-wait-1', 'Wait for storage', 'The same document read is outstanding; waiting is not another read.', 'Storage device');
        emit(2, 'storage-wait-2', 'Storage is still busy', 'The editor remains blocked on the same request while other processes can run.', 'Storage device');
      }
      emit(2, 'io-ready', 'Document I/O completes', 'The driver fills the document cache and the interrupt makes the editor ready for scheduling.', 'Driver / interrupt',
        { process: 'Ready', cache: OSModel.OLD_TEXT });
    }
    emit(2, 'read-complete', 'Document reaches the editor', settings.cached
      ? 'The cached document is copied into application memory without device I/O or a storage wait.'
      : 'The scheduler runs the editor, which receives the document bytes from the OS cache.', 'Editor',
    { process: 'Running', app: OSModel.OLD_TEXT, cache: OSModel.OLD_TEXT });
    checkpoint(2);

    emit(3, 'editing-start', 'Prepare the edit', 'The document is loaded. Typing will change only the application buffer, not the cached or persistent file.', 'Editor');
    if (settings.pressure) {
      emit(3, 'code-evict', 'Reclaim a clean executable page', 'Memory pressure reclaims clean executable code, not the document cache. No writeback is needed.', 'Memory manager',
        { codeResident: false, memory: 'Executable page evicted; document cache retained' });
      emit(3, 'code-reload', 'Fault the code back in', 'Executing the reclaimed page blocks the editor and requests one code reload.', 'Memory manager / storage driver',
        { process: 'Blocked', reads: state.reads + 1 });
      emit(3, 'code-resume', 'Resume after the code fault', 'After code I/O completes and the scheduler dispatches it, the editor runs again.', 'Scheduler',
        { process: 'Running', codeResident: true, memory: 'Executable page resident' });
    }
    emit(3, 'edited', 'Edit application memory', saves[1].explanation, 'Editor', saveState(1));
    checkpoint(3);

    emit(4, 'save-ready', 'Ready to save', 'The edit is still only in application memory. Inspect crashes here before starting the save.', 'Editor', saveState(1));
    // Save, like the other stages, opens before its work begins.
    checkpoint(4);
    emit(4, 'write-return', 'Buffered write returns', saves[2].explanation, 'Kernel / page cache', saveState(2));
    emit(4, 'device-accepted', 'Device accepts the write', saves[3].explanation, 'Storage device', saveState(3));
    emit(4, 'sync-request', 'Request explicit sync', 'The editor blocks while sync waits for durable storage and an honored device flush.', 'Kernel / storage driver',
      Object.assign(saveState(3), { process: 'Blocked' }));
    emit(4, 'synced', 'Sync succeeds', saves[4].explanation + ' The editor remains open.', 'Editor',
      Object.assign(saveState(4), { process: 'Running' }));
    return { settings, frames, checkpoints, terminalStage: 4 };
  }

  function crashJourney(frame, failure = 'power') {
    if (failure !== 'app' && failure !== 'power') throw new RangeError('Failure must be app or power');
    if (frame === null || typeof frame !== 'object' || Array.isArray(frame)) {
      throw new TypeError('Frame must be an object');
    }
    if (!Number.isInteger(frame.saveIndex) || frame.saveIndex < 1 || frame.saveIndex > 4) {
      throw new RangeError('Frame saveIndex must be an integer from 1 to 4');
    }
    return OSModel.crashSave(frame.saveIndex, failure);
  }

  return { buildJourney, crashJourney };
});
