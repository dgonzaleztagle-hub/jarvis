import { dom, el } from './state.js';
import { api } from './api.js';
import { addMessage } from './feed.js';
import { confirmPendingTask } from './tasks.js';
import * as FloatingPanel from './floating-panel.js';
import { renderKnowledgeGraph } from './graph-panel.js';

/* ─── ARTIFACT STATE ────────────────────────────────────────────────────────── */
export const artifactState = { current: null };

/* ─── CONSTANTS ─────────────────────────────────────────────────────────────── */
const MEMORY_TYPE_LABELS = {
  preference:'PREFERENCIAS', contact:'CONTACTOS', business_context:'CONTEXTO DE NEGOCIO',
  task_pattern:'PATRONES DE TAREA', behavior_lesson:'LECCIONES DE COMPORTAMIENTO',
  assistant_self_knowledge:'CONOCIMIENTO PROPIO', knowledge:'CONOCIMIENTO',
  feedback:'RETROALIMENTACIÓN', user:'PERFIL DEL USUARIO', project:'PROYECTOS', reference:'REFERENCIAS'
};

const MEMORY_TYPE_ORDER = [
  'contact','preference','behavior_lesson','task_pattern',
  'business_context','assistant_self_knowledge','knowledge','feedback','user','project','reference'
];

/* ─── REGISTRY ──────────────────────────────────────────────────────────────── */
export const ARTIFACT_DEFS = {
  agenda:   { title:'AGENDA',   icon:'📅', dock:'dockAgenda',  load:loadAgendaData,   render:renderAgenda   },
  emails:   { title:'CORREOS',  icon:'✉',  dock:'dockEmails',  load:loadEmailsData,   render:renderEmails   },
  memory:   { title:'MEMORIA',  icon:'🧠', dock:'dockMemoria', load:loadMemoryData,   render:renderMemory   },
  approval: { title:'PERMISOS', icon:'🔐', dock:'dockPermisos',load:loadApprovalData, render:renderApproval },
  meeting:  { title:'REUNIÓN',  icon:'🎙', dock:null,          load:loadMeetingData,  render:renderMeeting  }
};

export async function openArtifact(type, { float = false } = {}) {
  const def = ARTIFACT_DEFS[type];
  if (!def) return;

  if (float) {
    // Open as floating panel over Vader
    const panelTitle = `${def.icon}  ${def.title}`;
    FloatingPanel.open(type, {
      title: panelTitle,
      content: `<div class="fp-loading">Cargando ${def.title.toLowerCase()}…</div>`,
      zone: 'right',
      width: '400px',
    });
    const data = await def.load().catch(err => ({ error: err.message, connected: false }));
    if (!FloatingPanel.isOpen(type)) return; // closed while loading
    const container = document.createElement('div');
    def.render(data, container);
    FloatingPanel.open(type, { title: panelTitle, contentNode: container, zone: 'right', width: '400px' });
    return;
  }

  // Original side-panel behavior (dock buttons)
  const isOpen = dom.workspacePanel.classList.contains('panel-open');
  if (isOpen && artifactState.current === type) { closeWorkspace(); return; }
  artifactState.current = type;
  dom.workspaceContent.innerHTML = `<div class="artifact-placeholder"><span class="art-icon">${def.icon}</span><span>Cargando ${def.title.toLowerCase()}...</span></div>`;
  openWorkspace(def.title);
  const data = await def.load().catch(err => ({ error: err.message, connected: false }));
  if (artifactState.current !== type) return;
  def.render(data);
}

/* ─── PANELS ────────────────────────────────────────────────────────────────── */
export function openWorkspace(title) {
  dom.workspacePanel.classList.add('panel-open');
  if (title) dom.workspaceTitle.textContent=title;
  for (const [type,def] of Object.entries(ARTIFACT_DEFS)) {
    const dockEl=dom[def.dock];
    if (dockEl) dockEl.classList.toggle('active',artifactState.current===type);
  }
}

