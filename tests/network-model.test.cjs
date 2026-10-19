const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRun, idealDelay, createRealtime } = require('../assets/network-model.js');
const last = run => run.snapshots[run.snapshots.length - 1];

test('packetization accounts for payload and illustrative headers', () => {
  const small = buildRun({ payload: 300 });
  const large = buildRun({ payload: 1200 });
  assert.equal(small.count, 8); assert.equal(large.count, 2);
  assert.equal(small.originalWireBytes, 2400 + 8 * 40);
  assert.equal(large.originalWireBytes, 2400 + 2 * 40);
  assert(small.headerBytes > large.headerBytes);
});

test('one link serializes packets sequentially but propagation overlaps', () => {
  const run = buildRun({ propagation: 300 });
  assert.equal(run.packets[1].start, run.packets[0].end);
  assert(run.packets[1].start < run.packets[0].arrival);
  for (let i = 1; i < run.packets.length; i++) assert(run.packets[i].start >= run.packets[i - 1].end);
});

test('capacity changes serialization, distance changes propagation', () => {
  const base = buildRun({ kbps: 48, propagation: 60 });
  const fast = buildRun({ kbps: 96, propagation: 60 });
  const distant = buildRun({ kbps: 48, propagation: 160 });
  assert.equal(fast.serialization, base.serialization / 2);
  assert(Math.abs(distant.completeAt - base.completeAt - 100) < 1e-9);
  assert.equal(distant.serialization, base.serialization);
});

test('competing packets increase queueing, not link serialization time', () => {
  const quiet = buildRun({ competing: 0 });
  const busy = buildRun({ competing: 2 });
  assert.equal(quiet.serialization, busy.serialization);
  assert(busy.completeAt > quiet.completeAt);
});

test('TCP buffers out-of-order byte groups and releases them in order', () => {
  const run = buildRun({ reorder: true });
  assert(run.snapshots.some(s => s.buffered.includes(2) && !s.delivered.includes(2)));
  assert.deepEqual(last(run).delivered, [1, 2, 3, 4]);
  assert(run.complete);
});

test('UDP exposes datagrams in arrival order', () => {
  const run = buildRun({ transport: 'udp', reorder: true });
  assert.equal(last(run).delivered[0], 2);
  assert(run.snapshots.every(s => s.buffered.length === 0));
  assert(run.complete);
});

test('delaying A1 changes intermediate waits even when final totals match a quiet link', () => {
  const quiet = buildRun();
  const delayedTCP = buildRun({ reorder: true });
  const delayedUDP = buildRun({ reorder: true, transport: 'udp' });
  assert.equal(delayedTCP.completeAt, quiet.completeAt);
  assert.equal(delayedTCP.onTime, quiet.onTime);
  assert.equal(delayedUDP.completeAt, quiet.completeAt);
  assert.deepEqual(last(delayedTCP).received, [2, 3, 1, 4]);
  assert.deepEqual(last(delayedTCP).delivered, [1, 2, 3, 4]);
  const tcp = last(delayedTCP), udp = last(delayedUDP);
  assert(Math.abs(tcp.deliveryTimes[2] - tcp.arrivalTimes[2] - 80) < 1e-9);
  assert(tcp.deliveryTimes[3] > tcp.arrivalTimes[3]);
  for (const sequence of udp.delivered) assert.equal(udp.deliveryTimes[sequence], udp.arrivalTimes[sequence]);
  for (const sequence of last(quiet).delivered) assert.equal(last(quiet).deliveryTimes[sequence], last(quiet).arrivalTimes[sequence]);
});

test('one controlled TCP loss causes one retry, UDP loss does not', () => {
  const tcp = buildRun({ loss: true });
  const udp = buildRun({ transport: 'udp', loss: true });
  assert.equal(tcp.packets.filter(p => p.retry).length, 1);
  assert(tcp.complete); assert(!udp.complete);
  assert.equal(udp.completeAt, null);
  assert(!last(udp).delivered.includes(2));
  assert(tcp.onTime < udp.onTime);
  assert.equal(last(tcp).queue.length, 0); assert.equal(last(tcp).flying.length, 0);
});

