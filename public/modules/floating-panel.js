// Floating panel manager — panels that overlay the HUD without blocking Vader.
// Panels appear over the canvas, animated, with Iron Man corner brackets.
// Each panel has a stable ID: opening the same ID twice updates content instead
// of creating a duplicate.
//
// Layout rules:
//   - Panels in the same zone stack vertically, measured from actual rendered height.
//   - Once a user manually drags a panel, it is excluded from auto-reflow.
//   - When any panel closes, remaining panels in that zone reflow upward (animated).

const _panels = new Map(); // id → { el, zone, _dragged }

const ZONE_X = {
  right: (el) => { el.style.right = '20px'; el.style.left = 'auto'; },
  left:  (el) => { el.style.left  = '20px'; el.style.right = 'auto'; },
};

const TOP_START = 74;  // px from viewport top (below HUD header)
const GAP       = 12;  // px gap between stacked panels

/**
 * Reposition all non-dragged panels in a zone so they stack vertically
 * without overlapping. Called after any open or close.
 */
function _reflow(zone) {
  if (zone === 'center' || zone === 'top') return;

  const entries = [..._panels.values()].filter(p => p.zone === zone && !p._dragged);
  let top = TOP_START;

  for (const p of entries) {
    const posX = ZONE_X[zone];
    if (posX) posX(p.el);
    p.el.style.top = `${top}px`;
    // Use actual rendered height; fall back to 300 if not yet laid out.
    top += (p.el.offsetHeight || 300) + GAP;
  }
}

function _esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _create(id, zone, title, width) {
  const el = document.createElement('div');
  el.className = `fp fp-zone-${zone}`;
  el.dataset.fpId   = id;
  el.dataset.fpZone = zone;
  el.style.width    = width;

  el.innerHTML = `
    <div class="fp-bar">
      <span class="fp-title">${_esc(title || id.toUpperCase())}</span>
      <div class="fp-bar-actions">
        <button class="fp-close icon-btn" title="Cerrar" aria-label="Cerrar panel">✕</button>
      </div>
    </div>
    <div class="fp-body fp-body-scroll"></div>
  `;

  el.querySelector('.fp-close').addEventListener('click', () => close(id));
  _makeDraggable(el);

  const hud = document.getElementById('hud');
  hud.appendChild(el);

  // Reflow BEFORE the entry animation so the panel starts at the correct position.
  // (Adding fp-in happens two frames later so no visible jump.)
  _reflow(zone);

  // Two-frame trick so the CSS transition actually plays from the initial state.
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('fp-in')));

  return el;
}

function _makeDraggable(panel) {
  const bar = panel.querySelector('.fp-bar');
  bar.style.cursor = 'grab';

  bar.addEventListener('mousedown', (e) => {
    if (e.target.closest('.fp-bar-actions')) return;
    e.preventDefault();

    // Mark as manually positioned — exclude from auto-reflow from now on.
    const entry = _panels.get(panel.dataset.fpId);
    if (entry) entry._dragged = true;

    // Convert right/top to left/top so we can move freely.
    const rect = panel.getBoundingClientRect();
    panel.style.left      = `${rect.left}px`;
    panel.style.top       = `${rect.top}px`;
    panel.style.right     = 'auto';
    panel.style.bottom    = 'auto';
    panel.style.transform = 'none';

    let prevX = e.clientX;
    let prevY = e.clientY;
    bar.style.cursor       = 'grabbing';
    panel.style.transition = 'none'; // no transition while dragging

    const onMove = (e) => {
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      prevX = e.clientX;
      prevY = e.clientY;
      const maxX = window.innerWidth  - panel.offsetWidth;
      const maxY = window.innerHeight - panel.offsetHeight;
      panel.style.left = `${Math.max(0, Math.min(maxX, parseFloat(panel.style.left) + dx))}px`;
      panel.style.top  = `${Math.max(0, Math.min(maxY, parseFloat(panel.style.top)  + dy))}px`;
    };

    const onUp = () => {
      bar.style.cursor       = 'grab';
      panel.style.transition = ''; // restore
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Open or update a floating panel.
 * @param {string} id         Stable identifier (e.g. 'emails', 'agenda')
 * @param {object} opts
 *   title       {string}   Panel header label
 *   content     {string}   Inner HTML for the body
 *   contentNode {Node}     DOM node to append to the body
 *   zone        {string}   'right' | 'left' | 'center' | 'top'
 *   width       {string}   CSS width, default '400px'
 */
export function open(id, opts = {}) {
  const { title, content, contentNode, zone = 'right', width = '400px' } = opts;

  let entry = _panels.get(id);

  if (!entry) {
    const el = _create(id, zone, title, width);
    entry = { el, zone, _dragged: false };
    _panels.set(id, entry);
  } else {
    if (title) entry.el.querySelector('.fp-title').textContent = title;
  }

  const body = entry.el.querySelector('.fp-body');
  body.innerHTML = '';
  if (contentNode) body.appendChild(contentNode);
  else if (content !== undefined) body.innerHTML = content;

  // Reflow after content update (height may have changed).
  _reflow(entry.zone);

  return entry.el;
}

/**
 * Close a panel by ID with exit animation.
 */
export function close(id) {
  const entry = _panels.get(id);
  if (!entry) return;
  const zone = entry.zone;
  _panels.delete(id);
  const { el } = entry;
  el.classList.remove('fp-in');
  el.classList.add('fp-out');
  const cleanup = () => el.remove();
  el.addEventListener('transitionend', cleanup, { once: true });
  setTimeout(cleanup, 500);
  // Reflow remaining panels in this zone after exit animation starts.
  _reflow(zone);
}

/** Toggle open/close. */
export function toggle(id, opts) {
  if (_panels.has(id)) close(id);
  else open(id, opts);
}

export function isOpen(id)  { return _panels.has(id); }

export function closeAll() {
  for (const id of [..._panels.keys()]) close(id);
}

/** Get the body element of an open panel (useful for appending nodes after open). */
export function getBody(id) {
  return _panels.get(id)?.el.querySelector('.fp-body') || null;
}

/**
 * Show a self-dismissing toast at the top of the HUD.
 */
export function toast({ id = 'fp-toast', title = '', content = '', ms = 6000, zone = 'top', width = '560px' } = {}) {
  open(id, { title, content, zone, width });
  setTimeout(() => close(id), ms);
}