export function closeWorkspace() {
  dom.workspacePanel.classList.remove('panel-open');
  artifactState.current=null;
  for (const def of Object.values(ARTIFACT_DEFS)) {
    const dockEl=dom[def.dock];
    if (dockEl) dockEl.classList.remove('active');
  }
}

export function openActivity() {
  dom.activityPanel.classList.add('panel-open');
  dom.dockActivity.classList.add('active');
}

export function closeActivity() {
  dom.activityPanel.classList.remove('panel-open');
  dom.dockActivity.classList.remove('active');
}

export function toggleActivity() {
  if (dom.activityPanel.classList.contains('panel-open')) closeActivity(); else openActivity();
}

/* ─── ARTIFACT MODAL ────────────────────────────────────────────────────────── */
export function openArtifactModal(title) {
  if (title) dom.artifactModalTitle.textContent=title;
  dom.artifactModal.classList.add('open');
}

export function closeArtifactModal() {
  dom.artifactModal.classList.remove('open');
  dom.artifactModal.classList.remove('graph-modal-open');
  setTimeout(()=>{ dom.artifactModalBody.innerHTML=''; },250);
}

export async function openGraphModal() {
  openArtifactModal('🕸 GRAFO DE CONOCIMIENTO');
  dom.artifactModal.classList.add('graph-modal-open');
  dom.artifactModalBody.innerHTML = '<div class="fp-loading">Cargando grafo…</div>';
  await renderKnowledgeGraph(dom.artifactModalBody);
}

/* ─── AGENDA RENDERER ───────────────────────────────────────────────────────── */
function formatAgendaRange(ev) {
  const s=new Date(ev.start?.dateTime||ev.start?.date||''), e=new Date(ev.end?.dateTime||ev.end?.date||'');
  if (isNaN(s)||isNaN(e)) return 'Hora no disponible';
  const fmt=(d)=>d.toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'});
  return `${fmt(s)} – ${fmt(e)}`;
}

function describeAgendaTiming(ev) {
  const s=new Date(ev.start?.dateTime||ev.start?.date||''), e=new Date(ev.end?.dateTime||ev.end?.date||''), now=Date.now();
  if (isNaN(s)||isNaN(e)) return {label:'',tone:''};
  if (now>=s&&now<=e) return {label:'En curso',tone:'live'};
  const diff=Math.round((s-now)/60000);
  if (diff>0&&diff<=30)  return {label:`En ${diff} min`,tone:'soon'};
  if (diff>30&&diff<=180) return {label:`En ${Math.round(diff/60)} h`,tone:''};
  return {label:'',tone:''};
}