test('retries join the busy queue rather than interrupting transmission', () => {
  const run = buildRun({ loss: true, competing: 2, kbps: 24, payload: 300 });
  const retry = run.packets.find(p => p.retry);
  const previous = run.packets[run.packets.length - 2];
  assert(retry.start >= previous.end);
  assert(run.snapshots.some(s => s.queue.includes('A2r')));
});

test('settings matrix preserves ordering, eventual modeled TCP completion, and loss accounting', () => {
  for (const payload of [300, 600, 1200]) for (const kbps of [24, 96, 192])
  for (const propagation of [20, 160, 300]) for (const competing of [0, 1, 2])
  for (const loss of [false, true]) for (const reorder of [false, true]) for (const transport of ['tcp', 'udp']) {
    const run = buildRun({ payload, kbps, propagation, competing, loss, reorder, transport });
    assert.equal(run.complete, transport === 'tcp' || !loss);
    assert.equal(last(run).delivered.length, run.count - (transport === 'udp' && loss ? 1 : 0));
    assert.equal(last(run).queue.length, 0); assert.equal(last(run).flying.length, 0);
    for (let i = 1; i < run.snapshots.length; i++) assert(run.snapshots[i].time >= run.snapshots[i - 1].time);
    if (transport === 'tcp') for (const snapshot of run.snapshots)
      assert.deepEqual(snapshot.delivered, Array.from({ length: snapshot.delivered.length }, (_, i) => i + 1));
  }
});

test('idealized transfer estimate uses bits, decimal kbit/s, and one-way delay', () => {
  assert.deepEqual(idealDelay(240, 96, 60), { serialization: 20, propagation: 60, total: 80 });
  assert.equal(idealDelay(240000, 96, 60).total, 20060);
});

test('polling queues all updates and delivers them at the next poll', () => {
  const demo = createRealtime('poll');
  demo.dispatch('tick'); demo.dispatch('update'); demo.dispatch('update');
  assert.equal(demo.state.browserVersion, 0);
  for (let i = 0; i < 4; i++) demo.dispatch('tick');
  assert.equal(demo.state.browserVersion, 2);
  assert.equal(demo.state.delivered.length, 2);
  assert.equal(demo.state.delivered[0].received - demo.state.delivered[0].created, 4);
  assert.equal(demo.state.requests, 2);
  demo.dispatch('send'); assert.equal(demo.state.requests, 3);
});

test('SSE streams server events but client messages use HTTP POST', () => {
  const demo = createRealtime('sse');
  demo.dispatch('update'); assert.equal(demo.state.browserVersion, 1);
  assert.equal(demo.state.requests, 1);
  demo.dispatch('send'); assert.equal(demo.state.requests, 2);
});

test('WebSocket messaging is bidirectional after one opening handshake', () => {
  const demo = createRealtime('ws');
  demo.dispatch('update'); demo.dispatch('send');
  assert.equal(demo.state.requests, 1);
  assert.equal(demo.state.browserVersion, 1);
  assert.equal(demo.state.browserMessages, 1);
});

