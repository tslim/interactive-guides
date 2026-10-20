# Interactive Guides

A growing collection of AI-generated, interactive explanations of computing fundamentals.

## Guides

- [From tokens to agents](from-tokens-to-agents.html)
- [How CPUs and GPUs work together](how-cpus-and-gpus-work.html)
- [How an operating system runs your programs](how-operating-systems-work.html)
- [How processes, containers, and virtual machines isolate work](how-virtual-machines-work.html)
- [How data travels across the internet](how-data-travels.html)
- [How live messages reach your browser](how-live-messages-work.html)
- [What happens when you open a website?](how-the-web-works.html)
- [How databases store and retrieve data](how-databases-store-and-retrieve-data.html)

## Viewing

Clone or download the whole repository, then open [`index.html`](index.html) in a browser. Keep the `assets/` folder alongside the HTML files and enable JavaScript for the interactive examples. No build step is required.

GitHub's file viewer displays source code. To publish browsable pages, use [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/) or another static host.

## Tests

Run the model tests with Node.js 18 or newer:

```sh
node --test tests/*.test.cjs
```

Optional browser tests require Puppeteer and Chrome/Chromium:

```sh
export PUPPETEER_MODULE=/absolute/path/to/puppeteer
export CHROME_PATH=/absolute/path/to/chrome
node tests/guide-layout.browser.cjs
node tests/compute-guide.browser.cjs
```

Omit the environment variables if Puppeteer resolves normally and its bundled browser is available. Node and browser tooling are only needed for tests, not for viewing or publishing the guides.

## Note

These guides are AI-generated learning aids and may contain mistakes. Verify important details against authoritative sources.