function renderAgenda(data, target) {
  const events=data.events||[];
  const root = target || dom.workspaceContent;
  root.innerHTML='';
  const wrap=el('div','agenda-artifact');
  const hdr=el('div','artifact-header-row');
  const today=new Date().toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'});
  hdr.appendChild(el('span','artifact-count',today.toUpperCase()));
  const createBtn=el('button','cmd-btn compose-trigger','+ EVENTO');
  createBtn.addEventListener('click',()=>{
    dom.chatInput.focus();
    dom.chatInput.value='Crea un evento en mi calendario hoy: ';
    dom.chatInput.setSelectionRange(999,999);
  });
  hdr.appendChild(createBtn);
  wrap.appendChild(hdr);
  if (data.connected===false) {
    wrap.appendChild(el('div','agenda-empty','Google Calendar no disponible.'));
    root.appendChild(wrap); return;
  }
  if (!events.length) {
    wrap.appendChild(el('div','agenda-empty','Sin compromisos agendados hoy.'));
    root.appendChild(wrap); return;
  }
  for (const ev of events) {
    const timing=describeAgendaTiming(ev);
    let cls='agenda-card agenda-card-clickable';
    if (timing.tone==='live') cls+=' is-live';
    if (timing.tone==='soon') cls+=' is-soon';
    const card=el('div',cls);

    // Summary row
    const summaryRow=el('div','agenda-summary-row');
    summaryRow.appendChild(el('span','agenda-summary',ev.summary||'Sin título'));
    summaryRow.appendChild(el('span','agenda-chevron','›'));
    card.appendChild(summaryRow);
    card.appendChild(el('div','agenda-time',formatAgendaRange(ev)));
    if (timing.label) card.appendChild(el('div',timing.tone==='live'?'agenda-live':'agenda-note',timing.label));

    // Detail section (hidden until click)
    const detail=el('div','agenda-detail');
    detail.hidden=true;
    if (ev.description) detail.appendChild(el('div','agenda-detail-desc',ev.description));

    const attendees=(ev.attendees||[]).filter(a=>a.email);
    if (attendees.length) {
      const names=attendees.map(a=>a.name||a.email).join(', ');
      detail.appendChild(el('div','agenda-detail-attendees','Con: '+names));
    }

    // Meet link
    const meetUri=ev.conferenceData?.entryPoints?.find(ep=>ep.entryPointType==='video')?.uri
      || ev.hangoutLink;
    if (meetUri) {
      const a=document.createElement('a');
      a.href=meetUri; a.target='_blank'; a.rel='noreferrer noopener';
      a.className='agenda-detail-link agenda-detail-meet';
      a.textContent='Unirse con Google Meet';
      detail.appendChild(a);
    }

    if (ev.htmlLink) {
      const btn=document.createElement('button');
      btn.className='agenda-detail-link';
      btn.textContent='Ver en Google Calendar';
      btn.addEventListener('click',(e)=>{
        e.stopPropagation();
        window.open(ev.htmlLink,'gcal_popup','width=920,height=660,left=160,top=80,resizable=yes,scrollbars=yes');
      });
      detail.appendChild(btn);
    }

    card.appendChild(detail);

    card.addEventListener('click',()=>{
      const open=!detail.hidden;
      detail.hidden=open;
      card.classList.toggle('agenda-card-expanded',!open);
    });

    wrap.appendChild(card);
  }
  root.appendChild(wrap);
}

