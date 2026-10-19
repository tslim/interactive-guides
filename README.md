# Interactive Guides

A growing collection of AI-generated interactive guides on various topics.

## Guides

- [From tokens to agents](ai.html) — Explore how LLMs and AI agents work, including architecture, training, inference, tools, RAG, and context.
- [How an operating system runs your programs](how-operating-systems-work.html) — Explore kernels, processes, virtual memory, RAM pressure, filesystems, drivers, durable saves, and virtual machines, with step-by-step playback and an end-to-end editor journey.
- [How data travels across the internet](how-data-travels.html) — Explore packets, routing, bandwidth, latency, loss recovery, and real-time messaging with polling, SSE, and WebSockets.
- [What happens when you open a website?](how-the-web-works.html) — Follow a page load through DNS, TCP, HTTPS, HTTP, and rendering, with hands-on caching, cookies, and sign-in demos.
- [InnoDB & Iceberg — Same data, different work](innodb-vs-iceberg.html) — Compare row and column storage, read and write paths, indexing, and workload fit.

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

The AI guide retains its two-chapter layout; its embedded chapters also use the shared choice-card enhancement.

## Simulation tests

The networking guide uses [`assets/network-model.js`](assets/network-model.js). The OS guide uses [`assets/os-model.js`](assets/os-model.js) for deterministic scheduling, address translation, page replacement, and save/crash models, with browser controls in [`assets/os-guide.js`](assets/os-guide.js). All models state their teaching assumptions rather than claiming to reproduce a particular OS or network stack.

With Node.js 18 or newer, run both model suites:

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
