/* Progressive presentation only: existing simulations keep their controls,
   DOM, and state. Without this file, the full article and native selects work. */
(() => {
  'use strict';
  if (window.GuidePresentation) return;
  const records = new Map();
  let serial = 0, refreshQueued = false;
  const selector = document.body.hasAttribute('data-choice-controls') ? 'select:not([data-native])' : 'select[data-choice]';
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function choose(select, value) {
    const option = [...select.options].find(item => item.value === value);
    if (!select.isConnected || select.disabled || !option || option.disabled) return;
    const id = select.id;
    if (select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // Some AI views replace their entire control subtree on change.
    refreshChoices();
    const current = document.getElementById(id), record = records.get(current);
    record?.buttons.find(button => button.dataset.choiceValue === value)?.focus({ preventScroll: true });
  }
  function syncChoice(select, record) {
    const options = [...select.options];
    const signature = JSON.stringify(options.map(option => option.value));
    if (record.signature !== signature) {
      record.signature = signature;
      record.buttons = options.map(option => {
        const button = make('button', undefined, 'choice-card');
        button.type = 'button'; button.dataset.choiceValue = option.value; button.setAttribute('role', 'radio');
        button.addEventListener('click', () => choose(select, button.dataset.choiceValue));
        return button;
      });
      record.group.replaceChildren(...record.buttons);
    }
    const compact = options.length <= 4 && options.every(option => option.label.trim().length <= 8);
    record.group.classList.toggle('is-compact', compact);
    record.group.style.setProperty('--choice-count', options.length);
    record.group.setAttribute('aria-disabled', String(select.disabled));
    let focusable = false;
    options.forEach((option, i) => {
      const button = record.buttons[i], label = option.label.trim(), description = option.dataset.description || '';
      const key = label + '\n' + description;
      if (button._choiceLabel !== key) {
        const parts = label.split(' · '), title = parts.shift(), detail = description || parts.join(' · ');
        button.replaceChildren(make('strong', title));
        if (detail) button.append(make('small', detail));
        button._choiceLabel = key;
      }
      const disabled = select.disabled || option.disabled, selected = option.selected;
      if (button.disabled !== disabled) button.disabled = disabled;
      button.setAttribute('aria-checked', String(selected));
      button.tabIndex = selected && !disabled ? 0 : -1;
      if (button.tabIndex === 0) focusable = true;
    });
    if (!focusable) { const first = record.buttons.find(button => !button.disabled); if (first) first.tabIndex = 0; }
  }
  function enhanceChoice(select) {
    if (records.has(select)) return;
    // Long, free-form, and multi-select lists remain native on purpose.
    if (select.multiple || select.options.length < 2 || select.options.length > 8) return;
    if (!select.id) select.id = 'guide-choice-' + (++serial);
    const wrappingLabel = select.closest('label');
    if (wrappingLabel) {
      const field = make('div', undefined, 'choice-field');
      wrappingLabel.before(field); wrappingLabel.htmlFor = select.id;
      field.append(wrappingLabel); field.append(select);
    }
    const group = make('div', undefined, 'choice-cards');
    group.dataset.choiceFor = select.id; group.id = 'choice-group-' + select.id; group.setAttribute('role', 'radiogroup');
    const labels = [...select.labels];
    if (labels.length) {
      group.setAttribute('aria-labelledby', labels.map(label => {
        if (!label.id) label.id = 'choice-label-' + (++serial);
        label.addEventListener('click', event => {
          if (event.target.closest('button,input,a,select')) return;
          event.preventDefault(); records.get(select)?.buttons.find(button => button.tabIndex === 0)?.focus();
        });
        return label.id;
      }).join(' '));
    } else group.setAttribute('aria-label', select.getAttribute('aria-label') || select.id.replaceAll('-', ' '));
    if (select.hasAttribute('aria-describedby')) group.setAttribute('aria-describedby', select.getAttribute('aria-describedby'));
    select.after(group); select.hidden = true; select.classList.add('choice-native');
    const record = { group, buttons: [], signature: null }; records.set(select, record);
    group.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const enabled = record.buttons.filter(button => !button.disabled);
      if (!enabled.length) return;
      const current = enabled.indexOf(event.target.closest('button'));
      if (current < 0) return;
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 :
        (current + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + enabled.length) % enabled.length;
      choose(select, enabled[index].dataset.choiceValue);
    });
    syncChoice(select, record);
  }
  function refreshChoices() {
    for (const [select, record] of records) if (!select.isConnected) { record.group.remove(); records.delete(select); }
    document.querySelectorAll(selector).forEach(enhanceChoice);
    records.forEach((record, select) => syncChoice(select, record));
  }
  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => { refreshQueued = false; refreshChoices(); });
  }
  const observer = new MutationObserver(mutations => {
    if (mutations.some(mutation => mutation.type === 'attributes' ? mutation.target.matches('select,option') :
      mutation.target.closest?.('select') || [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
        node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector))))) queueRefresh();
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label', 'value'] });
  ['click', 'input', 'change'].forEach(type => document.addEventListener(type, queueRefresh));
  window.GuidePresentation = { refresh: refreshChoices };
  let printDisclosures = [];
  window.addEventListener('beforeprint', () => {
    printDisclosures = [...document.querySelectorAll('details:not([open])')];
    printDisclosures.forEach(details => { details.open = true; });
  });
  window.addEventListener('afterprint', () => { printDisclosures.forEach(details => { details.open = false; }); printDisclosures = []; });
  function hashId(hash = location.hash) { try { return decodeURIComponent(hash.slice(1)); } catch { return ''; } }

  function setupChapters() {
    const main = document.querySelector('main');
    const panels = [...main.children].filter(node => node.matches('section[id], [data-guide-panel]'));
    if (!panels.length) return;
    const hero = [...main.children].find(node => node.matches('header') && !panels.includes(node));
    const dock = make('header', undefined, 'guide-dock'), inner = make('div', undefined, 'guide-dock-inner');
    const heading = make('div', undefined, 'guide-dock-heading');
    const guideName = ({ web: 'How the web works', network: 'How data travels', os: 'How operating systems work', storage: 'Row vs columnar databases' })[document.body.dataset.guide] || document.title;
    const count = make('span'), tabs = make('nav', undefined, 'guide-tabs');
    heading.append(make('strong', guideName), count);
    tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Guide topics'); tabs.style.setProperty('--guide-count', panels.length);
    inner.append(heading, tabs); dock.append(inner); main.before(dock);
    const links = panels.map((panel, index) => {
      panel.classList.add('guide-panel'); panel.setAttribute('role', 'tabpanel'); panel.tabIndex = 0;
      const eyebrow = panel.querySelector(':scope > .eyebrow');
      if (eyebrow) eyebrow.textContent = eyebrow.textContent.replace(/^\d+(?:\s*&\s*\d+)?\s*·\s*/, '');
      const label = panel.dataset.tabLabel || panel.querySelector('h2,h1')?.textContent || panel.id;
      const link = make('a', undefined, 'guide-tab'); link.href = '#' + panel.id; link.id = 'guide-tab-' + panel.id;
      link.setAttribute('role', 'tab'); link.setAttribute('aria-controls', panel.id); panel.setAttribute('aria-labelledby', link.id);
      link.append(make('strong', (index + 1) + '. ' + label));
      if (panel.dataset.tabNote) link.append(make('small', panel.dataset.tabNote));
      tabs.append(link); return link;
    });
    const pager = make('nav', undefined, 'guide-pager'); pager.setAttribute('aria-label', 'Next or previous topic');
    const previous = make('button', '← Previous'), position = make('span'), next = make('button', 'Next →');
    previous.type = next.type = 'button'; previous.id = 'guide-previous'; next.id = 'guide-next'; pager.append(previous, position, next);
    const footer = [...main.children].find(node => node.tagName === 'FOOTER');
    if (footer) footer.before(pager); else main.append(pager);
    if (footer && !(footer.children.length === 1 && footer.firstElementChild.tagName === 'DETAILS')) {
      const details = make('details', undefined, 'guide-sources'); details.append(make('summary', 'Sources & scope'));
      for (const node of [...footer.childNodes]) {
        if (node.nodeType === 1 && node.tagName === 'DETAILS') {
          const summary = node.querySelector(':scope > summary');
          if (summary) { details.append(make('h3', summary.textContent)); summary.remove(); }
          details.append(...node.childNodes); node.remove();
        } else details.append(node);
      }
      footer.append(details);
    }
    main.querySelectorAll('[data-model-note]').forEach(note => {
      const details = make('details', undefined, 'model-notes'); details.append(make('summary', 'Model notes'));
      note.before(details); note.classList.remove('note'); details.append(note);
    });
    let active = null;
    function scrollTarget(id, focus = false) {
      const original = document.getElementById(id); if (!original) return;
      const record = records.get(original), target = record?.group || original;
      for (let parent = target.parentElement; parent && parent !== main; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      if (focus) {
        const destination = record?.buttons.find(button => button.tabIndex === 0) || target;
        if (!destination.hasAttribute('tabindex')) destination.tabIndex = -1;
        destination.focus({ preventScroll: true });
      }
    }
    function resolvePanel(id) {
      const target = document.getElementById(id);
      return panels.find(panel => panel.id === id || (target && panel.contains(target)));
    }
    function show(id, { scroll = true, focus = false, updateHash = true } = {}) {
      const panel = resolvePanel(id); if (!panel) return false;
      const index = panels.indexOf(panel), previousId = active?.id;
      active = panel;
      panels.forEach((item, i) => {
        const selected = item === panel; item.hidden = !selected;
        links[i].setAttribute('aria-selected', String(selected)); links[i].tabIndex = selected ? 0 : -1;
      });
      if (hero) hero.hidden = index !== 0;
      count.textContent = (index + 1) + ' / ' + panels.length;
      position.textContent = panel.dataset.tabLabel || 'Topic ' + (index + 1);
      previous.disabled = index === 0; next.disabled = index === panels.length - 1;
      previous.textContent = index === 0 ? '← Previous' : '← ' + (panels[index - 1].dataset.tabLabel || 'Previous');
      next.textContent = index === panels.length - 1 ? 'End of guide' : (panels[index + 1].dataset.tabLabel || 'Next') + ' →';
      if (updateHash && location.hash !== '#' + id) { try { history.pushState(null, '', '#' + id); } catch { location.hash = id; } }
      if (previousId !== panel.id) document.dispatchEvent(new CustomEvent('guide:change', { detail: { previous: previousId, current: panel.id } }));
      if (scroll) window.scrollTo({ top: 0, behavior: 'instant' });
      if (focus) links[index].focus({ preventScroll: true });
      // Scroll the card strip horizontally, without moving the reader vertically.
      const strip = tabs.getBoundingClientRect(), selected = links[index].getBoundingClientRect();
      if (selected.left < strip.left) tabs.scrollLeft -= strip.left - selected.left;
      else if (selected.right > strip.right) tabs.scrollLeft += selected.right - strip.right;
      return true;
    }
    links.forEach((link, index) => {
      link.addEventListener('click', event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); show(panels[index].id);
      });
      link.addEventListener('keydown', event => {
        if (event.key === ' ') { event.preventDefault(); show(panels[index].id); return; }
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? panels.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + panels.length) % panels.length;
        show(panels[target].id, { focus: true });
      });
    });
    previous.addEventListener('click', () => { const i = panels.indexOf(active); if (i > 0) show(panels[i - 1].id, { focus: true }); });
    next.addEventListener('click', () => { const i = panels.indexOf(active); if (i < panels.length - 1) show(panels[i + 1].id, { focus: true }); });
    document.addEventListener('click', event => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest('a[href^="#"]');
      if (!link || link.closest('.guide-dock')) return;
      const id = hashId(link.hash); if (!resolvePanel(id)) return;
      event.preventDefault(); show(id, { scroll: false }); scrollTarget(id, true);
    });
    window.addEventListener('hashchange', () => {
      const id = hashId();
      if (resolvePanel(id)) { show(id, { scroll: false, updateHash: false }); scrollTarget(id); }
      else if (!id) show(panels[0].id, { updateHash: false });
    });
    const resize = () => document.documentElement.style.setProperty('--guide-dock-height', dock.getBoundingClientRect().height + 'px');
    new ResizeObserver(resize).observe(dock);
    window.GuideLayout = { show, get active() { return active?.id; } };
    document.body.classList.add('guide-enhanced');
    const initial = hashId();
    show(resolvePanel(initial) ? initial : panels[0].id, { scroll: false, updateHash: false }); resize();
    if (initial && resolvePanel(initial)) requestAnimationFrame(() => scrollTarget(initial));
  }
  if (document.body.dataset.guide) setupChapters();
  refreshChoices();
})();