/* ─── EMAILS RENDERER ───────────────────────────────────────────────────────── */
function renderEmails(data, target) {
  const root = target || dom.workspaceContent;
  root.innerHTML='';
  const wrap=el('div','email-artifact');
  if (data.connected===false) {
    const hdr=el('div','artifact-header-row'); hdr.appendChild(el('span','artifact-count','CORREOS')); wrap.appendChild(hdr);
    const ph=el('div','artifact-placeholder'); ph.innerHTML='<span class="art-icon">✉</span><span>Google no conectado.<br>Ve a ⚙ → SISTEMA para conectar.</span>'; wrap.appendChild(ph);
    root.appendChild(wrap); return;
  }
  const emails=data.emails||[];
  const hdr=el('div','artifact-header-row');
  hdr.appendChild(el('span','artifact-count',`${emails.length} CORREO${emails.length!==1?'S':''}`));
  const composeBtn=el('button','cmd-btn compose-trigger','+ REDACTAR');
  composeBtn.addEventListener('click',()=>openComposeModal());
  hdr.appendChild(composeBtn);
  wrap.appendChild(hdr);
  if (!emails.length) { wrap.appendChild(el('div','agenda-empty','Sin correos recientes en el buzón.')); root.appendChild(wrap); return; }
  for (const email of emails) {
    const attn=email.attention||'baja', cat=(email.category||'otro').toLowerCase();
    const card=el('div',`email-card attn-${attn}`);
    const badges=el('div','email-badges');
    badges.appendChild(el('span',`email-badge cat-${cat}`,(email.category||'CORREO').toUpperCase()));
    badges.appendChild(el('span',`email-badge attn-badge-${attn}`,{alta:'● ALTA',media:'○ MEDIA',baja:'· BAJA'}[attn]||attn.toUpperCase()));
    card.appendChild(badges);
    const fromRaw=email.from||'Desconocido', fromName=fromRaw.replace(/<[^>]+>/,'').replace(/"/g,'').trim()||fromRaw;
    card.appendChild(el('div','email-from',fromName));
    card.appendChild(el('div','email-subject',email.subject||'(Sin asunto)'));
    const preview=(email.preview||email.summary||'').trim();
    if (preview) card.appendChild(el('div','email-snippet',preview));
    if (attn==='alta'&&email.suggestedAction) card.appendChild(el('div','email-action-hint',`→ ${email.suggestedAction}`));
    const footer=el('div','email-footer');
    if (email.date) {
      const d=new Date(email.date);
      if (!isNaN(d)) {
        const sameDay=d.toDateString()===new Date().toDateString();
        const fmt=sameDay?d.toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('es-CL',{day:'numeric',month:'short'});
        footer.appendChild(el('span','email-time',fmt));
      }
    }
    card.appendChild(footer);
    wrap.appendChild(card);
  }
  // Update email badge in dock
  const high=emails.filter(e=>e.attention==='alta').length;
  const badge=document.getElementById('emailsBadge');
  if (badge) { if(high>0){badge.textContent=high;badge.classList.remove('hidden');}else badge.classList.add('hidden'); }
  root.appendChild(wrap);
}

/* ─── MEMORY RENDERER ───────────────────────────────────────────────────────── */
function renderMemoryContent(content) {
  if (!content) return null;
  const wrap=el('div','memory-content');
  if (typeof content==='string') { const v=el('div','memory-val'); v.textContent=content.slice(0,300)+(content.length>300?'…':''); wrap.appendChild(v); return wrap; }
  if (typeof content==='object') {
    for (const [k,v] of Object.entries(content)) {
      if (!v) continue;
      const row=el('div','memory-kv');
      row.appendChild(el('span','memory-key',k.replace(/_/g,' ')));
      const valEl=el('span','memory-val'); valEl.textContent=String(v).slice(0,180)+(String(v).length>180?'…':'');
      row.appendChild(valEl); wrap.appendChild(row);
    }
    return wrap.children.length?wrap:null;
  }
  return null;
}

function renderMemory(data) {
  dom.workspaceContent.innerHTML='';
  if (data.error) { const ph=el('div','artifact-placeholder'); ph.innerHTML='<span class="art-icon">🧠</span><span>Error al cargar memoria.</span>'; dom.workspaceContent.appendChild(ph); return; }
  const filtered=(data.records||[]).filter(r=>r.state!=='archived'&&r.confidence>0&&r.title!=='Untitled memory'&&r.title!=='Untitled');
  const seen=new Map();
  for (const r of filtered) {
    const k=`${r.type}::${(r.title||'').toLowerCase().trim().slice(0,40)}`, ex=seen.get(k);
    if (!ex) { seen.set(k,r); continue; }
    const rs=(r.confidence||0)+(r.state==='verified'?1:0), exs=(ex.confidence||0)+(ex.state==='verified'?1:0);
    if (rs>exs) seen.set(k,r);
  }
  const records=Array.from(seen.values());
  const wrap=el('div','memory-artifact');
  const hdr=el('div','artifact-header-row');
  hdr.appendChild(el('span','artifact-count',records.length?`${records.length} REGISTRO${records.length!==1?'S':''}` :'VACÍO'));
  const graphBtn=el('button','artifact-action-btn','🕸 Grafo');
  graphBtn.addEventListener('click', () => { openGraphModal().catch(() => {}); });
  hdr.appendChild(graphBtn);
  wrap.appendChild(hdr);
  if (!records.length) {
    const ph=el('div','artifact-placeholder'); ph.innerHTML='<span class="art-icon">🧠</span><span>Sin memorias registradas todavía.</span>'; wrap.appendChild(ph); dom.workspaceContent.appendChild(wrap); return;
  }
  const groups={};
  for (const r of records) { const t=r.type||'other'; if(!groups[t]) groups[t]=[]; groups[t].push(r); }
  const ordered=[...MEMORY_TYPE_ORDER.filter(t=>groups[t]),...Object.keys(groups).filter(t=>!MEMORY_TYPE_ORDER.includes(t)&&groups[t]?.length)];
  for (const type of ordered) {
    const recs=groups[type]; if(!recs?.length) continue;
    const group=el('div','memory-group');
    group.appendChild(el('div','memory-group-title',MEMORY_TYPE_LABELS[type]||type.toUpperCase()));
    for (const rec of recs) {
      const card=el('div',`memory-card state-${rec.state||'active'}`);
      const titleRow=el('div','memory-kv');
      titleRow.style.cssText='display:flex;justify-content:space-between;align-items:flex-start;gap:6px;grid-template-columns:none';
      titleRow.appendChild(el('div','memory-title',rec.title||'(sin título)'));
      titleRow.appendChild(el('span',`memory-state-badge ${rec.state||''}`,rec.state==='verified'?'VERIFICADO':'EN REVISIÓN'));
      card.appendChild(titleRow);
      const contentEl=renderMemoryContent(rec.content);
      if (contentEl) card.appendChild(contentEl);
      const tags=rec.tags||[];
      if (tags.length) { const tagRow=el('div','memory-tags'); for(const t of tags.slice(0,5)) tagRow.appendChild(el('span','memory-tag',t)); card.appendChild(tagRow); }
      group.appendChild(card);
    }
    wrap.appendChild(group);
  }
  dom.workspaceContent.appendChild(wrap);
}

/* ─── APPROVAL RENDERER ─────────────────────────────────────────────────────── */
function renderApproval(data) {
  dom.workspaceContent.innerHTML='';
  // Exclude conversation tasks AND tool tasks born inside a conversation
  // (origin 'conversation') — those already have inline CONFIRMAR ACCIÓN in
  // chat. Only background actions need approval here.
  const pending=(data.tasks||[]).filter(t=>t.status==='waiting_confirmation' && t.type!=='conversation' && t.origin!=='conversation');
  const wrap=el('div','approval-artifact');
  const hdr=el('div','artifact-header-row');
  hdr.appendChild(el('span','artifact-count',pending.length?`${pending.length} PENDIENTE${pending.length>1?'S':''}` :'AL DÍA'));
  wrap.appendChild(hdr);
  if (!pending.length) {
    const ph=el('div','artifact-placeholder'); ph.innerHTML='<span class="art-icon">✓</span><span>Sin aprobaciones pendientes.</span>'; wrap.appendChild(ph); dom.workspaceContent.appendChild(wrap); return;
  }
  for (const task of pending) {
    const card=el('div','approval-card');
    card.appendChild(el('div','approval-title',task.title||'Acción pendiente de aprobación'));
    if (task.toolName) card.appendChild(el('div','approval-tool',task.toolName));
    const actions=el('div','approval-actions');
    const btn=el('button','approval-confirm-btn','APROBAR Y EJECUTAR');
    btn.addEventListener('click',async()=>{
      btn.disabled=true; btn.textContent='Confirmando...';
      await confirmPendingTask(task.id);
      const refreshed=await loadApprovalData();
      if (artifactState.current==='approval') renderApproval(refreshed);
    });
    actions.appendChild(btn); card.appendChild(actions); wrap.appendChild(card);
  }
  dom.workspaceContent.appendChild(wrap);
}

/* ─── COMPOSE MODAL ─────────────────────────────────────────────────────────── */
export function openComposeModal(prefill={}) {
  dom.artifactModalTitle.textContent='REDACTAR CORREO';
  dom.artifactModalBody.innerHTML=`
    <div class="compose-form">
      <div class="compose-field"><label>Para</label>
        <input id="composeTo" type="email" class="cmd-input" placeholder="destinatario@email.com" value="${prefill.to||''}">
      </div>
      <div class="compose-field"><label>Asunto</label>
        <input id="composeSubject" type="text" class="cmd-input" placeholder="Asunto del correo" value="${prefill.subject||''}">
      </div>
      <div class="compose-field"><label>Mensaje</label>
        <textarea id="composeBody" class="compose-textarea" placeholder="Escribe tu mensaje aquí...">${prefill.body||''}</textarea>
      </div>
      <div class="compose-actions">
        <button class="cmd-btn" id="composeCancelBtn">CANCELAR</button>
        <button class="cmd-send" id="composeSendBtn">ENVIAR CORREO</button>
      </div>
      <div class="config-status" id="composeStatus"></div>
    </div>`;
  dom.artifactModal.classList.add('open');
  document.getElementById('composeCancelBtn').addEventListener('click',()=>closeArtifactModal());
  document.getElementById('composeSendBtn').addEventListener('click',()=>sendComposedEmail());
  document.getElementById('composeBody').addEventListener('keydown',(e)=>{ if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();sendComposedEmail();} });
}

