/* =================================================================
   Gradio Pipeline Directory — main JS
   Vanilla ES2020, no build step. Reads categories.json + featured.json
   from /data/, then renders a filterable card grid + detail modal.

   URL state is reflected in the query string (?q=...&cat=...&sort=...)
   so any view is shareable and the back button works as expected.
   ================================================================= */

(function () {
  'use strict';

  /* ----------------------- DOM refs ----------------------- */
  var $cats        = document.getElementById('category-pills');
  var $sort        = document.getElementById('sort-options');
  var $catsCount   = document.getElementById('cats-count');
  var $search      = document.getElementById('search-input');
  var $toolbar     = document.getElementById('toolbar');
  var $activeF     = document.getElementById('active-filters');
  var $clearF      = document.getElementById('clear-filters');
  var $results     = document.getElementById('results');
  var $empty       = document.getElementById('empty-state');
  var $resultCount = document.getElementById('result-count');
  var $modal       = document.getElementById('modal');
  var $modalBody   = document.getElementById('modal-body');
  var $modalTitle  = document.getElementById('modal-title');
  var $modalClose  = document.getElementById('modal-close');
  var $toast       = document.getElementById('toast');
  var $footerDate  = document.getElementById('footer-date');
  var $hubGrid     = document.getElementById('hub-grid');
  var $hubCount    = document.getElementById('hub-count');
  var $versionPills = document.getElementById('version-pills');
  var $versionHint  = document.getElementById('version-hint');

  /* ----------------------- State ----------------------- */
  var state = {
    tools: [],
    categories: [],
    sortOptions: [],
    activeCats: new Set(),
    sort: 'stars',
    q: '',
    versions: [],
    activeVersion: 'director',
    sections: []
  };
  var VERSION_STORAGE_KEY = 'gradio-pipeline-directory:version';

  /* ----------------------- Helpers ----------------------- */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class')      node.className = attrs[k];
        else if (k === 'dataset') Object.keys(attrs[k]).forEach(function (dk) { node.dataset[dk] = attrs[k][dk]; });
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
        else if (k === 'html')  node.innerHTML = attrs[k];
        else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    });
    return node;
  }
  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); var a = arguments, self = this; t = setTimeout(function () { fn.apply(self, a); }, ms); };
  }
  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function showToast(msg, kind) {
    $toast.textContent = msg;
    $toast.className = 'toast' + (kind ? ' toast--' + kind : '');
    $toast.hidden = false;
    requestAnimationFrame(function () { $toast.classList.add('is-visible'); });
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      $toast.classList.remove('is-visible');
      setTimeout(function () { $toast.hidden = true; }, 280);
    }, 1900);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  /* ----------------------- Number formatting ----------------------- */
  function formatStars(n) {
    if (n == null) return '—';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }
  function formatDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      var diff = (Date.now() - d.getTime()) / 1000;
      if (diff < 60) return 'just now';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      if (diff < 2592000) return Math.floor(diff / 86400) + 'd ago';
      if (diff < 31536000) return Math.floor(diff / 2592000) + 'mo ago';
      return Math.floor(diff / 31536000) + 'y ago';
    } catch (e) { return '—'; }
  }

  /* ----------------------- URL state ----------------------- */
  function readURL() {
    var p = new URLSearchParams(location.search);
    state.q = (p.get('q') || '').trim();
    state.sort = p.get('sort') || 'stars';
    state.activeCats = new Set((p.get('cat') || '').split(',').filter(Boolean));
    state.activeVersion = p.get('v') || '';
  }
  function writeURL() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.activeCats.size) p.set('cat', Array.from(state.activeCats).join(','));
    if (state.sort && state.sort !== 'stars') p.set('sort', state.sort);
    if (state.activeVersion && state.activeVersion !== 'director') p.set('v', state.activeVersion);
    var qs = p.toString();
    var url = location.pathname + (qs ? '?' + qs : '');
    if (url !== location.pathname + location.search) {
      history.replaceState(null, '', url);
    }
  }

  /* ----------------------- Data loading ----------------------- */
  function loadJSON(url) {
    return fetch(url, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' on ' + url);
        return r.json();
      });
  }
  function bootstrap() {
    return Promise.all([
      loadJSON('data/featured.json'),
      loadJSON('data/categories.json'),
      loadJSON('data/hub.json').catch(function () { return { sections: [] }; })
    ]).then(function (results) {
      var featured = results[0];
      var cats     = results[1];
      var hub      = results[2];
      state.tools = (featured.tools || []).map(function (t) {
        t._id       = t.id || (t.owner + '/' + t.repo);
        t._name     = t.name || (t.owner + '/' + t.repo);
        t._owner    = t.owner || '';
        t._repo     = t.repo || '';
        t._haystack = [t._name, t._owner, t._repo, t.description, (t.topics || []).join(' '), t.category].join(' ').toLowerCase();
        return t;
      });
      state.categories   = cats.categories || [];
      state.sortOptions  = cats.sortOptions || [{ id: 'stars', label: 'Most stars' }];
      state.sections     = (hub && hub.sections) || [];
      state.versions     = (hub && hub.versions) || [];
      var hubDefault     = (hub && hub.defaultVersion) || 'director';
      readURL();
      // Resolve the active version: URL > localStorage > default
      var stored = null;
      try { stored = localStorage.getItem(VERSION_STORAGE_KEY); } catch (e) {}
      var knownVersions = new Set(state.versions.map(function (v) { return v.id; }));
      var candidate = state.activeVersion || stored || hubDefault;
      if (!knownVersions.has(candidate)) candidate = hubDefault;
      state.activeVersion = candidate;
      // Validate that the URL-referenced sort exists
      if (!state.sortOptions.some(function (s) { return s.id === state.sort; })) state.sort = 'stars';
      // Drop any active cats that don't exist
      var knownCats = new Set(state.categories.map(function (c) { return c.id; }));
      state.activeCats = new Set(Array.from(state.activeCats).filter(function (c) { return knownCats.has(c); }));
      // Compute a fallback stars count for tools that don't have one
      state.tools.forEach(function (t) { if (t.stars == null) t.stars = 0; });
      $search.value = state.q;
      renderSidebar();
      render();
      renderVersionPicker();
      renderHub();
      hydrateFromGitHub();
    }).catch(function (err) {
      console.error('Bootstrap failed:', err);
      $results.innerHTML = '';
      $empty.hidden = false;
      $empty.querySelector('h3').textContent = 'Failed to load directory data';
      $empty.querySelector('p').textContent = String(err.message || err);
    });
  }

  /* ----------------------- GitHub enrichment ----------------------- */
  // Live-star enrichment is fire-and-forget. If GitHub rate-limits or the
  // request fails, we just keep the static featured.json value.
  function hydrateFromGitHub() {
    var cacheKey = 'gh-stars:' + state.tools.map(function (t) { return t._id; }).join(',');
    var cached;
    try { cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null'); } catch (e) { cached = null; }
    var need = state.tools.filter(function (t) { return t.stars === 0 && (!cached || !cached[t._id]); });
    if (!need.length) {
      if (cached) {
        state.tools.forEach(function (t) { if (cached[t._id]) t.stars = cached[t._id].stars || 0; });
        render();
      }
      return;
    }
    // Fetch in small batches. GitHub's public API rate limit is 60/hr unauthenticated.
    var batch = need.slice(0, 6);
    Promise.all(batch.map(function (t) {
      return fetch('https://api.github.com/repos/' + t._owner + '/' + t._repo, { headers: { 'Accept': 'application/vnd.github+json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return { id: t._id, stars: j ? j.stargazers_count : 0, pushed: j ? j.pushed_at : null }; })
        .catch(function () { return { id: t._id, stars: 0, pushed: null }; });
    })).then(function (rows) {
      var next = cached || {};
      rows.forEach(function (r) { next[r.id] = { stars: r.stars, pushed: r.pushed }; });
      try { sessionStorage.setItem(cacheKey, JSON.stringify(next)); } catch (e) {}
      state.tools.forEach(function (t) {
        if (next[t._id]) {
          if (t.stars === 0) t.stars = next[t._id].stars || 0;
          if (!t.pushedAt && next[t._id].pushed) t.pushedAt = next[t._id].pushed;
        }
      });
      render();
    });
  }

  /* ----------------------- Sidebar render ----------------------- */
  function renderSidebar() {
    // Count tools per category for badges
    var counts = {};
    state.tools.forEach(function (t) { counts[t.category] = (counts[t.category] || 0) + 1; });
    $catsCount.textContent = String(state.tools.length);

    $cats.innerHTML = '';
    state.categories.forEach(function (c) {
      var active = state.activeCats.has(c.id);
      var count = counts[c.id] || 0;
      var pill = el('button', {
        class: 'pill' + (active ? ' is-active' : ''),
        type: 'button',
        'aria-pressed': active ? 'true' : 'false',
        title: c.label,
        onclick: function () { toggleCategory(c.id); }
      }, [
        el('span', { class: 'pill__dot', style: 'background:' + (active ? c.color : 'var(--text-faint)') }),
        el('span', { class: 'pill__label' }, [c.label]),
        el('span', { class: 'pill__count' }, [String(count)])
      ]);
      $cats.appendChild(pill);
    });

    $sort.innerHTML = '';
    state.sortOptions.forEach(function (s) {
      var id = 'sort-' + s.id;
      var checked = state.sort === s.id;
      var label = el('label', { for: id }, [
        el('input', { type: 'radio', name: 'sort', id: id, value: s.id, checked: checked ? 'checked' : null, onchange: function () { state.sort = s.id; writeURL(); render(); } }),
        el('span', null, [s.label])
      ]);
      $sort.appendChild(label);
    });
  }

  function toggleCategory(id) {
    if (state.activeCats.has(id)) state.activeCats.delete(id);
    else state.activeCats.add(id);
    writeURL();
    renderSidebar();
    render();
  }

  /* ----------------------- Filter / sort ----------------------- */
  function visibleTools() {
    var q = state.q.toLowerCase();
    var rows = state.tools.filter(function (t) {
      if (state.activeCats.size && !state.activeCats.has(t.category)) return false;
      if (q && t._haystack.indexOf(q) === -1) return false;
      return true;
    });
    rows.sort(function (a, b) {
      switch (state.sort) {
        case 'updated':
          return (new Date(b.pushedAt || 0)) - (new Date(a.pushedAt || 0));
        case 'name':
          return a._name.localeCompare(b._name);
        case 'category':
          return (a.category || '').localeCompare(b.category || '') || (b.stars - a.stars);
        case 'stars':
        default:
          return (b.stars || 0) - (a.stars || 0);
      }
    });
    return rows;
  }

  /* ----------------------- Card render ----------------------- */
  function categoryMeta(id) {
    for (var i = 0; i < state.categories.length; i++) {
      if (state.categories[i].id === id) return state.categories[i];
    }
    return { id: id, label: id, color: '#94a3b8' };
  }
  function gradClass(name) {
    // Map a name to a stable gradient slot 1..8
    var s = 0; for (var i = 0; i < name.length; i++) s = (s + name.charCodeAt(i)) % 8;
    return 'card__thumb--grad-' + (s + 1);
  }
  function buildCard(t) {
    var cat = categoryMeta(t.category);
    var initials = (t._name || 'GP').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'GP';
    var thumb = el('div', { class: 'card__thumb ' + gradClass(t._name) }, [initials]);
    if (t.minGpu) {
      thumb.appendChild(el('span', { class: 'card__badge' }, ['GPU']));
    } else {
      thumb.appendChild(el('span', { class: 'card__badge' }, ['CPU ok']));
    }

    var head = el('div', { class: 'card__head' }, [
      el('div', null, [
        el('h3', { class: 'card__title' }, [t._name]),
        el('p', { class: 'card__owner' }, [t._owner + '/' + t._repo])
      ])
    ]);

    var desc = el('p', { class: 'card__desc' }, [t.description || 'No description.']);

    var meta = el('div', { class: 'card__meta' }, [
      el('span', { class: 'card__meta__item', title: 'Stars on GitHub' }, [
        '★ ' + formatStars(t.stars)
      ]),
      el('span', { class: 'card__meta__item' }, [
        el('span', { class: 'card__meta__dot', style: 'background:' + cat.color }),
        ' ' + (t.language || 'Python')
      ])
    ]);

    var topics = el('div', { class: 'card__topics' },
      (t.topics || []).slice(0, 3).map(function (topic) {
        return el('span', { class: 'chip' }, [topic]);
      })
    );

    var deployCmd = buildDeployCommand(t);

    var foot = el('div', { class: 'card__foot' }, [
      el('button', {
        class: 'card__deploy',
        type: 'button',
        title: 'Copy deploy command',
        onclick: function (e) {
          e.stopPropagation();
          copyText(deployCmd).then(function () { showToast('Deploy command copied', 'ok'); });
        }
      }, ['⤴ Deploy']),
      el('a', {
        class: 'card__link',
        href: 'https://github.com/' + t._owner + '/' + t._repo,
        target: '_blank',
        rel: 'noopener',
        onclick: function (e) { e.stopPropagation(); }
      }, ['View on GitHub →'])
    ]);

    var card = el('article', {
      class: 'card',
      tabindex: '0',
      role: 'button',
      'aria-label': 'Open ' + t._name + ' details',
      onclick: function () { openModal(t); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(t); } }
    }, [thumb, head, desc, meta, topics, foot]);
    return card;
  }

  function buildDeployCommand(t) {
    var repo = 'https://github.com/' + t._owner + '/' + t._repo;
    var cmd  = 'gradio deploy --token YOUR_HF_TOKEN --repo ' + repo;
    if (t.gradioFile && t.gradioFile !== 'app.py') {
      cmd += ' --app-file ' + t.gradioFile;
    }
    return cmd;
  }

  /* ----------------------- Filter toolbar (chips) ----------------------- */
  function renderToolbar() {
    var any = state.activeCats.size || state.q;
    $toolbar.hidden = !any;
    $activeF.innerHTML = '';
    state.activeCats.forEach(function (id) {
      var c = categoryMeta(id);
      $activeF.appendChild(el('span', { class: 'toolbar__chip' }, [
        c.label,
        el('button', { type: 'button', 'aria-label': 'Remove ' + c.label, onclick: function () { toggleCategory(id); } }, ['×'])
      ]));
    });
    if (state.q) {
      $activeF.appendChild(el('span', { class: 'toolbar__chip' }, [
        '“' + state.q + '”',
        el('button', { type: 'button', 'aria-label': 'Clear search', onclick: function () { state.q = ''; $search.value = ''; writeURL(); render(); } }, ['×'])
      ]));
    }
  }

  /* ----------------------- Main render ----------------------- */
  function render() {
    var rows = visibleTools();
    $resultCount.innerHTML = '<strong>' + rows.length + '</strong> of ' + state.tools.length + ' tools';
    $results.innerHTML = '';
    if (rows.length === 0) {
      $empty.hidden = false;
    } else {
      $empty.hidden = true;
      var frag = document.createDocumentFragment();
      rows.forEach(function (t) { frag.appendChild(buildCard(t)); });
      $results.appendChild(frag);
    }
    renderToolbar();
  }

  /* ----------------------- Modal ----------------------- */
  function openModal(t) {
    var cat = categoryMeta(t.category);
    var deployCmd = buildDeployCommand(t);
    var repoURL = 'https://github.com/' + t._owner + '/' + t._repo;
    var spaceURL = t.spaceUrl;

    $modalTitle.textContent = t._name;
    $modalBody.innerHTML = '';

    // Header card
    var header = el('div', { class: 'modal__section' }, [
      el('p', { class: 'card__owner' }, [t._owner + '/' + t._repo]),
      el('p', { style: 'margin: 8px 0 0; color: var(--text-dim); font-size: var(--fs-md); line-height: 1.6;' }, [t.description || '—'])
    ]);
    $modalBody.appendChild(header);

    // Deploy command
    var deployHTML =
      '<div class="modal__section">' +
        '<h3>One-command deploy</h3>' +
        '<div class="deploy" id="deploy-block">' +
          '<button class="deploy__copy" id="deploy-copy" type="button">Copy</button>' +
          '<span class="tok-cmd">gradio deploy</span> ' +
          '<span class="tok-flag">--token</span> <span class="tok-value">YOUR_HF_TOKEN</span> ' +
          '<span class="tok-flag">--repo</span> <span class="tok-url">' + escapeHTML(repoURL) + '</span>' +
          (t.gradioFile && t.gradioFile !== 'app.py' ? ' <span class="tok-flag">--app-file</span> ' + escapeHTML(t.gradioFile) : '') +
        '</div>' +
        '<div class="help">' +
          '<strong>Get your token</strong> at <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener">huggingface.co/settings/tokens</a> ' +
          '(write access needed). Paste the command in any terminal with the <code>gradio</code> CLI installed ' +
          '(<code>pip install gradio</code>). Your Space is live in ~60 seconds.' +
        '</div>' +
      '</div>';
    $modalBody.insertAdjacentHTML('beforeend', deployHTML);

    // Stats
    var stats = el('div', { class: 'modal__section' }, [
      el('h3', null, ['At a glance']),
      (function () {
        var row = el('div', { class: 'stat-row' });
        row.appendChild(statTile('Stars', formatStars(t.stars)));
        row.appendChild(statTile('License', t.license || '—'));
        row.appendChild(statTile('GPU required', t.minGpu ? 'Yes (T4+ recommended)' : 'No (CPU ok)'));
        row.appendChild(statTile('Category', cat.label));
        if (t.pushedAt) row.appendChild(statTile('Last push', formatDate(t.pushedAt)));
        return row;
      })()
    ]);
    $modalBody.appendChild(stats);

    // Links
    var linkChildren = [
      el('h3', null, ['Links']),
      buildLinkRow('GH', 'GitHub repo', repoURL, repoURL),
      spaceURL ? buildLinkRow('HF', 'Hugging Face Space', spaceURL, spaceURL) : null,
      t.homepage ? buildLinkRow('⌂', 'Homepage', t.homepage, t.homepage) : null,
      buildLinkRow('📘', 'Gradio deploy guide', 'https://gradio.app/guides/sharing-your-app', 'gradio.app')
    ].filter(Boolean);
    var links = el('div', { class: 'modal__section' }, linkChildren);
    $modalBody.appendChild(links);

    // Notes
    if (t.notes) {
      var notes = el('div', { class: 'modal__section' }, [
        el('h3', null, ['Notes']),
        el('p', { style: 'margin: 0; color: var(--text-dim); font-size: var(--fs-sm); line-height: 1.6;' }, [t.notes])
      ]);
      $modalBody.appendChild(notes);
    }

    // Wire up the copy button
    var copyBtn = document.getElementById('deploy-copy');
    copyBtn.addEventListener('click', function () {
      copyText(deployCmd).then(function () {
        copyBtn.classList.add('is-copied');
        copyBtn.textContent = '✓ Copied';
        setTimeout(function () {
          copyBtn.classList.remove('is-copied');
          copyBtn.textContent = 'Copy';
        }, 1400);
      });
    });

    $modal.hidden = false;
    $modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    setTimeout(function () { $modalClose.focus(); }, 30);
  }
  function statTile(label, value) {
    return el('div', { class: 'stat-tile' }, [
      el('p', { class: 'stat-tile__label' }, [label]),
      el('p', { class: 'stat-tile__value' }, [String(value)])
    ]);
  }
  function buildLinkRow(icon, label, href, display) {
    return el('a', { class: 'link-row', href: href, target: '_blank', rel: 'noopener' }, [
      el('span', { class: 'link-row__icon' }, [icon]),
      el('span', { class: 'link-row__label' }, [label]),
      el('span', { class: 'link-row__url' }, [display.replace(/^https?:\/\//, '')])
    ]);
  }
  function closeModal() {
    $modal.hidden = true;
    $modal.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  $modal.addEventListener('click', function (e) { if (e.target === $modal) closeModal(); });
  $modalClose.addEventListener('click', closeModal);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$modal.hidden) closeModal();
  });

  /* ----------------------- Search wiring ----------------------- */
  var debouncedSearch = debounce(function (v) {
    state.q = v.trim();
    writeURL();
    render();
  }, 140);
  $search.addEventListener('input', function (e) { debouncedSearch(e.target.value); });
  $clearF.addEventListener('click', function () {
    state.activeCats.clear();
    state.q = '';
    $search.value = '';
    writeURL();
    renderSidebar();
    render();
  });

  /* ----------------------- Theme toggle ----------------------- */
  var themeBtn = document.getElementById('theme-toggle');
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('gpd-theme', theme); } catch (e) {}
  }
  function initTheme() {
    var saved;
    try { saved = localStorage.getItem('gpd-theme'); } catch (e) {}
    if (saved === 'light' || saved === 'dark') applyTheme(saved);
    else applyTheme('dark');
  }
  themeBtn.addEventListener('click', function () {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  initTheme();

  /* ----------------------- Keyboard shortcut: / to search ----------------------- */
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== $search && !$search.contains(document.activeElement)) {
      e.preventDefault();
      $search.focus();
      $search.select();
    }
  });

  /* ----------------------- Footer date ----------------------- */
  $footerDate.textContent = new Date().toISOString().slice(0, 10);

  /* ===================  HUB  ===================
     Renders the 12 personal sections below the directory.
     Each card opens the same modal as a tool, but the body
     is built from a different schema (kind: tasks | links | ideas | checklist).

     v2: each section has 5 versions (persona-lenses). The active version
     is selected via the version picker and persisted to localStorage + URL.
  ============================================= */

  function getActiveVersionBlock(section) {
    // Returns the {tagline, items, color} block for the active version,
    // falling back to the first available version if the active one
    // doesn't define this section.
    if (!section || !section.versions) return null;
    return section.versions[state.activeVersion] || section.versions.director || section.versions.builder || Object.values(section.versions)[0] || null;
  }

  function renderVersionPicker() {
    if (!$versionPills) return;
    $versionPills.innerHTML = '';
    var active = state.versions.find(function (v) { return v.id === state.activeVersion; }) || state.versions[0];
    state.versions.forEach(function (v) {
      var isActive = v.id === state.activeVersion;
      var pill = el('button', {
        class: 'version-pill' + (isActive ? ' is-active' : ''),
        type: 'button',
        role: 'tab',
        'aria-selected': isActive ? 'true' : 'false',
        style: '--pill-color: ' + v.color,
        title: v.tagline,
        onclick: function () { setVersion(v.id); }
      }, [
        el('span', { class: 'version-pill__icon' }, [v.icon || '◇']),
        el('span', { class: 'version-pill__label' }, [v.label])
      ]);
      $versionPills.appendChild(pill);
    });
    if (active && $versionHint) {
      $versionHint.textContent = active.tagline || '';
    }
  }

  function setVersion(v) {
    if (!v || v === state.activeVersion) return;
    var known = state.versions.some(function (x) { return x.id === v; });
    if (!known) return;
    state.activeVersion = v;
    try { localStorage.setItem(VERSION_STORAGE_KEY, v); } catch (e) {}
    writeURL();
    renderVersionPicker();
    renderHub();
  }

  function gradClassByName(name) {
    var s = 0; for (var i = 0; i < name.length; i++) s = (s + name.charCodeAt(i)) % 8;
    return 'hub-card__thumb--grad-' + (s + 1);
  }
  function buildHubCard(s) {
    var block = getActiveVersionBlock(s);
    var count = block && block.items ? block.items.length : 0;
    var tagline = block && block.tagline ? block.tagline : (s.tagline || '');
    var kindLabel = ({
      tasks: 'tasks',
      links: 'links',
      ideas: 'ideas',
      checklist: 'checklist'
    })[s.kind] || 'items';
    var thumb = el('div', { class: 'hub-card__thumb ' + gradClassByName(s.id) + ' hub-card__thumb--' + s.kind }, [s.icon || '◇']);
    var head = el('div', { class: 'hub-card__head' }, [
      el('h3', { class: 'hub-card__title' }, [s.title])
    ]);
    var taglineEl = el('p', { class: 'hub-card__tagline' }, [tagline]);
    var meta = el('div', { class: 'hub-card__meta' }, [
      el('span', { class: 'hub-card__count' }, [String(count) + ' ' + kindLabel]),
      el('span', { class: 'hub-card__kind', style: 'color:' + s.color }, [s.kind])
    ]);
    var card = el('article', {
      class: 'hub-card',
      tabindex: '0',
      role: 'button',
      'aria-label': 'Open ' + s.title + ' section',
      onclick: function () { openSectionModal(s); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSectionModal(s); } }
    }, [thumb, head, taglineEl, meta]);
    return card;
  }
  function renderHub() {
    if (!$hubGrid) return;
    $hubGrid.innerHTML = '';
    if ($hubCount) $hubCount.innerHTML = '<strong>' + state.sections.length + '</strong> sections · <span class="hub__version-tag">' + (state.versions.find(function (v) { return v.id === state.activeVersion; }) || { label: state.activeVersion, icon: '◇' }).icon + ' ' + ((state.versions.find(function (v) { return v.id === state.activeVersion; }) || { label: state.activeVersion }).label) + '</span>';
    var frag = document.createDocumentFragment();
    state.sections.forEach(function (s) { frag.appendChild(buildHubCard(s)); });
    $hubGrid.appendChild(frag);
  }

  function openSectionModal(s) {
    var block = getActiveVersionBlock(s);
    var items = block && block.items ? block.items : [];
    var tagline = block && block.tagline ? block.tagline : (s.tagline || '');
    var activeVer = state.versions.find(function (v) { return v.id === state.activeVersion; });

    $modalTitle.textContent = s.title;
    $modalBody.innerHTML = '';

    // Header
    var header = el('div', { class: 'modal__section' }, [
      el('p', { class: 'card__owner' }, [tagline]),
      el('p', { style: 'margin: 8px 0 0; color: var(--text-dim); font-size: var(--fs-sm); display:flex; gap:8px; align-items:center; flex-wrap:wrap;' }, [
        el('span', null, [String(items.length) + ' ' + (s.kind || 'items') + ' · click any link to open in a new tab.']),
        activeVer ? el('span', { class: 'hub-modal__version', style: 'color:' + activeVer.color }, [(activeVer.icon || '◇') + ' ' + activeVer.label + ' lens']) : null
      ])
    ]);
    $modalBody.appendChild(header);

    // In-modal version switcher (so users can change lens without closing)
    if (state.versions.length > 1) {
      var switcher = el('div', { class: 'hub-modal__switcher' });
      state.versions.forEach(function (v) {
        var isActive = v.id === state.activeVersion;
        switcher.appendChild(el('button', {
          class: 'hub-modal__switcher-pill' + (isActive ? ' is-active' : ''),
          type: 'button',
          style: '--pill-color: ' + v.color,
          onclick: function () {
            setVersion(v.id);
            // Re-open the same section with the new lens
            openSectionModal(s);
          }
        }, [(v.icon || '◇') + ' ' + v.label]));
      });
      $modalBody.appendChild(switcher);
    }

    // Items — rendered differently per kind
    var body = el('div', { class: 'modal__section' });
    if (s.kind === 'tasks' || s.kind === 'checklist' || s.kind === 'ideas') {
      items.forEach(function (it) {
        var row = el('div', { class: 'hub-row' });
        if (s.kind === 'checklist' || s.kind === 'tasks') {
          var cb = el('span', { class: 'hub-row__cb' + (it.done ? ' is-done' : '') }, [it.done ? '✓' : '○']);
          row.appendChild(cb);
        } else if (s.kind === 'ideas') {
          row.appendChild(el('span', { class: 'hub-row__cb', style: 'color:' + s.color }, ['💡']));
        }
        var txt = el('span', { class: 'hub-row__text' + (it.done ? ' is-done' : '') }, [it.text || '']);
        row.appendChild(txt);
        if (it.tag) {
          row.appendChild(el('span', { class: 'hub-row__tag' }, [it.tag]));
        }
        body.appendChild(row);
      });
    } else if (s.kind === 'links') {
      items.forEach(function (it) {
        var row = el('a', {
          class: 'hub-link',
          href: it.url,
          target: '_blank',
          rel: 'noopener'
        }, [
          el('span', { class: 'hub-link__arrow', style: 'color:' + (s.color || 'var(--accent)') }, ['→']),
          el('span', { class: 'hub-link__text' }, [it.text || it.url]),
          it.tag ? el('span', { class: 'hub-link__tag' }, [it.tag]) : null
        ]);
        body.appendChild(row);
      });
    }
    $modalBody.appendChild(body);

    // Footer note
    var foot = el('div', { class: 'modal__section' }, [
      el('p', { style: 'margin:0; color: var(--text-faint); font-family: var(--font-mono); font-size: var(--fs-xs);' }, [
        'Source: data/hub.json · v' + (s._version || '2.0.0') + ' · ' + (activeVer ? activeVer.label : 'default') + ' lens · ' + items.length + ' items'
      ])
    ]);
    $modalBody.appendChild(foot);

    $modal.hidden = false;
    $modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    setTimeout(function () { $modalClose.focus(); }, 30);
  }

  /* ----------------------- Go ----------------------- */
  bootstrap();
})();
