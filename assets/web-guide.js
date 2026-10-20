/* One simulated browser visit. No network, credentials, cookies, or storage. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const panels = [...document.querySelectorAll('[data-journey-step]')];
  const links = [...document.querySelectorAll('[data-step]')];
  const names = ['Read the URL', 'Find the server', 'Connect securely', 'Request the page', 'Load resources', 'Use the page'];
  const defaults = () => ({ step: 0, path: '/plants', dnsCached: false, dnsFailure: false, invalidCert: false, slow: false, css: true, js: true, missingImage: false, cached: false, signedIn: false, watered: false });
  let state = defaults();
  let urlPart = 'scheme';
  const responses = {
    '/plants': { code: 200, reason: 'OK', title: 'Your small garden', body: 'Three small ways to help your plants thrive.' },
    '/missing': { code: 404, reason: 'Not Found', title: 'Plant not found', body: 'The server answered, but this page does not exist.' },
    '/broken': { code: 500, reason: 'Internal Server Error', title: 'Something went wrong', body: 'The server could not complete this request.' }
  };
  const controls = { 'dns-cached': 'dnsCached', 'dns-failure': 'dnsFailure', 'invalid-cert': 'invalidCert', 'slow-server': 'slow', 'load-css': 'css', 'load-js': 'js', 'missing-image': 'missingImage', 'resources-cached': 'cached', 'signed-in': 'signedIn' };
  const terminalStep = () => state.dnsFailure ? 1 : state.invalidCert ? 2 : 5;
  const successfulPage = () => responses[state.path].code === 200;
  const greeting = () => state.signedIn ? 'Welcome back, demo user.' : 'Welcome, guest.';
  const plantArt = '<svg class="plant-art" viewBox="0 0 320 110" role="img" aria-label="An illustrated growing plant"><path d="M160 77V27" fill="none" stroke="var(--ok)" stroke-width="4"/><path d="M160 57Q112 60 118 26Q153 24 160 57M160 43Q195 45 199 14Q166 13 160 43" fill="var(--surface)" stroke="var(--ok)" stroke-width="3"/><path d="M135 73H185L178 101H142Z" fill="var(--surface)" stroke="var(--border-bright)" stroke-width="2"/></svg>';

  function updateURLPart() {
    const descriptions = {
      scheme: ['Scheme: HTTPS.', 'Use HTTP over an encrypted connection.'],
      host: ['Hostname: garden.example.', 'DNS helps resolve this name to an IP address. Changing the path does not change the hostname.'],
      path: ['Path: ' + state.path + '.', 'The server chooses how to handle this resource. It need not be a file on disk.']
    };
    const [title, text] = descriptions[urlPart];
    const strong = document.createElement('strong'); strong.textContent = title + ' ';
    $('url-description').replaceChildren(strong, document.createTextNode(text));
    document.querySelectorAll('[data-url-part]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.urlPart === urlPart && state.step === 0)));
  }

  function renderExplanations() {
    const response = responses[state.path];
    $('dns-description').textContent = state.dnsFailure ? 'There is no usable answer, so the browser has no destination address. This visit stops before connecting or sending HTTP.' : state.dnsCached ? 'A usable local DNS answer skips the external lookup. The browser can contact the web server directly—not through DNS.' : 'DNS resolves garden.example to an IP address. The browser can then contact the web server directly—not through DNS.';
    $('dns-wire').textContent = state.dnsFailure ? 'DNS lookup failed\nNo connection\nNo HTTP status or server response' : 'garden.example → 192.0.2.10\nSource: ' + (state.dnsCached ? 'local DNS cache · no external lookup' : 'recursive resolver’s answer');
    $('connection-description').textContent = state.invalidCert ? 'TCP connected, but the certificate does not cover garden.example. This model stops rather than sending HTTP to an unverified endpoint.' : 'This visit opens a TCP connection, then uses TLS to check the server’s identity and establish encryption keys.';
    $('connection-wire').textContent = state.invalidCert ? 'TCP: connected\nTLS: hostname mismatch\nHTTP request: not sent' : 'TCP: SYN → SYN + ACK → ACK\nTLS: certificate checks + encryption keys\nHTTP/2 connection ready';
    $('http-description').textContent = 'The browser requests ' + state.path + '. The server returns ' + response.code + ' ' + response.reason + ', headers, and HTML. ' + (successfulPage() ? (state.signedIn ? 'It recognizes the session cookie and includes a personal greeting in the HTML.' : 'Without a session cookie, it returns the guest version of this public page.') : 'A session cookie does not make a missing or broken resource succeed.');
    $('http-wire').textContent = 'GET ' + state.path + '\nHost: garden.example\nAccept: text/html\n' + (state.signedIn ? 'Cookie: demo_session=demo-7' : '[No session cookie]') + '\n\nResponse: ' + response.code + ' ' + response.reason + '\nContent-Type: text/html\nCache-Control: private, no-store\n\n<h1>' + response.title + '</h1>' + (successfulPage() ? '\n<p>' + greeting() + '</p>\n<link rel="stylesheet" href="/style.css">' : '\n<p>' + response.body + '</p>');
    $('session-note').textContent = state.signedIn ? 'Assume an earlier successful sign-in: the browser has a cookie, and the server accepts its session ID. The cookie is sent with this request.' : 'Guest visit: no session cookie. The server returns the guest version of the public page.';
    $('server-timing').textContent = 'Illustrative response wait: ' + (state.slow ? '1,800' : '160') + ' ms.';
    $('resources-description').textContent = !successfulPage() ? 'This server’s error document is self-contained. There are no extra resources here; real error pages may still load CSS, images, and scripts.' : (state.cached ? 'Fresh cached resources are reused without network requests. The page looks the same.' + (state.missingImage ? ' The image has no usable cached copy, so its request still returns 404.' : '') : 'The browser fetches the CSS, image, and JavaScript referenced by the HTML, often concurrently.') + ' These public assets are the same for guests and signed-in users; the HTML was fetched separately.';
    const asset = enabled => !enabled ? 'not loaded · disabled in demo' : state.cached ? 'fresh browser cache · no request' : 'GET → 200 OK';
    $('resources-wire').textContent = !successfulPage() ? 'No referenced resources\nAn HTTP error can still return HTML' : '/style.css  ' + asset(state.css) + '\n/plant.svg  ' + (state.missingImage ? '404 Not Found' : asset(true)) + '\n/app.js     ' + asset(state.js);
    $('resource-controls').querySelectorAll('input').forEach(input => { input.disabled = !successfulPage(); });
    $('rendering-description').textContent = !successfulPage() ? 'The browser displays the server’s error HTML like any other document. This is a server answer—not a browser-generated DNS or TLS warning.' : 'The browser parses HTML' + (state.css ? ', applies CSS, lays out elements, and paints pixels.' : ', uses default styles, lays out elements, and paints pixels.') + (state.js ? ' JavaScript handles the garden’s watering button. Try it in the browser.' : ' The garden’s custom button does not respond because its script was not loaded.');
    $('rendering-wire').textContent = !successfulPage() ? response.code + ' ' + response.reason + '\nError HTML → document tree → pixels' : 'HTML → document tree\n' + (state.css ? 'CSS → styles and layout → paint' : 'No stylesheet → browser default presentation') + '\n' + (state.js ? 'JavaScript → click handler' : 'No script → no custom click handler');
    updateURLPart();
  }

  function previewMessage(title, text) {
    const box = document.createElement('div'); box.className = 'preview-wait';
    const heading = document.createElement('strong'); heading.textContent = title;
    const body = document.createElement('span'); body.textContent = text;
    box.append(heading, body); $('browser-preview').replaceChildren(box);
  }
  function renderPreview() {
    const step = state.step;
    let status;
    if (state.dnsFailure && step >= 1) {
      status = 'Stopped · DNS failure';
      previewMessage('Address not found', 'Browser-generated error. There is no HTTP status: the web server did not answer.');
    } else if (state.invalidCert && step >= 2) {
      status = 'Stopped · certificate rejected';
      previewMessage('Connection stopped', 'Browser-generated warning. The certificate does not cover garden.example. No HTTP request was sent.');
    } else if (step < 3) {
      const titles = ['An address, not a page yet', 'Finding the server', 'Preparing a secure connection'];
      status = titles[step];
      previewMessage(titles[step], 'No HTML response has arrived yet.');
    } else if (!successfulPage()) {
      const response = responses[state.path]; status = response.code + ' ' + response.reason + ' · server response';
      previewMessage(response.code + ' · ' + response.title, response.body);
    } else {
      const assets = step >= 4, interactive = step >= 5 && state.js;
      status = step === 3 ? 'HTML received · default presentation' : step === 4 ? (state.cached ? 'Resources reused from cache' : 'Resources loaded') : 'Page ready · ' + (state.js ? 'try the watering button' : 'custom script not loaded');
      $('browser-preview').innerHTML = '<div class="garden' + (assets && state.css ? ' styled' : '') + '"><p class="garden-account" id="page-identity">' + greeting() + '</p><div class="garden-label">Garden notes</div><h3>Your small garden</h3><p>Three small ways to help your plants thrive.</p>' +
        (assets ? (state.missingImage ? '<div class="image-failed">Image unavailable · /plant.svg returned 404</div>' : plantArt) : '') +
        '<p class="garden-info">Give it light. Check the soil. Water when needed.</p><button type="button" id="journey-water"' + (interactive ? '' : ' disabled') + '>' + (state.watered ? 'Watered! ✓' : 'Water the plant') + '</button><p class="small muted" style="margin-top:var(--s-2)">' + (interactive ? 'The script handles this button’s click.' : step === 4 && state.js ? 'The script is loaded. Activate its click handler in the next step.' : 'The button’s script is not active.') + '</p></div>';
      $('journey-water').addEventListener('click', event => { state.watered = true; event.currentTarget.textContent = 'Watered! ✓'; });
    }
    $('browser-state').textContent = status;
    $('url-path-part').textContent = state.path;
    $('static-url').textContent = 'https://garden.example' + state.path;
  }

  function renderTimeline() {
    const durations = [0, state.dnsCached && !state.dnsFailure ? 1 : 120, 180, state.slow ? 1800 : 160, successfulPage() ? (state.cached && !state.missingImage ? 0 : 120) : 0, 35];
    let elapsed = 0;
    $('timeline-rows').replaceChildren();
    names.forEach((name, index) => {
      const done = index <= state.step && index <= terminalStep(), duration = done ? durations[index] : 0;
      elapsed += duration;
      const row = document.createElement('div'); row.className = 'time-row';
      const label = document.createElement('span'); label.textContent = ['URL', 'DNS', 'Connect', 'HTTP', 'Resources', 'Render'][index];
      const track = document.createElement('div'); track.className = 'time-track'; track.setAttribute('aria-hidden', 'true');
      const bar = document.createElement('div'); bar.className = 'time-bar'; bar.style.width = (duration / 1800 * 100) + '%'; track.append(bar);
      const value = document.createElement('span'); value.textContent = index > terminalStep() ? 'skipped' : done ? duration + ' ms' : '—';
      row.append(label, track, value); $('timeline-rows').append(row);
    });
    $('time-total').textContent = 'Illustrative page-load time so far: ' + elapsed.toLocaleString('en-US') + ' ms.' + (state.cached ? ' Fresh cached asset retrieval is rounded to 0 ms.' : '');
  }

  function render() {
    if (terminalStep() < 5) state.step = Math.min(state.step, terminalStep());
    panels.forEach((panel, index) => { panel.hidden = state.step !== index; });
    links.forEach((link, index) => {
      if (state.step === index) link.setAttribute('aria-current', 'step'); else link.removeAttribute('aria-current');
      link.setAttribute('aria-disabled', String(index > terminalStep()));
    });
    Object.entries(controls).forEach(([id, key]) => { $(id).checked = state[key]; });
    $('path').value = state.path;
    $('previous').disabled = state.step === 0;
    $('next').disabled = state.step >= terminalStep();
    $('next').textContent = state.step === terminalStep() ? (terminalStep() < 5 ? 'Visit stopped · change the experiment' : 'Page ready') : 'Next step →';
    $('journey-position').textContent = (state.step + 1) + ' / 6';
    $('journey-status').textContent = 'Step ' + (state.step + 1) + ' of 6 · ' + names[state.step] + '.' + (state.step === terminalStep() && terminalStep() < 5 ? ' Visit stopped. Clear the failure checkbox to continue.' : '');
    renderExplanations(); renderPreview(); renderTimeline();
    window.GuidePresentation?.refresh();
  }

  function writeHash(replace = false) {
    const hash = '#' + panels[state.step].id;
    if (location.hash !== hash) {
      try { history[replace ? 'replaceState' : 'pushState'](null, '', hash); } catch { location.hash = hash; }
    }
  }
  function show(step, { focus = false, scroll = false, hash = true } = {}) {
    if (step < 0 || step > terminalStep()) return;
    state.step = step; render();
    if (hash) writeHash();
    const selected = links[state.step];
    if (selected) {
      const strip = selected.parentElement.getBoundingClientRect(), box = selected.getBoundingClientRect();
      if (box.left < strip.left) selected.parentElement.scrollLeft -= strip.left - box.left;
      else if (box.right > strip.right) selected.parentElement.scrollLeft += box.right - strip.right;
    }
    if (focus) panels[state.step].querySelector('h2').focus({ preventScroll: true });
    if (scroll) {
      const target = focus && matchMedia('(max-width: 760px)').matches ? panels[state.step] : $('journey');
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }
  links.forEach((link, index) => {
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); show(index, { focus: true, scroll: true });
    });
    link.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const end = terminalStep();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? end : (index + (event.key === 'ArrowRight' ? 1 : end)) % (end + 1);
      // Plain links remain in the Tab order; arrow keys provide a shortcut.
      show(next); links[next].focus({ preventScroll: true });
    });
  });
  $('next').addEventListener('click', () => show(Math.min(state.step + 1, terminalStep()), { focus: true, scroll: true }));
  $('previous').addEventListener('click', () => show(Math.max(0, state.step - 1), { focus: true, scroll: true }));
  Object.entries(controls).forEach(([id, key]) => $(id).addEventListener('change', event => {
    state[key] = event.target.checked;
    // A usable local answer and a failed resolution are alternative outcomes.
    if (key === 'dnsCached' && state.dnsCached) state.dnsFailure = false;
    if (key === 'dnsFailure' && state.dnsFailure) state.dnsCached = false;
    if (key === 'js') state.watered = false;
    render(); writeHash(true);
  }));
  $('path').addEventListener('change', event => { state.path = event.target.value; state.watered = false; render(); });
  document.querySelectorAll('[data-url-part]').forEach(button => button.addEventListener('click', () => {
    urlPart = button.dataset.urlPart; show(0);
  }));

  $('replay').addEventListener('click', () => {
    state = defaults(); urlPart = 'scheme';
    show(0, { focus: true, scroll: true });
  });

  function followHash(initial = false) {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { id = ''; }
    const target = document.getElementById(id);
    const panel = target?.closest('[data-journey-step]');
    const step = id === 'journey' || !id ? 0 : panel ? panels.indexOf(panel) : -1;
    if (step < 0) { if (initial) show(0, { hash: false }); return; }
    show(Math.min(step, terminalStep()), { hash: false });
    if (target && panel && !panel.hidden) {
      if (target.tagName === 'DETAILS') target.open = true;
      for (let parent = target.parentElement; parent && parent !== panel; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
    }
    if (!initial) $('journey').scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  window.addEventListener('hashchange', () => followHash());
  window.addEventListener('popstate', () => followHash());
  const nav = document.querySelector('.journey-nav');
  new ResizeObserver(() => document.documentElement.style.setProperty('--web-nav-height', nav.getBoundingClientRect().height + 'px')).observe(nav);
  $('journey').style.scrollMarginTop = 'calc(var(--web-nav-height,7rem) + 1rem)';
  $('static-url').hidden = true;
  document.documentElement.classList.add('ready');
  followHash(true);
})();