async function sendComposedEmail() {
  const to=document.getElementById('composeTo')?.value?.trim();
  const subject=document.getElementById('composeSubject')?.value?.trim();
  const body=document.getElementById('composeBody')?.value?.trim();
  const status=document.getElementById('composeStatus');
  const sendBtn=document.getElementById('composeSendBtn');
  if (!to||!subject||!body) { if(status) status.textContent='Completa todos los campos antes de enviar.'; return; }
  if (sendBtn) { sendBtn.disabled=true; sendBtn.textContent='Enviando...'; }
  if (status) { status.textContent=''; status.className='config-status'; }
  try {
    const result=await api('/tasks/tool',{method:'POST',body:JSON.stringify({title:`Enviar correo a ${to}: ${subject}`,toolName:'google.gmail.send_email',input:{to,subject,body}})});
    const task=result.task||{};
    if (task.status==='completed') {
      if(status){status.textContent='✓ Correo enviado correctamente.';status.className='config-status ok';}
      addMessage('jarvis','Jarvis',`Correo enviado a ${to}.`,{silentVoice:false});
      setTimeout(()=>closeArtifactModal(),1800);
    } else if (task.status==='waiting_confirmation') {
      if(status) status.textContent='Pendiente de aprobación. Ve a PERMISOS para confirmar.';
      setTimeout(()=>{closeArtifactModal();openArtifact('approval');},2000);
    } else {
      if(status) status.textContent=`Error: ${task.error?.message||task.status||'Error desconocido'}`;
      if(sendBtn){sendBtn.disabled=false;sendBtn.textContent='ENVIAR CORREO';}
    }
  } catch(err) {
    if(status) status.textContent=`Error: ${err.message}`;
    if(sendBtn){sendBtn.disabled=false;sendBtn.textContent='ENVIAR CORREO';}
  }
}

