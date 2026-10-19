# Interactive Guides

A growing collection of AI-generated interactive guides on various topics.

## Guides

- [From tokens to agents](ai.html) — Explore how LLMs and AI agents work, including architecture, training, inference, tools, RAG, and context.
- [InnoDB & Iceberg — Same data, different work](innodb-vs-iceberg.html) — Compare row and column storage, read and write paths, indexing, and workload fit.

## Viewing the guides

GitHub's file viewer shows HTML source, not the interactive page. To use the guides locally, clone this repository or download and unzip the whole repository, then open `index.html` in a browser with JavaScript enabled. Keep the `assets/` folder alongside the HTML files; downloading just one HTML file will omit the shared styles.

For shareable browser links without downloads, this repository can be published with [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site). The `index.html` homepage links to all guides. No build step is needed.

## Shared styling

[`assets/shared.css`](assets/shared.css) defines the common light/dark palette, system fonts, typography, spacing, controls, focus styles, and collection navigation. No framework, build step, or font download is required.

Each page keeps its topic-specific layout and visualization styles inline. Load the shared stylesheet **after** those styles so the common visual foundation wins. The AI guide also applies it to both embedded chapter documents, overriding their original theme defaults.

To add a guide, use a topic-based filename, link `assets/shared.css`, and add it to both this README and `index.html`. Use the shared CSS variables instead of hard-coded colors and fonts.

## Note

These guides are AI-generated learning aids and may contain mistakes. Verify important details against authoritative sources.
