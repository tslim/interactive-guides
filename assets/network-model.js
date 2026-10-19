/* Deterministic teaching model: one store-and-forward output queue.
   No real traffic, congestion window, ACK traffic, MTU discovery, or adaptive RTO.
   Shared by the browser guide and dependency-free Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NetworkModel = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const MESSAGE_BYTES = 2400;
  const HEADER_BYTES = 40;

  function validate(options) {
    const result = Object.assign({ payload: 600, kbps: 96, propagation: 60, competing: 0, loss: false, reorder: false, transport: 'tcp' }, options);
    if (![300, 600, 1200].includes(result.payload)) throw new RangeError('Unsupported payload size');
    if (!Number.isFinite(result.kbps) || result.kbps < 24 || result.kbps > 192) throw new RangeError('Capacity must be 24–192 kbit/s');
    if (!Number.isFinite(result.propagation) || result.propagation < 20 || result.propagation > 300) throw new RangeError('Propagation must be 20–300 ms');
    if (![0, 1, 2].includes(result.competing)) throw new RangeError('Competing packets must be 0, 1, or 2');
    if (!['tcp', 'udp'].includes(result.transport)) throw new RangeError('Unknown transport');
    result.loss = Boolean(result.loss); result.reorder = Boolean(result.reorder);
    return result;
  }

  function buildRun(options) {
    const settings = validate(options);
    const count = MESSAGE_BYTES / settings.payload;
    const serialization = (settings.payload + HEADER_BYTES) * 8 / settings.kbps;
    const packets = [], events = [];
    let linkFree = 0, background = 0;
    function schedule(id, sequence, owner, ready, retry) {
      const start = Math.max(ready, linkFree);
      const end = start + serialization;
      const extra = settings.reorder && sequence === 1 && owner === 'A' && !retry ? serialization * (settings.competing + 1) + 80 : 0;
      const arrival = end + settings.propagation + extra;
      const packet = { id, sequence, owner, retry, start, end, arrival, payload: settings.payload,
        dropped: settings.loss && owner === 'A' && sequence === 2 && !retry };
      packets.push(packet); linkFree = end;
      events.push({ time: start, type: 'send', packet }, { time: end, type: 'depart', packet },
        { time: arrival, type: packet.dropped ? 'drop' : 'arrive', packet });
      return packet;
    }
    for (let sequence = 1; sequence <= count; sequence++) {
      schedule('A' + sequence, sequence, 'A', 0, false);
      if (sequence < count) {
        for (let i = 0; i < settings.competing; i++) schedule('B' + (++background), background, 'B', 0, false);
      }
    }
    if (settings.loss && settings.transport === 'tcp') {
      const lost = packets.find(packet => packet.id === 'A2');
      const retryAt = lost.end + 1000;
      const retry = schedule('A2r', 2, 'A', retryAt, true);
      events.push({ time: retryAt, type: 'retry', packet: retry });
    }
    const priorities = { depart: 0, arrive: 1, drop: 1, retry: 2, send: 3 };
    events.sort((a, b) => a.time - b.time || priorities[a.type] - priorities[b.type] || a.packet.id.localeCompare(b.packet.id));
    const queue = packets.filter(packet => !packet.retry).map(packet => packet.id);
    let transmitting = null, nextByteGroup = 1;
    const flying = new Set(), received = new Map(), delivered = new Map(), dropped = new Set();
    const snapshots = [];
    function snapshot(time, event) {
      return { time, event, queue: queue.slice(), transmitting, flying: [...flying], received: [...received.keys()],
        arrivalTimes: Object.fromEntries(received), delivered: [...delivered.keys()], deliveryTimes: Object.fromEntries(delivered),
        buffered: [...received.keys()].filter(sequence => !delivered.has(sequence)), dropped: [...dropped] };
    }
    snapshots.push(snapshot(0, null));
    for (const event of events) {
      const packet = event.packet;
      if (event.type === 'retry') queue.push(packet.id);
      if (event.type === 'send') {
        const position = queue.indexOf(packet.id);
        if (position !== -1) queue.splice(position, 1);
        transmitting = packet.id;
      }
      if (event.type === 'depart') {
        transmitting = null; flying.add(packet.id);
      }
      if (event.type === 'drop' || event.type === 'arrive') {
        flying.delete(packet.id);
        if (event.type === 'drop') dropped.add(packet.sequence);
        else if (packet.owner === 'A' && !received.has(packet.sequence)) {
          received.set(packet.sequence, event.time);
          if (settings.transport === 'udp') delivered.set(packet.sequence, event.time);
          else while (received.has(nextByteGroup)) {
            delivered.set(nextByteGroup, event.time); nextByteGroup++;
          }
        }
      }
      snapshots.push(snapshot(event.time, event));
    }
    const last = snapshots[snapshots.length - 1];
    const complete = last.delivered.length === count;
    const completeAt = complete ? Math.max(...Object.values(last.deliveryTimes)) : null;
    const deadlines = Array.from({ length: count }, (_, index) => 300 + index * 150);
    const onTime = deadlines.filter((deadline, index) => delivered.has(index + 1) && delivered.get(index + 1) <= deadline).length;
    return { settings, count, packets, events, snapshots, serialization, complete, completeAt, deadlines, onTime,
      headerBytes: count * HEADER_BYTES, messageBytes: MESSAGE_BYTES,
      wireBytes: packets.length * (settings.payload + HEADER_BYTES),
      originalWireBytes: MESSAGE_BYTES + count * HEADER_BYTES };
  }

  function idealDelay(bytes, kbps, propagation) {
    if (![bytes, kbps, propagation].every(Number.isFinite) || bytes < 0 || kbps <= 0 || propagation < 0) throw new RangeError('Invalid delay inputs');
    const serialization = bytes * 8 / kbps;
    return { serialization, propagation, total: serialization + propagation };
  }

  function createRealtime(mode) {
    if (!['poll', 'sse', 'ws'].includes(mode)) throw new RangeError('Unknown real-time mode');
    const state = { mode, seconds: 0, serverVersion: 0, browserVersion: 0, requests: 0, serverUpdates: 0, browserMessages: 0,
      events: [], pending: [], delivered: [], sent: [], updates: [] };
    const log = (text, flow = 'idle', message = null) => state.events.push({ seconds: state.seconds, text, flow, message });
    if (mode === 'poll') { state.requests++; log('GET /updates → no new messages. Next poll at 5 s.', 'roundtrip'); }
    if (mode === 'sse') { state.requests++; log('GET /events → event stream opened.', 'open'); }
    if (mode === 'ws') { state.requests++; log('WebSocket opening handshake → two-way channel opened.', 'open'); }
    function dispatch(action, text) {
      if (action === 'update') {
        const message = { version: ++state.serverVersion, created: state.seconds, text: text || 'Server update ' + state.serverVersion };
        state.serverUpdates++; state.updates.push(message);
        if (mode === 'poll') {
          state.pending.push(message); log('Server creates update ' + message.version + '; waiting for a poll.', 'queued', message);
        } else {
          state.browserVersion = message.version;
          state.delivered.push({ ...message, received: state.seconds });
          log((mode === 'sse' ? 'SSE event' : 'WebSocket message') + ' → browser receives update ' + message.version + '.', 'to-browser', message);
        }
      } else if (action === 'send') {
        state.browserMessages++;
        const message = { version: state.browserMessages, created: state.seconds, text: text || 'Browser message ' + state.browserMessages };
        state.sent.push(message);
        if (mode !== 'ws') state.requests++;
        log(mode === 'ws' ? 'Browser → server: message on the WebSocket channel.' : 'Browser → server: separate POST /messages request.', 'to-server', message);
      } else if (action === 'tick') {
        state.seconds++;
        if (mode === 'poll' && state.seconds % 5 === 0) {
          state.requests++;
          const pending = state.pending.splice(0);
          state.delivered.push(...pending.map(message => ({ ...message, received: state.seconds })));
          if (pending.length) state.browserVersion = pending[pending.length - 1].version;
          log('GET /updates → ' + pending.length + ' new update(s). Next poll at ' + (state.seconds + 5) + ' s.', 'roundtrip', pending[pending.length - 1] || null);
        } else log('Clock advances to ' + state.seconds + ' s.');
      } else throw new RangeError('Unknown real-time action');
      return state;
    }
    return { state, dispatch };
  }
  return { MESSAGE_BYTES, HEADER_BYTES, buildRun, idealDelay, createRealtime };
});