/* ─── THREAD DETAIL PANEL ────────────────────────────────────────────────────── */
export function buildThreadPanel(data = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'thread-panel';

  // Subject header
  if (data.subject) {
    wrap.appendChild(el('div', 'thread-subject', data.subject));
  }

  // Participants line
  const participants = (data.participants || [])
    .map(p => p.replace(/<[^>]+>/, '').replace(/"/g, '').trim())
    .filter(Boolean)
    .slice(0, 4);
  if (participants.length) {
    wrap.appendChild(el('div', 'thread-participants', 'Con: ' + participants.join(', ')));
  }

  // Messages
  const messages = data.messages || [];
  for (const msg of messages) {
    const card = el('div', 'thread-msg');

    const header = el('div', 'thread-msg-header');
    const fromRaw = msg.from || '(desconocido)';
    const fromName = fromRaw.replace(/<[^>]+>/, '').replace(/"/g, '').trim() || fromRaw;
    header.appendChild(el('span', 'thread-msg-from', fromName));
    if (msg.date) {
      const d = new Date(msg.date);
      if (!isNaN(d)) {
        const fmt = d.toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        header.appendChild(el('span', 'thread-msg-date', fmt));
      }
    }
    card.appendChild(header);

    if (msg.snippet || msg.body) {
      const bodyText = (msg.snippet || msg.body || '').slice(0, 400);
      card.appendChild(el('div', 'thread-msg-body', bodyText + (bodyText.length >= 400 ? '…' : '')));
    }

    wrap.appendChild(card);
  }

  return wrap;
}

/* ─── EMAILS PANEL (from tool result) ───────────────────────────────────────── */
export function buildEmailsPanel(data) {
  const container = document.createElement('div');
  renderEmails(data, container);
  return container;
}

/* ─── AGENDA PANEL (from tool result) ───────────────────────────────────────── */
export function buildAgendaPanel(data) {
  const container = document.createElement('div');
  renderAgenda(data, container);
  return container;
}

/* ─── EVENT CONFIRMATION PANEL ──────────────────────────────────────────────── */
export function buildEventPanel(event = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'ec-panel';

  const title = el('div', 'ec-title', event.summary || 'Evento');
  wrap.appendChild(title);

  const startRaw = event.start?.dateTime || event.start?.date;
  const endRaw   = event.end?.dateTime   || event.end?.date;
  if (startRaw) {
    const s = new Date(startRaw), e = new Date(endRaw || startRaw);
    const dayFmt  = s.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
    const timePart = !isNaN(s) && event.start?.dateTime
      ? `${s.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })} – ${e.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`
      : '';
    wrap.appendChild(el('div', 'ec-time', dayFmt + (timePart ? ' · ' + timePart : '')));
  }

  const attendees = event.attendees || [];
  if (attendees.length) {
    const names = attendees.map(a => a.displayName || a.email).join(', ');
    wrap.appendChild(el('div', 'ec-attendees', 'Con: ' + names));
  }

  const meetUri = event.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri;
  if (meetUri) {
    const a = document.createElement('a');
    a.href = meetUri; a.target = '_blank'; a.rel = 'noreferrer noopener';
    a.className = 'ec-btn ec-btn-meet'; a.textContent = 'Unirse con Google Meet';
    wrap.appendChild(a);
  }

  if (event.htmlLink) {
    const btn = document.createElement('button');
    btn.className = 'ec-btn';
    btn.textContent = 'Ver en Google Calendar';
    btn.addEventListener('click', () =>
      window.open(event.htmlLink, 'gcal_popup', 'width=920,height=660,left=160,top=80,resizable=yes,scrollbars=yes')
    );
    wrap.appendChild(btn);
  }

  return wrap;
}

/* ─── LOADERS ───────────────────────────────────────────────────────────────── */
export async function loadAgendaData() {
  const data=await api('/calendar/today');
  return data;
}

export async function loadEmailsData() {
  return api('/emails/digest?max=15').catch(err=>({connected:false,error:err.message,emails:[]}));
}

export async function loadMemoryData() {
  return api('/memory?include=content').catch(err=>({error:err.message,records:[]}));
}

export async function loadApprovalData() {
  return api('/tasks').catch(err=>({error:err.message,tasks:[]}));
}

/* ─── MEETING ARTIFACT ──────────────────────────────────────────────────────── */

// Estado del panel de reunión — actualizado en tiempo real por SSE.
export const meetingPanelState = {
  active: false,
  title: '',
  chunks: [],         // [{ index, text, timestamp }]
  minutes: null,      // minuta final una vez terminada la reunión
  docUrl: null,
  container: null     // referencia DOM al panel activo
};

export async function loadMeetingData() {
  return { ...meetingPanelState };
}

export function renderMeeting(data, container) {
  meetingPanelState.container = container;
  container.innerHTML = '';
  container.style.cssText = 'padding:12px;font-family:monospace;font-size:13px;';

  if (data.minutes) {
    renderMeetingMinutes(data.minutes, data.docUrl, container);
    return;
  }

  // Panel en vivo
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;';
  const dot = document.createElement('span');
  dot.id = 'mtg-rec-dot';
  dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#e84040;display:inline-block;animation:pulse 1s infinite;';
  const title = document.createElement('span');
  title.style.cssText = 'color:var(--c-hi,#7ca4f4);font-weight:700;font-size:14px;';
  title.textContent = data.title || 'Reunión en curso';
  header.append(dot, title);
  container.appendChild(header);

  // Pulse animation
  const style = document.createElement('style');
  style.textContent = '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}';
  container.appendChild(style);

  const transcriptEl = document.createElement('div');
  transcriptEl.id = 'mtg-transcript';
  transcriptEl.style.cssText = 'max-height:480px;overflow-y:auto;color:var(--c-fg,#c8d0e0);line-height:1.6;white-space:pre-wrap;';

  const emptyMsg = document.createElement('span');
  emptyMsg.id = 'mtg-empty';
  emptyMsg.style.cssText = 'color:var(--c-dim,#4a5568);font-style:italic;';
  emptyMsg.textContent = 'Escuchando…';
  transcriptEl.appendChild(emptyMsg);

  // Render existing chunks
  (data.chunks || []).forEach((c) => appendChunkToPanel(c, transcriptEl));

  container.appendChild(transcriptEl);
}

export function appendChunkToPanel(chunk, transcriptEl) {
  const el = transcriptEl || document.getElementById('mtg-transcript');
  if (!el) return;
  const empty = el.querySelector('#mtg-empty');
  if (empty) empty.remove();

  const p = document.createElement('p');
  p.style.cssText = 'margin:0 0 6px;padding:4px 6px;border-left:2px solid var(--c-border,#2a3348);';

  // Highlight markers
  const text = chunk.text
    .replace(/\[DECISIÓN: ([^\]]+)\]/g, '<mark style="background:#1e3a1e;color:#6fcf6f;padding:0 3px;">⚡ $1</mark>')
    .replace(/\[COMPROMISO de ([^\]]+): ([^\]]+)\]/g, '<mark style="background:#1e1e3a;color:#9ab4f8;padding:0 3px;">🤝 $1: $2</mark>')
    .replace(/\[CIFRA: ([^\]]+)\]/g, '<mark style="background:#2a1e1e;color:#f4a0a0;padding:0 3px;">📊 $1</mark>');
  p.innerHTML = text;
  el.appendChild(p);
  el.scrollTop = el.scrollHeight;
}

