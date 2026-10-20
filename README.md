# Interactive Guides

A growing collection of AI-generated interactive guides on various topics.

## Guides

- [From tokens to agents](from-tokens-to-agents.html) — Explore how LLMs and AI agents work, including architecture, training, inference, tools, RAG, and context.
- [How an operating system runs your programs](how-operating-systems-work.html) — Follow one editor through Launch → Open → Read → Edit → Save, with permissions, caching, memory pressure, and durability experiments in the relevant stage.
- [How processes, containers, and virtual machines isolate work](how-virtual-machines-work.html) — Trace a file request through native, container, and VM environments, and compare application versus kernel failure boundaries.
- [How data travels across the internet](how-data-travels.html) — Follow one transfer through packetization, a shared queue, transmission, TCP/UDP delivery, and application outcomes, with stage-local experiments.
- [How live messages reach your browser](how-live-messages-work.html) — Compare polling, Server-Sent Events, and WebSocket at the same moment in one simulated conversation.
- [What happens when you open a website?](how-the-web-works.html) — Follow one browser visit from URL to pixels, with DNS, HTTPS, HTTP, signed-in requests, and resource-cache experiments along the way.
- [How databases store and retrieve data](how-databases-store-and-retrieve-data.html) — Explore how row-oriented and columnar storage work, why databases organize data differently, and how those choices affect query performance.

## Viewing the guides

GitHub's file viewer shows HTML source, not the interactive page. To use the guides locally, clone this repository or download and unzip the whole repository, then open `index.html` in a browser with JavaScript enabled. Keep the `assets/` folder alongside the HTML files; downloading just one HTML file will omit the shared styles and any supporting scripts.

For shareable browser links without downloads, this repository can be published with [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site). The `index.html` homepage links to all guides. No build step is needed.

## Shared styling

[`assets/shared.css`](assets/shared.css) defines the common light/dark palette, system fonts, typography, spacing, controls, focus styles, and collection navigation. No framework, build step, or font download is required.

Each page keeps its topic-specific layout and visualization styles inline. Load the shared stylesheet **after** those styles so the common visual foundation wins. The AI guide also applies it to both embedded chapter documents, overriding their original theme defaults.

Guides follow the AI guide’s focused, card-based presentation: sticky topic navigation, one visible topic at a time, short explanations, and expandable model notes. Switching topics preserves demo state. Without presentation JavaScript, the full article remains readable.

[`assets/guide-layout.js`](assets/guide-layout.js) supplies the shared topic navigation and accessible choice cards. To add a guide:

- Use a topic-based filename, link `assets/shared.css`, and add it to this README and `index.html`.
- Add `data-guide` to the body and a unique ID plus `data-tab-label` to each direct `main > section`. An introductory header can be a topic with `data-guide-panel`.
- Load `assets/guide-layout.js` after the guide’s own scripts. Pause autoplay on the document’s `guide:change` event.
- Mark short, finite selects with `data-choice`. The native control and its handlers remain the source of truth; the shared layer supplies keyboard-accessible cards.
- Use shared CSS variables and `.concept-grid` / `.concept-card` for compact explanations. Put longer caveats in expandable notes, not another long paragraph.

The AI guide retains its two-chapter layout; its embedded chapters also use the shared choice-card enhancement. The web guide uses one six-step browser journey instead of topic tabs, with state and navigation in [`assets/web-guide.js`](assets/web-guide.js). Step 4 compares guest and signed-in requests in the same page; step 5 switches public assets between network requests and fresh cache hits. It loads the shared choice-card enhancement without `data-guide`, so it does not add a second navigator. All step explanations remain readable without JavaScript and in print.

The internet guide uses one five-stage packet journey, with controls and navigation in [`assets/network-guide.js`](assets/network-guide.js). Packet size, sharing, link settings, transport, and file/audio outcomes all use the same transfer. Routing is an expandable topology illustration, explicitly separate from single-link timing. A sticky dashboard distinguishes elapsed time, bytes received, and bytes available to the app. The sender appears only in stage 1; the outgoing link appears from stage 3; the receiver tray appears at the top of the scene only in stages 4–5. Visible play/replay controls in stages 3–5 advance that same run, including live file/audio outcomes; the expandable event inspector provides finer control. Live messaging has its own focused guide and [`assets/messaging-guide.js`](assets/messaging-guide.js); it models application waiting, not packet transit. Its sticky Polling/SSE/WebSocket selector preserves the current moment, while Play, Prev/Next event, and Restart follow shared message/poll checkpoints rather than a second-by-second button strip. Both guides omit `data-guide` to avoid adding a second navigator, and retain no-JS/print explanations. Old internet-guide `#realtime` links redirect to the messaging guide when JavaScript is available.

The OS guide follows one editor and one file through five stages, with a shared process/read-count/durability dashboard and stage-local playback. Each stage starts at its first event; returning to an explored stage preserves its position. [`assets/os-journey-model.js`](assets/os-journey-model.js) builds independent narrative snapshots and reuses the tested save/crash model; [`assets/os-guide.js`](assets/os-guide.js) controls the scene. Scheduling, address translation, and clean-page reclamation are optional independent close-ups, explicitly not the story’s timing model. VM/container comparison lives in its own guide with [`assets/vm-guide.js`](assets/vm-guide.js). Both pages avoid a second topic navigator and retain no-JS/print explanations; legacy OS links open the matching stage or redirect to the VM guide.

## Simulation tests

The internet and live-messaging guides share [`assets/network-model.js`](assets/network-model.js), unchanged by their presentation split. The OS guide uses [`assets/os-model.js`](assets/os-model.js) for deterministic scheduling, address translation, page replacement, and save/crash models, with browser controls in [`assets/os-guide.js`](assets/os-guide.js). All models state their teaching assumptions rather than claiming to reproduce a particular OS or network stack.

With Node.js 18 or newer, run all model suites:

```sh
node --test tests/*.test.cjs
```

Node is only needed to run tests, not to view or publish the guides.

An optional browser regression suite checks all topics, mobile/desktop layouts, keyboard controls, deep links/history, preserved model state, autoplay cleanup, and no-JS/print fallbacks. It needs an existing Puppeteer installation and Chrome/Chromium:

```sh
PUPPETEER_MODULE=/absolute/path/to/puppeteer \
CHROME_PATH=/absolute/path/to/chrome \
node tests/guide-layout.browser.cjs
```

Omit these variables if `puppeteer` resolves normally and its bundled browser is available. No browser tooling is required by the published pages.

## Note

These guides are AI-generated learning aids and may contain mistakes. Verify important details against authoritative sources.
