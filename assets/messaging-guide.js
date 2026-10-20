/* Standalone live-messaging story. All traffic is simulated locally. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!window.NetworkModel) { $('model-error').hidden = false; return; }
  const model = window.NetworkModel;

  let realtime = model.createRealtime('poll'), rtMode = 'poll', rtPosition = 0, rtTimer = null;
  function makeStory() {
    const messages = {
      1: { action: 'update', text: 'Your order is ready.' },
      2: { action: 'send', text: 'Please add a receipt.' },
      6: { action: 'update', text: 'Receipt added.' },
      7: { action: 'send', text: 'I’ll collect it soon.' }
    };
    return Array.from({ length: 11 }, (_, second) => ({ storySecond: second,
      actions: second === 0 ? [] : [{ action: 'tick' }, ...(messages[second] ? [messages[second]] : [])] }));
  }
  let rtFrames = makeStory();
  // Keep the same comparison moments for every pattern; still apply all ticks
  // between them so polling, queued updates, and request counts remain exact.
  function eventPositions() {
    return rtFrames.map((frame, index) => ({ frame, index })).filter(({ frame, index }) => index === 0 || frame.storySecond % 5 === 0 || frame.actions.some(action => action.action !== 'tick')).map(({ index }) => index);
  }
  function nextEvent() {
    return eventPositions().find(index => index > rtPosition) ?? rtFrames.length - 1;
  }
  function previousEvent() {
    return eventPositions().filter(index => index < rtPosition).at(-1) ?? 0;
  }
  const descriptions = {
    poll: 'Polling: ask every five seconds. Ready updates wait for the next request.',
    sse: 'SSE: the server pushes events. Your replies use separate HTTP requests.',
    ws: 'WebSocket: both sides send on one channel, without per-message HTTP requests.'
  };
  function updateRealtimeControls() {
    const finished = rtPosition === rtFrames.length - 1;
    $('rt-back').disabled = rtPosition === 0;
    $('rt-tick').disabled = finished;
    $('rt-play').textContent = rtTimer ? 'Pause' : finished ? 'Replay' : 'Play';
    $('rt-play').setAttribute('aria-pressed', String(Boolean(rtTimer)));
  }
  function stopRealtimePlayback() {
    clearInterval(rtTimer); rtTimer = null;
    updateRealtimeControls();
  }
  function icon(name) {
    const picture = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    picture.setAttribute('class', 'msg-icon'); picture.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#msg-icon-' + name); picture.append(use);
    return picture;
  }
  function inbox(id, messages, browserInbox) {
    const list = $(id); list.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement('li'); empty.className = 'empty';
      const text = document.createElement('span'); text.textContent = browserInbox ? 'No messages yet.' : 'No browser messages received yet.';
      empty.append(icon('chat'), text); list.append(empty); return;
    }
    messages.slice(-4).forEach(message => {
      const outgoing = browserInbox && message.direction === 'outgoing';
      const li = document.createElement('li'); li.className = 'message ' + (outgoing ? 'message-outgoing' : 'message-incoming');
      const head = document.createElement('div'); head.className = 'message-head';
      const sender = document.createElement('span'); sender.textContent = outgoing ? 'You' : browserInbox ? 'Shop' : 'Browser';
      const time = document.createElement('span'); time.textContent = (browserInbox && !outgoing ? message.received : message.created) + ' s';
      head.append(sender, time);
      const text = document.createElement('p'); text.className = 'message-text'; text.textContent = message.text;
      const when = document.createElement('small');
      when.textContent = browserInbox && !outgoing ? 'Created ' + message.created + ' s · received ' + message.received + ' s' + (message.received > message.created ? ' · waited ' + (message.received - message.created) + ' s' : '') : outgoing ? 'Sent to the shop' : 'Browser sent at ' + message.created + ' s';
      li.append(head, text, when); list.append(li);
    });
    list.scrollTop = list.scrollHeight;
  }
  function realtimeNarration(state, event) {
    const message = event.message ? '“' + event.message.text + '”' : 'the update';
    const nextPoll = 5 - state.seconds % 5;
    if (rtPosition === 0) return ['Open the conversation.', rtMode === 'poll' ? 'No updates yet. The shop has news at 1 s; your browser asks again at 5 s.' : 'Channel open. At 1 s, the shop sends news without another request.'];
    if (event.flow === 'queued') return ['News is waiting at the shop.', message + ' waits for the next poll in ' + nextPoll + ' s. Compare this moment with SSE or WebSocket.'];
    if (event.flow === 'to-browser') return [rtMode === 'sse' ? 'The server pushes an event.' : 'The server sends on the open channel.', message + ' reached your inbox without polling wait. Network transit is omitted.'];
    if (event.flow === 'to-server') return [rtMode === 'ws' ? 'Your reply uses the same channel.' : 'Your reply uses a separate HTTP POST.', 'The browser sends ' + message + ' to the shop.' + (rtMode === 'sse' ? ' The SSE stream still carries only server-to-browser events.' : rtMode === 'poll' ? ' This POST does not fetch the updates waiting for the next poll.' : ' Either side can send WebSocket messages without a new HTTP request.')];
    if (event.flow === 'roundtrip') return ['The browser asks again.', event.message ? 'Waiting updates reach your inbox. Compare creation and receipt times below.' : 'No updates, but polling still uses a request.'];
    if (event.flow === 'idle' && rtMode !== 'poll' && state.seconds % 5 === 0) return [state.seconds === 10 ? 'The conversation is complete.' : 'No new request needed.', 'Polling checks for updates now. This open channel already pushed the available news, without another request.'];
    return state.pending.length ? ['Still waiting for the next poll.', state.pending.length + ' update(s) are ready at the server. The browser asks again in ' + nextPoll + ' s.'] : ['Ready for another message.', 'Time passes without messages or requests. ' + (rtPosition === rtFrames.length - 1 ? 'Compare protocols or replay.' : 'Continue to the next event.')];
  }
  function renderRealtime() {
    realtime = model.createRealtime(rtMode);
    for (let i = 1; i <= rtPosition; i++) for (const action of rtFrames[i].actions) realtime.dispatch(action.action, action.text);
    const state = realtime.state;
    const event = state.events[state.events.length - 1];
    document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === rtMode)));
    $('rt-description').textContent = descriptions[rtMode];
    $('rt-browser').textContent = state.delivered.length + ' server update(s) received · ' + state.browserMessages + ' browser message(s) sent';
    $('rt-server').textContent = state.serverUpdates + ' shop update(s) created';
    // Order the local conversation by actual delivery/send events, not creation
    // time: a polled update created at 1 s must not appear before a reply at 2 s.
    const conversation = [
      ...state.delivered.map(message => ({ ...message, direction: 'incoming', order: state.events.findIndex(event => event.seconds === message.received && ((event.flow === 'to-browser' && event.message?.version === message.version) || event.flow === 'roundtrip')) })),
      ...state.sent.map(message => ({ ...message, direction: 'outgoing', order: state.events.findIndex(event => event.flow === 'to-server' && event.message?.version === message.version) }))
    ].sort((a, b) => a.order - b.order);
    inbox('rt-browser-inbox', conversation, true); inbox('rt-server-inbox', state.sent, false);
    $('rt-browser-count').textContent = String(Math.min(conversation.length, 4));
    $('rt-server-count').textContent = String(Math.min(state.sent.length, 4));
    $('rt-pending-count').textContent = String(state.pending.length);
    $('rt-channel-badge').textContent = rtMode === 'poll' ? (state.pending.length ? 'Waiting for poll' : 'Polling') : rtMode === 'sse' ? 'SSE open' : 'WebSocket open';
    $('rt-channel-badge').dataset.state = state.pending.length ? 'queued' : rtMode === 'poll' ? 'request' : 'open';
    $('rt-pending').classList.toggle('waiting', Boolean(state.pending.length));
    $('rt-pending').textContent = state.pending.length ? state.pending.length + ' update(s) waiting for the next poll.' : 'No updates waiting to be sent.';
    const queue = $('rt-queue-messages'); queue.hidden = state.pending.length === 0; queue.replaceChildren();
    state.pending.forEach(message => {
      const item = document.createElement('li'), text = document.createElement('span'), stamp = document.createElement('small');
      text.textContent = message.text; stamp.textContent = 'Update ' + message.version + ' · created ' + message.created + ' s · not delivered';
      item.append(text, stamp); queue.append(item);
    });
    $('rt-clock').textContent = state.seconds + ' s';
    $('rt-story-progress').value = state.seconds;
    $('rt-requests').textContent = String(state.requests);
    const delivered = state.delivered[state.delivered.length - 1];
    $('rt-wait').textContent = delivered ? (delivered.received - delivered.created) + ' s' : '—';
    const checkpoints = eventPositions();
    $('rt-step-label').textContent = 'Event ' + (checkpoints.indexOf(rtPosition) + 1) + ' of ' + checkpoints.length + ' · ' + state.seconds + ' s';
    const [title, description] = realtimeNarration(state, event);
    $('rt-event-title').textContent = title; $('rt-status').textContent = description;
    $('rt-channel-label').textContent = rtMode === 'poll' ? 'Repeated HTTP requests' : rtMode === 'sse' ? 'Open event stream' : 'Two-way channel';
    $('rt-track').classList.toggle('open', rtMode !== 'poll');
    $('rt-track').dataset.flow = event.flow;
    const token = document.createElement('span'); token.className = 'rt-token';
    token.textContent = ({ queued: 'waiting', idle: 'ready', open: 'open', roundtrip: 'HTTP' })[event.flow] || (rtMode === 'ws' ? 'message' : event.flow === 'to-server' ? 'POST' : 'event');
    $('rt-track').replaceChildren(token);
    $('rt-flow-label').textContent = ({ queued: 'Update stays at the server', idle: 'No message in transit', open: 'Browser opens the channel', roundtrip: 'Browser asks → server answers', 'to-server': rtMode === 'ws' ? 'Message from browser to server' : 'Separate POST from browser to server', 'to-browser': 'Update from server to browser' })[event.flow];
    $('rt-browser-endpoint').classList.toggle('active', ['to-browser', 'to-server', 'roundtrip', 'open'].includes(event.flow));
    $('rt-server-endpoint').classList.toggle('active', event.flow !== 'idle');
    $('rt-countdown').hidden = rtMode !== 'poll';
    $('rt-poll-label').textContent = 'Next poll in ' + (5 - state.seconds % 5) + ' s';
    $('rt-poll-progress').value = state.seconds % 5;
    $('rt-log').replaceChildren();
    state.events.slice(-8).forEach(item => { const li = document.createElement('li'); li.textContent = item.seconds + ' s · ' + item.text + (item.message ? ' “' + item.message.text + '”' : ''); $('rt-log').append(li); });
    if (rtPosition === rtFrames.length - 1) stopRealtimePlayback();
    updateRealtimeControls();
  }
  const modeButtons = [...document.querySelectorAll('[data-mode]')];
  function selectMode(mode) { stopRealtimePlayback(); rtMode = mode; renderRealtime(); }
  modeButtons.forEach((button, index) => {
    button.addEventListener('click', () => selectMode(button.dataset.mode));
    button.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
      selectMode(modeButtons[next].dataset.mode); modeButtons[next].focus({ preventScroll: true });
    });
  });
  $('rt-back').addEventListener('click', () => { stopRealtimePlayback(); rtPosition = previousEvent(); renderRealtime(); });
  $('rt-tick').addEventListener('click', () => { stopRealtimePlayback(); rtPosition = nextEvent(); renderRealtime(); });
  $('rt-play').addEventListener('click', () => {
    if (rtTimer) { stopRealtimePlayback(); return; }
    if (rtPosition === rtFrames.length - 1) { rtPosition = 0; renderRealtime(); }
    rtTimer = setInterval(() => { rtPosition = nextEvent(); renderRealtime(); }, 1400);
    updateRealtimeControls();
  });
  $('rt-reset').addEventListener('click', () => { stopRealtimePlayback(); rtFrames = makeStory(); rtPosition = 0; renderRealtime(); });
  for (const [id, action, input] of [['rt-update', 'update', 'rt-server-text'], ['rt-send', 'send', 'rt-browser-text']]) {
    $(id).addEventListener('click', () => {
      const text = $(input).value.trim().slice(0, 120); if (!text) return;
      stopRealtimePlayback(); rtFrames.splice(rtPosition + 1, 0, { actions: [{ action, text }] }); rtPosition++; renderRealtime();
    });
    $(input).addEventListener('input', () => { $(id).disabled = !$(input).value.trim(); });
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopRealtimePlayback(); });
  window.addEventListener('pagehide', stopRealtimePlayback);
  window.addEventListener('beforeprint', stopRealtimePlayback);
  renderRealtime();
  document.documentElement.classList.add('ready');
  const nav = document.querySelector('.mode-nav');
  new ResizeObserver(() => document.documentElement.style.setProperty('--messaging-nav-height', nav.getBoundingClientRect().height + 'px')).observe(nav);
})();