function renderMeetingMinutes(minutes, docUrl, container) {
  const h = (tag, text, style = '') => {
    const e = document.createElement(tag);
    if (style) e.style.cssText = style;
    e.textContent = text;
    return e;
  };
  container.appendChild(h('div', 'Minuta generada', 'color:var(--c-hi,#7ca4f4);font-weight:700;font-size:14px;margin-bottom:10px;'));
  if (minutes.summary) {
    container.appendChild(h('p', minutes.summary, 'color:var(--c-fg,#c8d0e0);margin-bottom:10px;'));
  }
  const sections = [
    { label: 'Decisiones', items: minutes.decisions },
    { label: 'Temas', items: minutes.topics },
    { label: 'Tareas', items: (minutes.actionItems || []).map((a) => `${a.task}${a.owner ? ` → ${a.owner}` : ''}`) }
  ];
  for (const { label, items } of sections) {
    if (!items?.length) continue;
    container.appendChild(h('div', label, 'color:var(--c-dim,#8896b0);font-size:11px;letter-spacing:1px;margin:8px 0 4px;'));
    items.forEach((item) => {
      const li = document.createElement('div');
      li.style.cssText = 'padding:3px 0 3px 10px;border-left:2px solid var(--c-border,#2a3348);color:var(--c-fg,#c8d0e0);margin-bottom:4px;';
      li.textContent = item;
      container.appendChild(li);
    });
  }
  if (docUrl) {
    const a = document.createElement('a');
    a.href = docUrl; a.target = '_blank'; a.rel = 'noreferrer noopener';
    a.style.cssText = 'display:block;margin-top:14px;color:var(--c-hi,#7ca4f4);font-size:12px;';
    a.textContent = 'Ver minuta completa en Google Docs →';
    container.appendChild(a);
  }
}