test('all Section 5 presets match independently derived expectations on both transports', () => {
  const cases = [
    { settings: {}, arrivals: [113.333333,166.666667,220,273.333333], order: [1,2,3,4], tcpWait: [0,0,0,0], tcpEnd: 273.333333, tcpAudio: 4, udpAudio: 4 },
    { settings: { competing: 1 }, arrivals: [113.333333,220,326.666667,433.333333], order: [1,2,3,4], tcpWait: [0,0,0,0], tcpEnd: 433.333333, tcpAudio: 4, udpAudio: 4 },
    { settings: { propagation: 300 }, arrivals: [353.333333,406.666667,460,513.333333], order: [1,2,3,4], tcpWait: [0,0,0,0], tcpEnd: 513.333333, tcpAudio: 3, udpAudio: 3 },
    { settings: { loss: true }, arrivals: [113.333333,1220,220,273.333333], order: [1,3,4,2], tcpWait: [0,0,1000,946.666667], tcpEnd: 1220, tcpAudio: 1, udpAudio: 3 },
    { settings: { reorder: true }, arrivals: [246.666667,166.666667,220,273.333333], order: [2,3,1,4], tcpWait: [0,80,26.666667,0], tcpEnd: 273.333333, tcpAudio: 4, udpAudio: 4 },
    { settings: { kbps: 48, propagation: 100, competing: 2, loss: true }, arrivals: [206.666667,1633.333333,846.666667,1166.666667], order: [1,3,4,2], tcpWait: [0,0,786.666667,466.666667], tcpEnd: 1633.333333, tcpAudio: 1, udpAudio: 1 }
  ];
  const near = (actual, expected) => assert(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`);
  for (const fixture of cases) for (const transport of ['tcp','udp']) {
    const run = buildRun({ ...fixture.settings, transport }), snapshot = last(run);
    const missing = transport === 'udp' && fixture.settings.loss;
    const arrivals = fixture.order.filter(n => !(missing && n === 2));
    assert.deepEqual(snapshot.received, arrivals);
    assert.deepEqual(snapshot.delivered, transport === 'tcp' ? [1,2,3,4] : arrivals);
    assert.equal(run.onTime, transport === 'tcp' ? fixture.tcpAudio : fixture.udpAudio);
    if (missing) assert.equal(run.completeAt, null); else near(run.completeAt, fixture.tcpEnd);
    for (const n of arrivals) {
      near(snapshot.arrivalTimes[n], fixture.arrivals[n - 1]);
      near(snapshot.deliveryTimes[n] - snapshot.arrivalTimes[n], transport === 'tcp' ? fixture.tcpWait[n - 1] : 0);
    }
  }
});

test('guided conversation preserves message text, timing and request counts across protocols', () => {
  const actions = { 1: ['update','Your order is ready.'], 2: ['send','Please add a receipt.'], 6: ['update','Receipt added.'], 7: ['send','I’ll collect it soon.'] };
  for (const mode of ['poll','sse','ws']) {
    const demo = createRealtime(mode);
    for (let second = 1; second <= 10; second++) {
      demo.dispatch('tick');
      if (actions[second]) demo.dispatch(...actions[second]);
      if (second === 1) {
        assert.equal(demo.state.delivered.length, mode === 'poll' ? 0 : 1);
        assert.equal(demo.state.pending.length, mode === 'poll' ? 1 : 0);
        assert.equal(demo.state.events.at(-1).flow, mode === 'poll' ? 'queued' : 'to-browser');
      }
      if (second === 2) assert.equal(demo.state.events.at(-1).flow, 'to-server');
    }
    assert.deepEqual(demo.state.delivered.map(m => m.text), ['Your order is ready.','Receipt added.']);
    assert.deepEqual(demo.state.sent.map(m => m.text), ['Please add a receipt.','I’ll collect it soon.']);
    assert.deepEqual(demo.state.delivered.map(m => m.received - m.created), mode === 'poll' ? [4,4] : [0,0]);
    assert.equal(demo.state.requests, { poll: 5, sse: 3, ws: 1 }[mode]);
  }
});

test('custom message content survives queuing and replay without changing earlier records', () => {
  const demo = createRealtime('poll');
  demo.dispatch('update','<b>A literal message</b>');
  const original = { ...demo.state.pending[0] };
  for (let i = 0; i < 5; i++) demo.dispatch('tick');
  assert.equal(demo.state.delivered[0].text, '<b>A literal message</b>');
  assert.deepEqual(demo.state.updates[0], original);
  assert.equal(demo.state.delivered[0].received, 5);
});

test('invalid settings fail explicitly', () => {
  assert.throws(() => buildRun({ payload: 0 }), RangeError);
  assert.throws(() => buildRun({ kbps: Infinity }), RangeError);
  assert.throws(() => buildRun({ transport: 'magic' }), RangeError);
  assert.throws(() => idealDelay(10, 0, 0), RangeError);
  assert.throws(() => createRealtime('magic'), RangeError);
  assert.throws(() => createRealtime('poll').dispatch('magic'), RangeError);
});
