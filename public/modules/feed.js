import { state, dom, el } from './state.js';
import { speakText } from './voice.js';

/* ─── HELPERS ───────────────────────────────────────────────────────────────── */
export function looksStructured(text='') { return /\n[-*]\s|\n\d+\.\s|:\n/.test(String(text||'')); }

export function buildNarration(result={}) {
  // Contrato de voz: speak ES la narración completa; visual es pantalla y ya
  // está visible en el feed — leerlo encima es redundante. Visual solo se
  // narra como fallback cuando el modelo no entregó speak.
  const speak=String(result.speak||'').trim(), visual=String(result.visual||'').trim();
  return speak || visual;
}

export function buildDisplay(result={}) {
  const speak=String(result.speak||'').trim(), visual=String(result.visual||'').trim();
  if (!visual) return speak; if (!speak) return visual;
  const ns=speak.replace(/\s+/g,' '), nv=visual.replace(/\s+/g,' ');
  if (!nv||nv===ns) return visual.length>=speak.length?visual:speak;
  if (nv.includes(ns)) return visual; if (ns.includes(nv)) return speak;
  return [visual,speak].filter(Boolean).join('\n\n');
}

/* ─── MARKDOWN RENDERER ─────────────────────────────────────────────────────── */
export function decodeHtmlEntities(text) {
  return String(text||'')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/&#(\d+);/g,(_,code)=>String.fromCharCode(Number(code)));
}

function renderInlineMarkdown(line) {
  const frag=document.createDocumentFragment();
  const pat=/\*\*(.+?)\*\*|`([^`]+)`|(https?:\/\/[^\s]+)/g;
  let last=0;
  for (const m of line.matchAll(pat)) {
    if (m.index>last) frag.appendChild(document.createTextNode(line.slice(last,m.index)));
    if (m[1]!==undefined) {
      const b=document.createElement('strong'); b.textContent=m[1]; frag.appendChild(b);
    } else if (m[2]!==undefined) {
      const c=document.createElement('code');
      c.textContent=m[2];
      c.style.cssText='font-family:var(--font-mono);font-size:11px;background:rgba(0,212,255,0.08);padding:1px 4px;border-radius:3px;color:var(--cyan-dim)';
      frag.appendChild(c);
    } else if (m[3]!==undefined) {
      const a=document.createElement('a'); a.href=m[3]; a.target='_blank'; a.rel='noreferrer noopener'; a.textContent=m[3]; frag.appendChild(a);
    }
    last=m.index+m[0].length;
  }
  if (last<line.length) frag.appendChild(document.createTextNode(line.slice(last)));
  return frag;
}

export function appendRichText(container, text) {
  container.textContent='';
  const lines=decodeHtmlEntities(String(text||'')).split('\n');
  let inList=false, listEl=null;
  const flushList=()=>{ if(listEl){container.appendChild(listEl);listEl=null;inList=false;} };

  // Collapse blank lines between consecutive list items
  const normalized=[];
  for (let i=0;i<lines.length;i++) {
    if (lines[i]===''&&/^[\s]*[-*\d]/.test(lines[i+1]||'')) continue;
    normalized.push(lines[i]);
  }

  for (const rawLine of normalized) {
    const ulMatch=rawLine.match(/^[\s]*[-*]\s+(.*)/);
    const olMatch=rawLine.match(/^[\s]*\d+\.\s+(.*)/);
    if (ulMatch||olMatch) {
      const tag=olMatch?'ol':'ul';
      if (!inList||listEl?.tagName.toLowerCase()!==tag) {
        flushList();
        listEl=document.createElement(tag);
        listEl.style.cssText='margin:4px 0 4px 16px;padding:0';
        listEl.style.listStyle=olMatch?'decimal':'disc';
        inList=true;
      }
      const li=document.createElement('li'); li.style.cssText='margin:2px 0;line-height:1.5';
      li.appendChild(renderInlineMarkdown(ulMatch?ulMatch[1]:olMatch[1]));
      listEl.appendChild(li);
    } else {
      flushList();
      if (rawLine==='') { container.appendChild(document.createElement('br')); }
      else { const span=document.createElement('span'); span.style.display='block'; span.appendChild(renderInlineMarkdown(rawLine)); container.appendChild(span); }
    }
  }
  flushList();
}

/* ─── TYPING INDICATOR ──────────────────────────────────────────────────────── */
let typingEl=null;

export function showTyping() {
  if (typingEl) return;
  if (dom.feedEmpty) { dom.feedEmpty.remove(); dom.feedEmpty=null; }
  typingEl=el('div','msg jarvis');
  const ind=el('div','typing-indicator');
  ind.appendChild(el('span','typing-dot')); ind.appendChild(el('span','typing-dot')); ind.appendChild(el('span','typing-dot'));
  typingEl.appendChild(ind);
  dom.feed.appendChild(typingEl);
  dom.feed.scrollTop=dom.feed.scrollHeight;
}

export function hideTyping() { if(typingEl){typingEl.remove();typingEl=null;} }

/* ─── MESSAGES ──────────────────────────────────────────────────────────────── */
export function addMessage(kind, label, text, opts={}) {
  if (dom.feedEmpty) { dom.feedEmpty.remove(); dom.feedEmpty=null; }
  const msg=el('div',`msg ${kind||''}`);
  const labelRow=el('div','msg-label-row');
  labelRow.appendChild(el('span','msg-label',label.toUpperCase()));
  const ts=new Date().toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'});
  labelRow.appendChild(el('span','msg-ts',ts));
  msg.appendChild(labelRow);
  const body=el('div','msg-body');
  appendRichText(body,text||'');
  msg.appendChild(body);
  if (opts.confirmTaskId) {
    const actions=el('div','msg-actions');
    const btn=el('button','confirm-btn','CONFIRMAR ACCIÓN');
    btn.addEventListener('click',async()=>{
      btn.disabled=true;
      document.dispatchEvent(new CustomEvent('jarvis:confirm-task',{detail:{taskId:opts.confirmTaskId}}));
    });
    actions.appendChild(btn);
    msg.appendChild(actions);
  }
  dom.feed.appendChild(msg);
  dom.feed.scrollTop=dom.feed.scrollHeight;
  if (kind==='jarvis'&&!opts.silentVoice) {
    // Primary responses pass speakText explicitly (even if undefined/empty) via submitChat.
    // Secondary messages (task events, announcements) don't include the key at all.
    // Don't let secondary messages interrupt an ongoing primary speech.
    const isPrimary = 'speakText' in opts;
    if (!isPrimary && state.speaking) return;
    speakText(opts.speakText||buildNarration(opts.voiceResult)||text);
  }
  return msg;
}

// Inyecta el detalle estructurado (Fase 2) que llegó por SSE, en una burbuja ya
// pintada. Se agrega como un bloque aparte bajo el speak — la voz ya terminó,
// así que esto es solo visual; no se habla.
export function appendDeferredContent(msg, markdown) {
  if (!msg || !String(markdown||'').trim()) return;
  const block=el('div','msg-body msg-deferred');
  block.style.cssText='margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,212,255,0.12)';
  appendRichText(block, markdown);
  msg.appendChild(block);
  if (dom.feed) dom.feed.scrollTop=dom.feed.scrollHeight;
}
