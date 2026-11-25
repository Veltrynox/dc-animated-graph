/* DC Animated Graph — plain JS + Cytoscape. Data: data/titles.json */
(async function () {
  const W = 80, H = 120;          // poster node size
  const GX = 104, GY = 176;       // grid spacing
  const LABEL_W = 230;            // room for row labels

  const titles = window.__TITLES__ || await fetch('data/titles.json').then(r => r.json());
  const byId = Object.fromEntries(titles.map(t => [t.id, t]));
  const year = t => parseInt(String(t.releaseDate).slice(0, 4), 10);

  // ---------- graph elements ----------
  const nodes = titles.map(t => ({ group: 'nodes', data: { id: t.id, label: t.title, poster: t.thumb || t.poster }, classes: 'title' }));
  const edges = [];
  titles.forEach(t => t.links.forEach(src => edges.push({ group: 'edges', data: { id: src + '>' + t.id, source: src, target: t.id } })));

  const cy = cytoscape({
    container: document.getElementById('cy'),
    elements: [...nodes, ...edges],
    minZoom: 0.08, maxZoom: 3, wheelSensitivity: 0.25,
    style: [
      { selector: 'node.title', style: {
        shape: 'round-rectangle', width: W, height: H,
        'background-color': '#1b2030', 'background-image': 'data(poster)', 'background-fit': 'cover',
        'background-image-crossorigin': 'null', 'background-image-opacity': 1,
        'border-width': 1, 'border-color': '#2d3446',
        label: 'data(label)', color: '#c9cfdb', 'font-size': 9, 'text-valign': 'bottom', 'text-margin-y': 5,
        'text-wrap': 'wrap', 'text-max-width': GX - 8, 'min-zoomed-font-size': 7,
        'transition-property': 'opacity, border-color, border-width', 'transition-duration': '180ms'
      } },
      { selector: 'node.rowlabel', style: {
        shape: 'rectangle', width: 1, height: 1, 'background-opacity': 0, label: 'data(label)',
        color: '#8a93a6', 'font-size': 15, 'font-weight': 600, 'text-halign': 'left', 'text-valign': 'center',
        'text-wrap': 'wrap', 'text-max-width': LABEL_W - 30, events: 'no', 'min-zoomed-font-size': 6
      } },
      { selector: 'node.collabel', style: {
        shape: 'rectangle', width: 1, height: 1, 'background-opacity': 0, label: 'data(label)',
        color: '#8a93a6', 'font-size': 16, 'font-weight': 700, 'text-valign': 'top', events: 'no'
      } },
      { selector: 'edge', style: {
        width: 2, 'line-color': '#0476f2', opacity: 0.55, 'curve-style': 'unbundled-bezier',
        'control-point-distances': 40, 'control-point-weights': 0.5,
        'target-arrow-shape': 'triangle', 'target-arrow-color': '#0476f2', 'arrow-scale': 0.8
      } },
      { selector: 'node.title:selected', style: { 'border-width': 4, 'border-color': '#fff' } },
      { selector: 'node.title.seen', style: { 'background-image-opacity': 0.2, 'background-color': '#11141c', color: '#4a5163', 'border-color': '#1c2130' } },
      { selector: '.dim', style: { opacity: 0.12 } },
      { selector: 'node.hl', style: { 'border-width': 4, 'border-color': '#ffcf33' } },
      { selector: 'edge.hl', style: { opacity: 0.9, 'line-color': '#ffcf33', 'target-arrow-color': '#ffcf33' } }
    ]
  });

  // ---------- layouts (all preset positions) ----------
  function clearLabels() { cy.remove('.rowlabel, .collabel'); }
  function addLabel(cls, id, label, x, y) {
    cy.add({ group: 'nodes', data: { id, label }, classes: cls, position: { x, y }, selectable: false, grabbable: false });
  }
  function rows(groups) {
    // groups: [{label, items:[title...]}] -> each group one row (wrapping after 16)
    const pos = {}; let y = 0; const PER = 16;
    groups.forEach((g, gi) => {
      addLabel('rowlabel', 'row-' + gi, g.label, -24, y);
      g.items.forEach((t, i) => {
        pos[t.id] = { x: (i % PER) * GX + W / 2, y: y + Math.floor(i / PER) * GY };
      });
      y += Math.ceil(g.items.length / PER) * GY + 40;
    });
    return pos;
  }

  function timelinePositions() {
    const years = [...new Set(titles.map(year))].sort((a, b) => a - b);
    const pos = {};
    years.forEach((yr, xi) => {
      const items = titles.filter(t => year(t) === yr).sort((a, b) => a.title.localeCompare(b.title));
      addLabel('collabel', 'yr-' + yr, String(yr), xi * GX, -H / 2 - 18);
      items.forEach((t, i) => { pos[t.id] = { x: xi * GX, y: i * GY }; });
    });
    return pos;
  }

  function collectionPositions() {
    const groups = {};
    titles.forEach(t => (groups[t.collection] ||= []).push(t));
    const list = Object.entries(groups).map(([label, items]) => ({
      label: `${label} (${items.length})`,
      items: items.sort((a, b) => (a.storyOrder ?? 1e9) - (b.storyOrder ?? 1e9) || year(a) - year(b)),
      first: Math.min(...items.map(year)), standalone: label === 'Standalone'
    }));
    list.sort((a, b) => a.standalone - b.standalone || a.first - b.first);
    return rows(list);
  }

  function storyPositions() {
    // connected components over links; chains as rows, longest first; singletons at the end
    const adj = Object.fromEntries(titles.map(t => [t.id, new Set()]));
    titles.forEach(t => t.links.forEach(s => { adj[t.id].add(s); adj[s].add(t.id); }));
    const seen = new Set(); const comps = [];
    titles.forEach(t => {
      if (seen.has(t.id)) return;
      const stack = [t.id], comp = []; seen.add(t.id);
      while (stack.length) { const id = stack.pop(); comp.push(byId[id]); adj[id].forEach(n => { if (!seen.has(n)) { seen.add(n); stack.push(n); } }); }
      comps.push(comp);
    });
    // depth = longest path from a root (title with no links)
    const depthMemo = {};
    const depth = id => depthMemo[id] ??= (byId[id].links.length ? 1 + Math.max(...byId[id].links.map(depth)) : 0);
    const chains = comps.filter(c => c.length > 1)
      .map(c => ({ items: c.sort((a, b) => depth(a.id) - depth(b.id) || year(a) - year(b)) }))
      .sort((a, b) => b.items.length - a.items.length || year(a.items[0]) - year(b.items[0]))
      .map(c => ({ label: `${c.items[0].collection} (${c.items.length})`, items: c.items }));
    const singles = comps.filter(c => c.length === 1).map(c => c[0]).sort((a, b) => year(a) - year(b));
    if (singles.length) chains.push({ label: `No chain (${singles.length})`, items: singles });
    return rows(chains);
  }

  const layouts = { timeline: timelinePositions, collection: collectionPositions, story: storyPositions };
  function applyLayout(name) {
    clearLabels();
    const pos = layouts[name]();
    cy.layout({ name: 'preset', positions: n => pos[n.id()] || n.position(), animate: true, animationDuration: 450,
      fit: true, padding: 40 }).run();
    document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.layout === name));
    try { localStorage.setItem('dcgraph.layout', name); } catch (e) {}
  }
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => applyLayout(b.dataset.layout)));

  // ---------- character picker ----------
  const charCounts = {};
  titles.forEach(t => t.characters.forEach(c => { charCounts[c] = (charCounts[c] || 0) + 1; }));
  const charNames = Object.keys(charCounts).sort((a, b) => charCounts[b] - charCounts[a] || a.localeCompare(b));
  document.getElementById('charList').innerHTML =
    charNames.map(c => `<option value="${c.replace(/"/g, '&quot;')}">${charCounts[c]} titles</option>`).join('');
  const input = document.getElementById('charInput'), clearBtn = document.getElementById('charClear'),
        countEl = document.getElementById('charCount');

  let activeChar = null;
  function highlight(name) {
    cy.elements().removeClass('dim hl');
    activeChar = name && charCounts[name] ? name : null;
    clearBtn.hidden = !activeChar; countEl.textContent = '';
    if (!activeChar) { input.value = name ? input.value : ''; renderPanelChips(); return; }
    input.value = activeChar;
    const hit = cy.nodes('.title').filter(n => byId[n.id()].characters.includes(activeChar));
    cy.nodes('.title').not(hit).addClass('dim');
    hit.addClass('hl');
    cy.edges().forEach(e => (hit.contains(e.source()) && hit.contains(e.target())) ? e.addClass('hl') : e.addClass('dim'));
    countEl.textContent = `${hit.length} of ${titles.length}`;
    renderPanelChips();
  }
  input.addEventListener('change', () => highlight(input.value.trim()));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') highlight(input.value.trim()); if (e.key === 'Escape') highlight(null); });
  clearBtn.addEventListener('click', () => highlight(null));

  // ---------- seen (IMDb ratings -> data/seen.js) ----------
  const SEEN = window.__SEEN__ || {};
  const imdbId = t => ((t.imdb || '').match(/tt\d+/) || [])[0];
  const myRating = t => SEEN[imdbId(t)];
  const seenToggle = document.getElementById('seenToggle'), seenCount = document.getElementById('seenCount');
  const seenN = titles.filter(t => myRating(t) != null).length;
  function applySeen() {
    const on = seenToggle.checked;
    cy.nodes('.title').forEach(n => n.toggleClass('seen', on && myRating(byId[n.id()]) != null));
    seenCount.textContent = on ? `${seenN} of ${titles.length}` : '';
    try { localStorage.setItem('dcgraph.greySeen', on ? '1' : '0'); } catch (e) {}
  }
  try { seenToggle.checked = localStorage.getItem('dcgraph.greySeen') === '1'; } catch (e) {}
  seenToggle.addEventListener('change', applySeen);
  if (!seenN) seenToggle.parentElement.hidden = true;

  // ---------- side panel ----------
  const panel = document.getElementById('panel');
  let current = null;
  function renderPanelChips() {
    if (!current) return;
    document.getElementById('pChars').innerHTML = current.characters
      .map(c => `<li class="${c === activeChar ? 'on' : ''}">${c}</li>`).join('');
    document.querySelectorAll('#pChars li').forEach(li =>
      li.addEventListener('click', () => highlight(li.textContent === activeChar ? null : li.textContent)));
  }
  function openPanel(id) {
    const t = byId[id]; current = t; panel.hidden = false;
    document.getElementById('pPoster').src = t.thumb || t.poster;
    document.getElementById('pPoster').alt = t.title + ' poster';
    document.getElementById('pTitle').textContent = t.title;
    document.getElementById('pDate').textContent = t.releaseDate;
    document.getElementById('pColl').textContent = t.collection + (t.storyOrder ? ` · #${t.storyOrder}` : '');
    document.getElementById('pType').textContent = t.type;
    const r = myRating(t);
    document.getElementById('pSeenDt').hidden = document.getElementById('pSeen').hidden = r == null;
    document.getElementById('pSeen').textContent = r != null ? `★ ${r}/10` : '';
    document.getElementById('pSource').href = t.sourceUrl;
    const im = document.getElementById('pImdb'); im.hidden = !t.imdb; if (t.imdb) im.href = t.imdb;
    const prev = t.links.map(l => ['Follows', byId[l]]);
    const next = titles.filter(x => x.links.includes(t.id)).map(x => ['Followed by', x]);
    const all = [...prev, ...next];
    document.getElementById('pLinksWrap').hidden = !all.length;
    document.getElementById('pLinks').innerHTML = all.map(([k, x]) => `<li data-id="${x.id}">${k}: ${x.title}</li>`).join('');
    document.querySelectorAll('#pLinks li').forEach(li => li.addEventListener('click', () => {
      const n = cy.getElementById(li.dataset.id); cy.$(':selected').unselect(); n.select();
      cy.animate({ center: { eles: n }, duration: 300 }); openPanel(li.dataset.id);
    }));
    renderPanelChips();
    cy.resize();
  }
  cy.on('tap', 'node.title', e => openPanel(e.target.id()));
  document.getElementById('panelClose').addEventListener('click', () => { panel.hidden = true; current = null; cy.$(':selected').unselect(); cy.resize(); });

  document.getElementById('stats').textContent =
    `${titles.length} titles · ${edges.length} story links · ${charNames.length} characters`;

  let start = 'timeline';
  try { start = localStorage.getItem('dcgraph.layout') || start; } catch (e) {}
  applyLayout(layouts[start] ? start : 'timeline');
  applySeen();
})();
