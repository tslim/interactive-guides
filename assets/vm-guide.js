/* Focused local teaching simulation, extracted from the OS guide.
   No OS operations, file access, or virtualization APIs are used. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let environment = 'native';

  // Conceptual file-request layers, not a universal hypervisor topology or
  // a claim that ordinary CPU instructions traverse all these components.
  function vmFrames(kind) {
    if (kind === 'vm') return [
      ['Guest application', 'This app is PID 42 in the guest OS, alongside the guest’s own init process. These PIDs are managed by the guest kernel, not renamed host PIDs. Its file read enters that guest kernel—not directly the host’s filesystem.'],
      ['Guest kernel', 'The guest’s own kernel manages processes and its filesystem using the VM’s assigned virtual CPUs and RAM. It checks access and interprets the guest filesystem on the virtual disk.'],
      ['Virtual device', 'A virtual disk request crosses into the virtualization machinery. This is the modeled virtual-device path, not passthrough.'],
      ['Hypervisor / hosting support', 'Virtualization and device-model support arrange the underlying host-side I/O. Hardware-assisted guest CPU execution need not emulate every instruction.'],
      ['Host driver', 'A host-side driver handles the eventual physical device request in this example.'],
      ['Physical hardware', 'Guest work ultimately uses real CPU time, RAM, and devices, shared with other workloads.']
    ];
    return kind === 'container' ? [
      ['Container process', 'The host sees PID 2417; inside its private PID namespace, this same app is PID 1. Its mount view has a container root and chosen mounts. Namespaces change what it sees; the configured cgroup caps CPU and memory use.'],
      ['Shared hosting kernel', 'Despite those private views, system calls enter the same hosting kernel used by native processes and other ordinary containers. There is no guest kernel in the container.'],
      ['Host driver', 'The kernel and its drivers service permitted device requests.'],
      ['Physical hardware', 'Configured resource controls can limit use; the container does not create another physical machine.']
    ] : [
      ['Application process', 'In this example the app is PID 2417 in the host process namespace and uses the host mount view. Its address space and access permissions still isolate it from other processes. A file read requests OS services through a system call.'],
      ['Host kernel', 'The host OS validates the request and manages its filesystem and resources.'],
      ['Host driver', 'A driver submits the needed device work.'],
      ['Physical hardware', 'The device performs the work. Cache hits could avoid this device path.']
    ];
  }

  // One request with reversible event playback, not a second navigation system.
  function player(initialFrames, draw) {
    const previous = $('vm-player-previous'), play = $('vm-player-play'), next = $('vm-player-next');
    let frames = initialFrames, position = 0, timer = null;
    function controls() {
      play.textContent = timer === null ? (position === frames.length - 1 ? 'Replay' : 'Play') : 'Pause';
      play.setAttribute('aria-pressed', String(timer !== null));
      previous.disabled = position === 0;
      next.disabled = position === frames.length - 1;
      $('vm-player-count').textContent = 'Event ' + (position + 1) + ' of ' + frames.length;
      $('vm-player-progress').max = frames.length;
      $('vm-player-progress').value = position + 1;
    }
    function pause() {
      clearInterval(timer);
      timer = null;
      controls();
    }
    function paint() {
      if (position === frames.length - 1) pause();
      controls();
      draw(frames[position], position);
    }
    function restart() { pause(); position = 0; paint(); }
    play.addEventListener('click', () => {
      if (timer !== null) { pause(); return; }
      if (position === frames.length - 1) restart();
      timer = setInterval(() => { position += 1; paint(); }, 1700);
      controls();
    });
    previous.addEventListener('click', () => {
      pause();
      position = Math.max(position - 1, 0);
      paint();
    });
    next.addEventListener('click', () => {
      pause();
      position = Math.min(position + 1, frames.length - 1);
      paint();
    });
    $('vm-player-reset').addEventListener('click', restart);
    paint();
    return {
      pause,
      replace(nextFrames) { frames = nextFrames; restart(); }
    };
  }

  const buttons = [...document.querySelectorAll('[data-environment]')];
  const stacks = [...document.querySelectorAll('[data-stack]')];
  const vm = player(vmFrames(environment), (frame, index) => {
    $('vm-heading').textContent = frame[0];
    $('vm-description').textContent = frame[1];
    $('vm-result').hidden = true;
    $('vm-route').dataset.event = String(index + 1);
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.environment === environment)));
    stacks.forEach(stack => {
      const selected = stack.dataset.stack === environment;
      stack.hidden = !selected;
      stack.querySelectorAll('.layer').forEach((layer, i) => {
        layer.dataset.phase = selected && i < index ? 'visited' : selected && i === index ? 'current' : 'upcoming';
        if (selected && i === index) {
          layer.setAttribute('aria-current', 'step');
          $('vm-event-icon').setAttribute('href', layer.querySelector('.layer-icon use').getAttribute('href'));
          $('vm-domain-label').textContent = layer.closest('.stack-scope').querySelector('.scope-label').textContent;
        } else layer.removeAttribute('aria-current');
      });
    });
    $('vm-kernel-label').textContent = environment === 'vm' ? 'Simulate guest-kernel crash' : 'Simulate host-kernel crash';
  });
  function selectEnvironment(kind) {
    environment = kind;
    vm.replace(vmFrames(environment));
  }
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => selectEnvironment(button.dataset.environment));
    button.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
      selectEnvironment(buttons[next].dataset.environment); buttons[next].focus({ preventScroll: true });
    });
  });

  function crashEnvironment(kernelCrash) {
    vm.pause();
    $('vm-result').hidden = false;
    $('vm-result-text').textContent = !kernelCrash && environment === 'container'
      ? 'Simulated application crash: this app is PID 1 in the container’s private PID namespace. Its exit also terminates any remaining processes in that namespace. The hosting kernel and other isolated workloads can continue; shared dependencies can still be affected.'
      : !kernelCrash
        ? 'Simulated application crash: this process stops. Its kernel and other isolated processes can continue; shared services or application dependencies can still be affected.'
      : environment === 'vm'
        ? 'Simulated guest-kernel crash: this guest and its applications stop. The host and other guests can continue under the intended isolation boundary. This is not a hypervisor crash; a hypervisor or hosting-infrastructure failure can affect multiple guests.'
        : 'Simulated hosting-kernel crash: the host stops normal operation, affecting native processes and ordinary containers sharing this kernel. Container isolation does not supply a separate kernel.';
  }
  $('vm-app-crash').addEventListener('click', () => crashEnvironment(false));
  $('vm-kernel-crash').addEventListener('click', () => crashEnvironment(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) vm.pause(); });
  window.addEventListener('pagehide', () => vm.pause());
  window.addEventListener('beforeprint', () => vm.pause());
  document.documentElement.classList.add('vm-ready');
})();
