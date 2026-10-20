/* One transfer, five teaching checkpoints. The event inspector uses the same
   NetworkModel run as the scene and application result, never separate presets. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!window.NetworkModel) { $('model-error').hidden = false; return; }
  const model = window.NetworkModel;
  const panels = [...document.querySelectorAll('[data-journey-step]')];
  const links = [...document.querySelectorAll('[data-step]')];
  const names = ['Make packets', 'Wait your turn', 'Cross the link', 'Receive the data', 'Use the data'];
  const format = n => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
  let stage = 0, run, positions, inspected, timer = null;
  function settings() {
    return { payload: Number($('payload').value), kbps: Number($('capacity').value), propagation: Number($('propagation').value), competing: Number($('competing').value), loss: $('loss').checked, reorder: $('reorder').checked, transport: $('transport').value };
  }
  function chip(id, className = '') {
    const node = document.createElement('span');
    node.className = 'packet ' + (id.startsWith('B') ? 'background ' : '') + className;
    node.textContent = id;
    node.title = id.endsWith('r') ? 'Retransmission of A2’s data' : id.startsWith('B') ? 'Other traffic' : 'Your data group ' + id.slice(1);
    return node;
  }
  function tray(id, packets, empty, className = '') {
    const node = $(id), previous = new Set([...node.querySelectorAll('.packet')].map(packet => packet.textContent));
    node.replaceChildren();
    if (packets.length) packets.forEach(packet => node.append(chip(packet, className + (previous.has(packet) ? '' : ' packet-enter'))));
    else { const text = document.createElement('span'); text.className = 'empty'; text.textContent = empty; node.append(text); }
  }
  function syncPlayback() {
    const finished = run && positions && positions[stage] === run.snapshots.length - 1;
    $('event-play').textContent = timer ? 'Pause' : finished ? 'Replay transfer' : inspected?.[stage] && positions[stage] > 0 ? 'Resume' : 'Play transfer';
    $('event-play').setAttribute('aria-pressed', String(Boolean(timer)));
  }
  function stop() {
    clearInterval(timer); timer = null; syncPlayback();
  }
  function rebuild() {
    stop(); run = model.buildRun(settings());
    const crossing = run.snapshots.findIndex(snapshot => snapshot.event?.type === 'send' && snapshot.event.packet.id !== 'A1');
    const gap = run.snapshots.findIndex(snapshot => snapshot.buffered.length > 0);
    positions = [0, 0, Math.max(1, crossing), gap >= 0 ? gap : run.snapshots.length - 1, run.snapshots.length - 1];
    inspected = [false, false, false, false, false];
    render();
  }
  function eventText(snapshot) {
    const event = snapshot.event;
    if (!event) return ['Packets wait for their turn.', 'The burst is at the router. Only one packet can transmit at a time.'];
    const packet = event.packet, label = packet.id;
    if (event.type === 'send') return [label + ' starts transmission.', 'Bits enter the link. Queued packets wait; earlier packets keep travelling.'];
    if (event.type === 'depart') return [label + ' is now travelling.', 'Its last bit left the router. The link can start the next packet.'];
    if (event.type === 'drop') return ['A2’s first attempt is lost.', run.settings.transport === 'tcp' ? 'These bytes do not arrive. The toy TCP timer schedules a retry.' : 'Bare UDP does not retry. This application adds no recovery.'];
    if (event.type === 'retry') return ['A2 joins the queue again.', 'The toy retry timer expired. A2r carries the same data, not new content.'];
    if (packet.owner === 'B') return [label + ' reaches its own receiver.', 'B shared the link but belongs to a different application.'];
    if (run.settings.transport === 'udp') return [label + ' reaches the application.', 'This datagram is available immediately. The app must handle gaps and ordering.'];
    if (snapshot.buffered.includes(packet.sequence)) return [label + ' arrived, but must wait.', 'An earlier data group is missing. TCP holds these bytes until the gap closes.'];
    return [label + ' closes the next gap.', 'Consecutive bytes, including any buffered pieces after the gap, reach the application in order.'];
  }
  function renderScene() {
    const position = positions[stage], snapshot = run.snapshots[position];
    const finished = position === run.snapshots.length - 1;
    const receiver = $('lane-receiver'), scene = receiver.parentElement;
    receiver.hidden = stage < 3;
    $('lane-sender').hidden = stage !== 0;
    $('lane-link').hidden = stage < 2;
    // Keep DOM/read order aligned with the teaching focus, not just CSS order.
    const receiverNext = stage >= 3 ? $('lane-sender') : scene.querySelector('figcaption');
    if (receiver.nextElementSibling !== receiverNext) scene.insertBefore(receiver, receiverNext);
    tray('sender', stage === 0 ? Array.from({ length: run.count }, (_, i) => 'A' + (i + 1)) : [], 'Burst already at the router');
    tray('queue', stage === 0 ? [] : snapshot.queue, stage === 0 ? 'Packets reach the router in the next step.' : 'Queue empty');
    tray('flying', snapshot.flying, 'No packets in transit');
    tray('buffer', snapshot.buffered.map(n => 'A' + n), run.settings.transport === 'udp' ? 'No transport ordering buffer' : 'Nothing buffered', 'buffered');
    tray('delivered', snapshot.delivered.map(n => 'A' + n), 'No data available yet', 'delivered');
    $('sender-note').textContent = run.count + ' pieces × ' + format(run.settings.payload) + ' B payload, plus headers';
    $('transmitting').textContent = snapshot.transmitting ? snapshot.transmitting + ' · ' + format(run.serialization) + ' ms to transmit all its bits' : stage < 2 ? 'No transmission yet' : 'Link idle';
    $('scene-phase').textContent = inspected[stage] ? 'Inspecting a packet event' : names[stage];
    ['sender', 'queue', 'link', 'receiver'].forEach((name, index) => $('lane-' + name).classList.toggle('active', index === Math.min(stage, 3)));
    $('metric-time').textContent = format(snapshot.time) + ' ms';
    $('metric-received').textContent = format(snapshot.received.length * run.settings.payload) + ' / 2,400 B';
    $('metric-data').textContent = format(snapshot.delivered.length * run.settings.payload) + ' / 2,400 B';
    $('transfer-progress').value = snapshot.delivered.length * run.settings.payload;
    $('lost-state').textContent = 'Lost attempts: ' + (snapshot.dropped.length ? 'A2' + (snapshot.received.includes(2) ? ' · recovered' : ' · not recovered yet') : 'none');
    let [title, description] = eventText(snapshot);
    if (stage === 0) { title = 'One message, ' + run.count + ' pieces.'; description = 'The same numbered payload pieces stay with us through this journey. Headers repeat for every packet.'; }
    if (stage === 4 && finished) { title = run.complete ? 'All 2,400 bytes are available.' : 'A2 is still missing.'; description = run.complete ? 'Now check whether completeness or timely playback matters to the app.' : 'The transfer ended without all the data. Bare UDP provides no built-in retransmission.'; }
    $('event-number').textContent = stage < 2 ? 'Before transmission' : 'Event ' + position + ' / ' + (run.snapshots.length - 1) + ' · ' + format(snapshot.time) + ' ms';
    $('event-title').textContent = title; $('event-description').textContent = description;
    $('transfer-controls').hidden = stage < 2;
    $('event-inspector').hidden = stage < 2;
    $('event-back').disabled = position === 0;
    $('event-next').disabled = finished; $('event-finish').disabled = finished;
    $('event-status').textContent = 'Event ' + position + ' of ' + (run.snapshots.length - 1) + '. ' + (finished ? 'Final event.' : title);
    if (finished) stop(); else syncPlayback();
    $('arrival-order').textContent = snapshot.received.map(n => 'A' + n).join(' → ') || 'None yet';
    $('release-order').textContent = snapshot.delivered.map(n => 'A' + n).join(' → ') || 'None yet';
    document.documentElement.style.setProperty('--network-dashboard-height', dashboard.getBoundingClientRect().height + 'px');
  }
  function renderPackets() {
    $('packet-batch').replaceChildren();
    for (let n = 1; n <= run.count; n++) {
      const piece = document.createElement('div'); piece.className = 'packet-piece';
      const strip = document.createElement('div'); strip.className = 'packet-strip'; strip.setAttribute('aria-hidden', 'true');
      const header = document.createElement('span'); header.className = 'packet-header'; header.style.width = model.HEADER_BYTES / (model.HEADER_BYTES + run.settings.payload) * 100 + '%';
      const payload = document.createElement('span'); payload.className = 'packet-payload'; strip.append(header, payload);
      const label = document.createElement('span'); label.textContent = 'A' + n + ' · 40 B + ' + format(run.settings.payload) + ' B';
      piece.append(strip, label); $('packet-batch').append(piece);
    }
    $('overhead-label').textContent = '2,400 B payload + ' + format(run.headerBytes) + ' B headers = ' + format(run.originalWireBytes) + ' B. Excludes B traffic and retries.';
  }
  function renderExplanations() {
    const current = run.settings;
    const background = (run.count - 1) * current.competing;
    $('queue-summary').textContent = run.count + ' A packets + ' + background + ' B packets queued. Last original A packet waits ' + format(run.packets.find(packet => packet.id === 'A' + run.count).start) + ' ms before transmission.';
    $('capacity-value').textContent = current.kbps + ' kbit/s'; $('propagation-value').textContent = current.propagation + ' ms';
    $('capacity').setAttribute('aria-valuetext', current.kbps + ' kilobits per second');
    $('propagation').setAttribute('aria-valuetext', current.propagation + ' milliseconds one-way propagation');
    $('link-breakdown').textContent = format(current.payload + model.HEADER_BYTES) + ' B × 8 ÷ ' + current.kbps + ' kbit/s = ' + format(run.serialization) + ' ms to transmit. Then ' + current.propagation + ' ms of one-way travel.';
    for (const [id, label, bytes] of [['small-delay', 'Tiny reply (240 B)', 240], ['large-delay', 'Small file (240,000 B)', 240000]]) {
      const delay = model.idealDelay(bytes, current.kbps, current.propagation);
      $(id).textContent = label + ': ' + format(delay.serialization) + ' ms transmission + ' + format(delay.propagation) + ' ms travel = ' + format(delay.total) + ' ms.';
    }
    $('delivery-description').textContent = current.transport === 'tcp' ? 'TCP delivers ordered bytes. Later pieces may have arrived but wait for earlier bytes.' + (current.loss ? ' A2 is lost once; inspect events to follow its retry, or continue to the final outcome.' : current.reorder ? ' Here A1 arrives late. Inspect the waiting pieces beside it.' : ' Try losing A2 or delaying A1 to see a gap.') : 'Bare UDP makes each received datagram available without waiting for earlier ones. This app adds no recovery or reordering.' + (current.loss ? ' A2 remains missing, but later datagrams still reach the app.' : ' Try loss or delay to compare arrival and release.');
  }
  function renderApplication() {
    const position = stage === 4 ? positions[4] : run.snapshots.length - 1;
    const snapshot = run.snapshots[position], finished = position === run.snapshots.length - 1;
    const audio = $('app-kind').value === 'audio', complete = snapshot.delivered.length === run.count;
    const onTime = run.deadlines.filter((deadline, index) => snapshot.deliveryTimes[index + 1] !== undefined && snapshot.deliveryTimes[index + 1] <= deadline).length;
    const result = $('app-result'); result.replaceChildren();
    const heading = document.createElement('h3'), text = document.createElement('p');
    if (!audio) {
      heading.textContent = (complete ? 'File complete' : finished ? 'File incomplete' : 'Receiving file') + ' · ' + format(snapshot.delivered.length * run.settings.payload) + ' / 2,400 B';
      text.textContent = complete ? 'All data is available by ' + format(run.completeAt) + ' ms.' + (run.settings.transport === 'udp' ? ' Application code must still arrange the datagrams in order.' : '') : finished ? 'A2 is missing. The application cannot complete this file without adding recovery.' : 'The application is still waiting for data. Follow the counters as packets arrive and bytes become available.';
    } else {
      heading.textContent = 'Audio · ' + onTime + ' / ' + run.count + ' chunks on time' + (finished ? '' : ' so far');
      text.textContent = 'Each chunk must be available to the application by its deadline. Late or missing chunks miss playback in this toy burst.';
    }
    result.append(heading, text);
    if (audio) {
      const slots = document.createElement('div'); slots.className = 'media-slots';
      run.deadlines.forEach((deadline, index) => {
        const time = snapshot.deliveryTimes[index + 1], onTime = time !== undefined && time <= deadline;
        const pending = time === undefined && !finished && snapshot.time < deadline;
        const slot = document.createElement('span'); slot.className = 'media-slot' + (pending ? ' pending' : onTime ? '' : ' missed');
        slot.textContent = 'A' + (index + 1) + ' · ' + (pending ? 'waiting' : onTime ? 'on time' : time === undefined ? (finished ? 'missing' : 'deadline missed') : 'late');
        const timing = document.createElement('small');
        timing.textContent = 'Due ' + deadline + ' ms; ' + (time === undefined ? (finished ? 'never available' : 'not available yet') : 'app-ready at ' + format(time) + ' ms');
        slot.append(timing); slots.append(slot);
      });
      result.append(slots);
    }
    $('outcome-transport').textContent = run.settings.transport === 'tcp' ? 'TCP-style ordered stream' : 'Bare UDP-style datagrams';
    $('outcome-loss').textContent = run.settings.loss ? 'On · lose A2 once' : 'Off';
    $('outcome-reorder').textContent = run.settings.reorder ? 'On · delay A1' : 'Off';
    $('outcome-settings').textContent = 'Link settings: ' + format(run.settings.payload) + '-byte payloads · ' + run.settings.kbps + ' kbit/s · ' + run.settings.propagation + ' ms one-way travel · ' + run.settings.competing + ' B between A packets.';
  }
  function render() {
    panels.forEach((panel, index) => { panel.hidden = stage !== index; });
    links.forEach((link, index) => { if (stage === index) link.setAttribute('aria-current', 'step'); else link.removeAttribute('aria-current'); });
    $('journey-position').textContent = (stage + 1) + ' / 5';
    $('journey-status').textContent = 'Step ' + (stage + 1) + ' of 5 · ' + names[stage] + '. Changes update this same transfer.';
    $('previous').disabled = stage === 0; $('next').disabled = stage === 4;
    $('next').textContent = stage === 4 ? 'Journey complete' : 'Next step →';
    renderScene(); renderPackets(); renderExplanations(); renderApplication();
    window.GuidePresentation?.refresh();
  }
  function show(index, { focus = false, scroll = false, hash = true } = {}) {
    if (index < 0 || index >= panels.length) return;
    stop(); stage = index; render();
    const link = links[stage], strip = link.parentElement.getBoundingClientRect(), box = link.getBoundingClientRect();
    if (box.left < strip.left) link.parentElement.scrollLeft -= strip.left - box.left;
    else if (box.right > strip.right) link.parentElement.scrollLeft += box.right - strip.right;
    if (hash && location.hash !== '#' + panels[stage].id) {
      try { history.pushState(null, '', '#' + panels[stage].id); } catch { location.hash = panels[stage].id; }
    }
    if (focus) panels[stage].querySelector('h2').focus({ preventScroll: true });
    if (scroll) (focus && matchMedia('(max-width: 760px)').matches ? panels[stage] : $('journey')).scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  links.forEach((link, index) => {
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); show(index, { focus: true, scroll: true });
    });
    link.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 4 : (index + (event.key === 'ArrowRight' ? 1 : 4)) % 5;
      show(next); links[next].focus({ preventScroll: true });
    });
  });
  $('previous').addEventListener('click', () => show(stage - 1, { focus: true, scroll: true }));
  $('next').addEventListener('click', () => show(stage + 1, { focus: true, scroll: true }));
  ['payload', 'competing', 'transport', 'loss', 'reorder'].forEach(id => $(id).addEventListener('change', rebuild));
  ['capacity', 'propagation'].forEach(id => $(id).addEventListener('input', rebuild));
  $('app-kind').addEventListener('change', renderApplication);
  $('replay').addEventListener('click', () => {
    stop();
    for (const [id, value] of Object.entries({ payload: '600', competing: '0', capacity: '96', propagation: '60', transport: 'tcp', 'app-kind': 'file' })) $(id).value = value;
    $('loss').checked = false; $('reorder').checked = false; $('route-failure').checked = false; renderRoute();
    rebuild(); show(0, { focus: true, scroll: true });
  });
  function inspect(position) {
    positions[stage] = Math.max(0, Math.min(run.snapshots.length - 1, position)); inspected[stage] = true;
    renderScene(); if (stage === 4) renderApplication();
  }
  $('event-back').addEventListener('click', () => { stop(); inspect(positions[stage] - 1); });
  $('event-next').addEventListener('click', () => { stop(); inspect(positions[stage] + 1); });
  $('event-finish').addEventListener('click', () => { stop(); inspect(run.snapshots.length - 1); });
  $('event-reset').addEventListener('click', () => { stop(); inspect(0); });
  $('event-play').addEventListener('click', () => {
    if (timer) { stop(); return; }
    if (!inspected[stage] || positions[stage] === run.snapshots.length - 1) inspect(0);
    timer = setInterval(() => inspect(positions[stage] + 1), 800);
    syncPlayback();
    if (matchMedia('(max-width: 760px)').matches) document.querySelector('.scene').scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', stop);
  // A printed article exposes every stage; use its final snapshot consistently.
  window.addEventListener('beforeprint', () => {
    stop(); const previousStage = stage, previousPosition = positions[4]; stage = 4; positions[4] = run.snapshots.length - 1;
    renderScene(); renderApplication(); $('scene-phase').textContent = 'Final transfer snapshot · print';
    stage = previousStage; positions[4] = previousPosition;
  });
  window.addEventListener('afterprint', () => { renderScene(); renderApplication(); });
  function renderRoute() {
    const failed = $('route-failure').checked;
    $('primary-route').setAttribute('class', 'edge ' + (failed ? 'unused' : 'chosen'));
    $('alternate-route').setAttribute('class', 'edge ' + (failed ? 'chosen' : 'unused'));
    $('failed-link').toggleAttribute('hidden', !failed);
    $('route-status').textContent = (failed ? 'Routes have adapted: new packets use the alternate provider.' : 'The primary route is selected.') + ' This separate topology illustration does not change the transfer’s timings.';
  }
  $('route-failure').addEventListener('change', renderRoute);
  function followHash(initial = false) {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { id = ''; }
    if (id === 'realtime') { location.replace('how-live-messages-work.html#realtime'); return; }
    const aliases = { experiment: 'link', 'experiment-title': 'link-title', 'routes-title': 'routes', 'delay-title': 'delay' };
    const target = document.getElementById(aliases[id] || id), panel = target?.closest('[data-journey-step]');
    const index = !id || id === 'journey' ? 0 : panel ? panels.indexOf(panel) : -1;
    if (index < 0) { if (initial) show(0, { hash: false }); return; }
    show(index, { hash: false });
    if (target && panel) for (let parent = target; parent && parent !== panel; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
    if (!initial) $('journey').scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  window.addEventListener('hashchange', () => followHash()); window.addEventListener('popstate', () => followHash());
  const nav = document.querySelector('.journey-nav');
  new ResizeObserver(() => document.documentElement.style.setProperty('--network-nav-height', nav.getBoundingClientRect().height + 'px')).observe(nav);
  const dashboard = document.querySelector('.transfer-dashboard');
  new ResizeObserver(() => document.documentElement.style.setProperty('--network-dashboard-height', dashboard.getBoundingClientRect().height + 'px')).observe(dashboard);
  rebuild(); document.documentElement.classList.add('ready'); followHash(true);
})();
