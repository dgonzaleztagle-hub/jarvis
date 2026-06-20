import { el } from './state.js';
import { api } from './api.js';

/* ─── GRAFO DE CONOCIMIENTO — vista nodo-enlace estilo Obsidian ─────────────────
   Backend: GET /graph (entities/facts/relationships/commitments, solo lectura).
   Simulación de fuerzas simple (repulsión + resorte + centrado) en <canvas>,
   sin librerías externas — consistente con "vanilla JS, sin bundler". */

const ENTITY_COLORS = {
  person: '#5ec8ff',
  project: '#2bff88',
  org: '#ffaa33',
  place: '#ff7ad9',
  tool: '#c792ea',
  concept: '#9aa5b1',
  event: '#ff5050'
};

const NODE_RADIUS = 6;
const HIT_RADIUS_SQ = 100;

export async function renderKnowledgeGraph(container) {
  container.innerHTML = '';
  const data = await api('/graph').catch(() => null);

  if (!data || !(data.entities || []).length) {
    const ph = el('div', 'artifact-placeholder');
    ph.innerHTML = '<span class="art-icon">🕸</span><span>Sin entidades en el grafo todavía.</span>';
    container.appendChild(ph);
    return;
  }

  const wrap = el('div', 'graph-wrap');
  const canvas = document.createElement('canvas');
  canvas.className = 'graph-canvas';
  wrap.appendChild(canvas);
  const info = el('div', 'graph-info');
  info.appendChild(el('div', 'graph-info-empty', 'Click en un nodo para ver su detalle. Arrastra para mover, rueda para zoom.'));
  wrap.appendChild(info);
  container.appendChild(wrap);

  const nodes = data.entities.map((e, i) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    x: 300 + Math.cos(i) * 150 + Math.random() * 40,
    y: 200 + Math.sin(i) * 150 + Math.random() * 40,
    vx: 0,
    vy: 0
  }));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges = (data.relationships || [])
    .filter((r) => nodeById.has(r.fromId) && nodeById.has(r.toId))
    .map((r) => ({ source: nodeById.get(r.fromId), target: nodeById.get(r.toId), type: r.type }));

  const ctx = canvas.getContext('2d');
  const transform = { x: 0, y: 0, scale: 1 };
  let dragNode = null;
  let panStart = null;
  let selected = null;

  function resize() {
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }
  resize();
  window.addEventListener('resize', resize);

  function step() {
    const rect = wrap.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const distSq = Math.max(dx * dx + dy * dy, 1);
        const dist = Math.sqrt(distSq);
        const force = 2200 / distSq;
        dx /= dist; dy /= dist;
        a.vx += dx * force; a.vy += dy * force;
        b.vx -= dx * force; b.vy -= dy * force;
      }
    }

    for (const e of edges) {
      let dx = e.target.x - e.source.x;
      let dy = e.target.y - e.source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - 140) * 0.02;
      dx /= dist; dy /= dist;
      e.source.vx += dx * force; e.source.vy += dy * force;
      e.target.vx -= dx * force; e.target.vy -= dy * force;
    }

    for (const n of nodes) {
      if (n === dragNode) continue;
      n.vx += (cx - n.x) * 0.0008;
      n.vy += (cy - n.y) * 0.0008;
      n.vx *= 0.82; n.vy *= 0.82;
      n.x += n.vx; n.y += n.vy;
    }
  }

  function draw() {
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);

    ctx.strokeStyle = 'rgba(0, 229, 255, 0.25)';
    ctx.lineWidth = 1;
    for (const e of edges) {
      ctx.beginPath();
      ctx.moveTo(e.source.x, e.source.y);
      ctx.lineTo(e.target.x, e.target.y);
      ctx.stroke();
    }

    for (const n of nodes) {
      const r = n === selected ? NODE_RADIUS + 3 : NODE_RADIUS;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = ENTITY_COLORS[n.type] || '#9aa5b1';
      ctx.fill();
      if (n === selected) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
      ctx.fillStyle = '#cfe9f5';
      ctx.font = '11px sans-serif';
      ctx.fillText(n.name, n.x + r + 4, n.y + 3);
    }
    ctx.restore();
  }

  let rafId;
  function tick() {
    step();
    draw();
    rafId = requestAnimationFrame(tick);
  }
  tick();

  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - transform.x) / transform.scale,
      y: (clientY - rect.top - transform.y) / transform.scale
    };
  }

  function nodeAt(x, y) {
    for (const n of nodes) {
      const dx = n.x - x;
      const dy = n.y - y;
      if (dx * dx + dy * dy < HIT_RADIUS_SQ) return n;
    }
    return null;
  }

  function showInfo(n) {
    info.innerHTML = '';
    if (!n) {
      info.appendChild(el('div', 'graph-info-empty', 'Click en un nodo para ver su detalle. Arrastra para mover, rueda para zoom.'));
      return;
    }
    info.appendChild(el('div', 'graph-info-title', `${n.name} (${n.type})`));

    const facts = (data.facts || []).filter((f) => f.subjectId === n.id && f.state !== 'rejected' && f.state !== 'obsolete');
    if (facts.length) {
      const box = el('div', 'graph-info-section');
      box.appendChild(el('div', 'graph-info-label', 'HECHOS'));
      for (const f of facts) {
        box.appendChild(el('div', `graph-info-fact${f.state !== 'verified' ? ' candidate' : ''}`, `${f.predicate}: ${f.object}`));
      }
      info.appendChild(box);
    }

    const rels = (data.relationships || [])
      .filter((r) => r.fromId === n.id || r.toId === n.id)
      .map((r) => {
        const otherId = r.fromId === n.id ? r.toId : r.fromId;
        const other = nodeById.get(otherId);
        const arrow = r.fromId === n.id ? '→' : '←';
        return `${arrow} ${r.type} ${arrow} ${other ? other.name : '?'}`;
      });
    if (rels.length) {
      const box = el('div', 'graph-info-section');
      box.appendChild(el('div', 'graph-info-label', 'RELACIONES'));
      for (const r of rels) box.appendChild(el('div', 'graph-info-fact', r));
      info.appendChild(box);
    }

    if (!facts.length && !rels.length) {
      info.appendChild(el('div', 'graph-info-empty', 'Sin hechos ni relaciones registradas.'));
    }
  }

  canvas.addEventListener('mousedown', (e) => {
    const { x, y } = toWorld(e.clientX, e.clientY);
    const n = nodeAt(x, y);
    if (n) { dragNode = n; canvas.style.cursor = 'grabbing'; return; }
    panStart = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
    canvas.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (dragNode) {
      const { x, y } = toWorld(e.clientX, e.clientY);
      dragNode.x = x; dragNode.y = y;
      dragNode.vx = 0; dragNode.vy = 0;
    } else if (panStart) {
      transform.x = panStart.tx + (e.clientX - panStart.x);
      transform.y = panStart.ty + (e.clientY - panStart.y);
    }
  });

  window.addEventListener('mouseup', () => {
    dragNode = null;
    panStart = null;
    canvas.style.cursor = 'grab';
  });

  canvas.addEventListener('click', (e) => {
    const { x, y } = toWorld(e.clientX, e.clientY);
    selected = nodeAt(x, y);
    showInfo(selected);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    transform.scale = Math.min(3, Math.max(0.2, transform.scale * factor));
  }, { passive: false });

  // El modal se cierra reseteando .innerHTML; cuando el canvas sale del DOM
  // paramos el loop de animación para no dejarlo corriendo de fondo.
  const observer = new MutationObserver(() => {
    if (!document.body.contains(canvas)) {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
