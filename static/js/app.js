// State
let socket = null;
let currentMode = 'default';
let totals = { total: 0, completed: 0 };
let results = [];
let plannedTotal = 0; // total akun yang akan dites (dari add-links-and-test)
let floatSort = { field: 'finished', dir: 'asc' }; // sort field: 'tag'|'phase'|'jitter'|'finished'
let floatFilter = { live: false, dead: false, p2: false };

// Utils
function $(q) { return document.querySelector(q); }
function $all(q) { return Array.from(document.querySelectorAll(q)); }
function fmtLatency(v) { if (v == null || v === -1) return '–'; return `${v} ms`; }
function getTotalValue(data) {
  const v = (data && (data.total ?? data.total_accounts ?? (Array.isArray(data.results) ? data.results.length : 0))) || 0;
  return Number.isFinite(v) ? v : 0;
}

// Ripple via delegation
function bindRipple() {
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    btn.style.setProperty('--x', `${e.clientX - rect.left}px`);
    btn.style.setProperty('--y', `${e.clientY - rect.top}px`);
  }, { passive: true });
}

// Toast
function toast(message, type='info') {
  const c = $('#toast-container'); if (!c) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  c.appendChild(el);
  setTimeout(() => { el.remove(); }, 3000);
}

// Info popover with toggle
function bindInfoTips() {
  let currentTip = null;
  function hideTip() { if (currentTip) { currentTip.remove(); currentTip = null; } }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.info-btn');
    if (!btn) { hideTip(); return; }
    // Toggle
    if (currentTip && currentTip.__owner === btn) { hideTip(); return; }
    hideTip();
    const tip = document.createElement('div');
    tip.className = 'toast';
    tip.style.position = 'absolute';
    tip.style.whiteSpace = 'nowrap';
    tip.textContent = btn.getAttribute('data-info') || '';
    const r = btn.getBoundingClientRect();
    tip.style.left = `${Math.max(12, r.left - 8)}px`;
    tip.style.top = `${r.bottom + 6 + window.scrollY}px`;
    tip.style.zIndex = 50;
    tip.__owner = btn;
    document.body.appendChild(tip);
    currentTip = tip;
  });
  window.addEventListener('scroll', () => { if (currentTip) { currentTip.remove(); currentTip = null; } });
}

// Status UI
function setStatus(text, type='info') {
  const dot = $('#status-dot'); const t = $('#status-text');
  t.textContent = text;
  dot.classList.remove('success','error','warning');
  if (type==='success') dot.classList.add('success');
  if (type==='error') dot.classList.add('error');
  if (type==='warning') dot.classList.add('warning');
}

function setModePill(mode) { $('#mode-pill').textContent = mode ? mode : 'Idle'; }
function setProgress(completed, total) {
  totals = { completed, total };
  const pct = total > 0 ? Math.round((completed/total)*100) : 0;
  $('#completed-count').textContent = completed;
  $('#total-count').textContent = total;
  $('#progress-bar').style.width = `${pct}%`;
}

// Completion-ordered view: show only completed items in order of completion
const displayOrder = [];           // array of index in completion order
const latestByIndex = new Map();   // index -> latest result snapshot
const shownSet = new Set();        // indexes already rendered
const skeletonSet = new Set(); // deprecated (kept for compatibility, not used)
let skeletonEl = null;             // single global skeleton row element
const finishTimeByIndex = new Map(); // index -> timestamp ms selesai

function fmtTime(ms){ try { const d=new Date(ms); return d.toLocaleTimeString(); } catch { return '-'; } }

function isFinalStatus(s) { return s && !['WAIT','🔄','🔁'].includes(s); }
function isFailureStatus(s) { return s === '❌' || s === 'Dead'; }
function shouldShowResult(r) {
  // Only show completed items
  if (!isFinalStatus(r.Status)) return false;
  // For two-phase modes, show second phase result for successes; failures can show as is
  const twoPhase = (currentMode === 'hybrid' || currentMode === 'accurate');
  if (twoPhase) {
    if (r.Status === '✅') return !!r.XRAY; // show only XRAY successes
    return true; // failures (❌/Dead) show
  }
  return true; // fast/xray-only
}

function resetTableState() {
  displayOrder.length = 0;
  latestByIndex.clear();
  shownSet.clear();
  rowMap.clear();
  const tbody = $('#results-body'); if (tbody) tbody.innerHTML = '';
  if (skeletonEl) { skeletonEl.remove(); skeletonEl = null; }
}

function processResults(list) {
  if (!Array.isArray(list)) return;
  for (const r of list) {
    if (!r || typeof r !== 'object' || !Number.isFinite(r.index)) continue;
    latestByIndex.set(r.index, r);
    const twoPhase = (currentMode === 'hybrid' || currentMode === 'accurate');

    if (twoPhase) {
      if (r.Status === '✅' && r.XRAY) {
        if (!shownSet.has(r.index)) { shownSet.add(r.index); displayOrder.push(r.index); if(!finishTimeByIndex.has(r.index)) finishTimeByIndex.set(r.index, Date.now()); }
        upsertRow(r);
        continue;
      }
      if (isFailureStatus(r.Status)) {
        if (!shownSet.has(r.index)) { shownSet.add(r.index); displayOrder.push(r.index); if(!finishTimeByIndex.has(r.index)) finishTimeByIndex.set(r.index, Date.now()); }
        upsertRow(r);
        continue;
      }
      // phase1 success or non-final: do not render final row here
      continue;
    } else {
      if (isFinalStatus(r.Status)) {
        if (!shownSet.has(r.index)) { shownSet.add(r.index); displayOrder.push(r.index); if(!finishTimeByIndex.has(r.index)) finishTimeByIndex.set(r.index, Date.now()); }
        upsertRow(r);
        continue;
      } else {
        // non-final in single phase -> handled by global skeleton
        continue;
      }
    }
  }
}

function upsertRow(r) {
  const tbody = $('#results-body'); if (!tbody) return;
  const status = normalizeStatus(r.Status);
  let tr = rowMap.get(r.index);
  if (!tr) {
    tr = document.createElement('tr');
    tr.id = `row-${r.index}`;
    rowMap.set(r.index, tr);
  }
  tr.innerHTML = `
    <td>${escapeHtml(r.OriginalTag || r.tag || '')}</td>
    <td>${escapeHtml(r.VpnType || r.type || '')}</td>
    <td>${escapeHtml(r['Tested IP'] || r.server || '-')}</td>
    <td>${fmtLatency(r.Latency)}</td>
    <td>${escapeHtml(r.Country || '❓')}</td>
    <td class="${statusClass(status)}">${status}</td>
  `;
}

function ensureGlobalSkeleton(pending) {
  const tbody = $('#results-body'); if (!tbody) return;
  if (pending) {
    if (!skeletonEl) {
      skeletonEl = document.createElement('tr');
      skeletonEl.id = 'skel-global';
      skeletonEl.className = 'skel-row';
      skeletonEl.innerHTML = `
        <td><span class="skeleton-line lg"></span></td>
        <td><span class="skeleton-line sm"></span></td>
        <td><span class="skeleton-line md"></span></td>
        <td><span class="skeleton-line sm"></span></td>
        <td><span class="skeleton-line sm"></span></td>
        <td><span class="skeleton-line md"></span></td>
      `;
    }
    // Position skeleton after last completed row
    const frag = document.createDocumentFragment();
    for (const idx of displayOrder) {
      const tr = rowMap.get(idx);
      if (tr) frag.appendChild(tr);
    }
    frag.appendChild(skeletonEl);
    tbody.innerHTML = '';
    tbody.appendChild(frag);
  } else {
    if (skeletonEl) { skeletonEl.remove(); skeletonEl = null; }
    // Re-render finals only
    const frag = document.createDocumentFragment();
    for (const idx of displayOrder) {
      const tr = rowMap.get(idx);
      if (tr) frag.appendChild(tr);
    }
    tbody.innerHTML = '';
    tbody.appendChild(frag);
  }
}

function cleanTag(tag) {
  let s = (tag || '').toString();
  // Hapus emoji bendera (regional indicator pairs)
  try { s = s.replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, ''); } catch {}
  // Hapus kode negara di dalam kurung, contoh: (FR), (SG)
  s = s.replace(/\(\s*[A-Z]{2,3}\s*\)/g, '');
  // Hapus suffix penomoran seperti -1, - 2 di akhir
  s = s.replace(/\s*-\s*\d+\s*$/g, '');
  // Bersihkan separator di tepi (tanpa menghapus huruf di dalam kata)
  s = s.replace(/^[\s\-–/+,.;:_]+/, '').replace(/[\s\-–/+,.;:_]+$/, '');
  // Normalisasi spasi
  s = s.replace(/\s{2,}/g, ' ');
  return s.trim();
}
function truncate(str, max){ const s=(str||'').toString(); return s.length>max ? s.slice(0,max-1)+'…' : s; }

function renderMainRow(r){
  const status = normalizeStatus(r.Status);
  const tag = cleanTag(r.OriginalTag || r.tag || '');
  const isp = (r.Provider || '-').toString().replace(/\(.*?\)/g,'').replace(/,+/g, ',').trim();
  const ip = r['Tested IP'] || r.server || '-';
  const country = r.Country || '❓';
  return `
    <td title="${escapeHtml(tag)}">${escapeHtml(truncate(tag,24))}</td>
    <td>${escapeHtml((r.VpnType||r.type||'').toLowerCase())}</td>
    <td title="${escapeHtml(isp)}">${escapeHtml(truncate(isp,22))}</td>
    <td>${escapeHtml(country)}</td>
    <td title="${escapeHtml(ip)}"><code>${escapeHtml(truncate(ip,18))}</code></td>
    <td>${fmtLatency(r.Latency)}</td>
    <td class="${statusClass(status)}" title="${escapeHtml(r.Reason||'')}">${status==='✅'?'Live':'Dead'}</td>`;
}

function renderFloatRow(r){
  const status = normalizeStatus(r.Status);
  const tag = cleanTag(r.OriginalTag || r.tag || '');
  const transport = (r.TestType||'').split(' ').slice(-1)[0] || '-';
  const phase = r.XRAY ? 'P2' : (isFinalStatus(r.Status)?'P1':'–');
  const finished = fmtTime(finishTimeByIndex.get(r.index));
  const jitter = Number.isFinite(+r.Jitter) && +r.Jitter>=0 ? `${r.Jitter} ms` : '–';
  const titleStatus = r.Reason ? `Reason: ${r.Reason}` : '';
  const titleICMP = r.ICMP ? `ICMP: ${r.ICMP}` : '';
  return `
    <td title="${escapeHtml(tag)}">${escapeHtml(truncate(tag,24))}</td>
    <td>${escapeHtml(transport)}</td>
    <td title="${escapeHtml(titleStatus)}">${phase}</td>
    <td title="${escapeHtml(titleICMP)}">${jitter}</td>
    <td>${escapeHtml(finished)}</td>
    <td>
      <button class="btn btn-soft text-xs px-2 py-1" data-copy="tag" data-idx="${r.index}">Tag</button>
      <button class="btn btn-soft text-xs px-2 py-1" data-copy="ip" data-idx="${r.index}">IP</button>
      <button class="btn btn-soft text-xs px-2 py-1" data-copy="json" data-idx="${r.index}">JSON</button>
    </td>`;
}

function bindCopyHandlers(){
  const tbody = $('#float-body'); if (!tbody) return;
  tbody.addEventListener('click', async (e)=>{
    const btn = e.target.closest('button[data-copy]'); if (!btn) return;
    const type = btn.getAttribute('data-copy');
    const idx = parseInt(btn.getAttribute('data-idx'),10);
    const r = latestByIndex.get(idx); if (!r) return;
    try {
      if (type==='tag') { await navigator.clipboard.writeText(cleanTag(r.OriginalTag || r.tag || '')); toast('Tag copied','success'); }
      else if (type==='ip') { await navigator.clipboard.writeText(r['Tested IP'] || r.server || ''); toast('IP copied','success'); }
      else if (type==='json') { await navigator.clipboard.writeText(JSON.stringify(r, null, 2)); toast('JSON copied','success'); }
    } catch { toast('Copy failed','error'); }
  });
}

function rerenderTableInCompletionOrder(totalHint) {
  const tbody = $('#results-body'); if (!tbody) return;
  const frag = document.createDocumentFragment();
  for (const idx of displayOrder) {
    const r = latestByIndex.get(idx); if (!r) continue;
    let tr = rowMap.get(idx);
    if (!tr) { tr = document.createElement('tr'); tr.id = `row-${idx}`; rowMap.set(idx, tr); }
    tr.innerHTML = renderMainRow(r);
    frag.appendChild(tr);
  }
  // Append or remove skeleton
  const pending = Number.isFinite(totalHint) ? (displayOrder.length < totalHint) : false;
  if (pending) {
    if (!skeletonEl) {
      skeletonEl = document.createElement('tr');
      skeletonEl.id = 'skel-global';
      skeletonEl.className = 'skel-row';
      skeletonEl.innerHTML = `
        <td><span class="skeleton-line lg"></span></td>
        <td><span class="skeleton-line sm"></span></td>
        <td><span class="skeleton-line md"></span></td>
        <td><span class="skeleton-line sm"></span></td>
        <td><span class="skeleton-line sm"></span></td>
        <td><span class="skeleton-line md"></span></td>`;
    }
    frag.appendChild(skeletonEl);
  } else if (skeletonEl) { skeletonEl.remove(); skeletonEl = null; }

  tbody.innerHTML = '';
  tbody.appendChild(frag);

  // Rerender floating panel if visible
  const panel = $('#floating-panel');
  if (panel && !panel.classList.contains('hidden')) rerenderFloatingTable();
}

function rerenderFloatingTable() {
  const tbody = $('#float-body'); if (!tbody) return;
  const frag = document.createDocumentFragment();
  let list = displayOrder.map(idx => latestByIndex.get(idx)).filter(Boolean);
  // Filter
  if (floatFilter.live || floatFilter.dead || floatFilter.p2) {
    list = list.filter(r => {
      const s = normalizeStatus(r.Status);
      const isLive = (s==='✅');
      const isDead = (s==='❌' || s==='Dead');
      const isP2 = !!r.XRAY;
      if (floatFilter.live && !isLive) return false;
      if (floatFilter.dead && !isDead) return false;
      if (floatFilter.p2 && !isP2) return false;
      return true;
    });
  }
  // Sort
  const getVal = (r) => {
    switch(floatSort.field){
      case 'tag': return cleanTag(r.OriginalTag||r.tag||'').toLowerCase();
      case 'phase': return r.XRAY ? 2 : 1; // P2 > P1
      case 'jitter': return Number.isFinite(+r.Jitter)&&+r.Jitter>=0 ? +r.Jitter : 1e9;
      case 'finished': return finishTimeByIndex.get(r.index) || 0;
      default: return finishTimeByIndex.get(r.index) || 0;
    }
  };
  list.sort((a,b)=>{
    const va=getVal(a), vb=getVal(b);
    const cmp = (va<vb)?-1:(va>vb)?1:0;
    return floatSort.dir==='asc'?cmp:-cmp;
  });

  // Append rows in order (update kebawah)
  for (const r of list) {
    const tr = document.createElement('tr');
    tr.innerHTML = renderFloatRow(r);
    frag.appendChild(tr);
  }
  // Floating skeleton if pending
  const pending = displayOrder.length < plannedTotal;
  if (pending) {
    const sk = document.createElement('tr');
    sk.className = 'skel-row';
    sk.innerHTML = `
      <td><span class="skeleton-line lg"></span></td>
      <td><span class="skeleton-line sm"></span></td>
      <td><span class="skeleton-line md"></span></td>
      <td><span class="skeleton-line sm"></span></td>
      <td><span class="skeleton-line sm"></span></td>
      <td><span class="skeleton-line md"></span></td>`;
    frag.appendChild(sk);
  }
  tbody.innerHTML = '';
  tbody.appendChild(frag);
}

function toggleFloatingPanel(show){
  const panel = $('#floating-panel'); if (!panel) return;
  if (typeof show === 'boolean') panel.classList.toggle('hidden', !show);
  else panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) rerenderFloatingTable();
}

// Bind toggle buttons
function bindFloatingControls(){
  const btn = $('#btn-toggle-float'); if (btn) btn.addEventListener('click', ()=> toggleFloatingPanel());
  const close = $('#btn-close-float'); if (close) close.addEventListener('click', ()=> toggleFloatingPanel(false));
  initFloatingDrag();
  bindCopyHandlers();
  // Filters
  const fAll=$('#flt-all'), fLive=$('#flt-live'), fDead=$('#flt-dead'), fP2=$('#flt-p2');
  if (fAll) fAll.addEventListener('click', ()=>{ floatFilter={live:false,dead:false,p2:false}; [fAll,fLive,fDead,fP2].forEach(b=>b&&b.classList.remove('btn-primary')); rerenderFloatingTable(); });
  if (fLive) fLive.addEventListener('click', ()=>{ floatFilter.live=!floatFilter.live; fLive.classList.toggle('btn-primary', floatFilter.live); rerenderFloatingTable(); });
  if (fDead) fDead.addEventListener('click', ()=>{ floatFilter.dead=!floatFilter.dead; fDead.classList.toggle('btn-primary', floatFilter.dead); rerenderFloatingTable(); });
  if (fP2) fP2.addEventListener('click', ()=>{ floatFilter.p2=!floatFilter.p2; fP2.classList.toggle('btn-primary', floatFilter.p2); rerenderFloatingTable(); });
  // Sort header
  const hTag=$('#sort-tag'), hPhase=$('#sort-phase'), hJit=$('#sort-jitter'), hFin=$('#sort-finished');
  function toggleSort(field){
    if (floatSort.field===field) floatSort.dir = (floatSort.dir==='asc'?'desc':'asc'); else { floatSort.field=field; floatSort.dir='asc'; }
    rerenderFloatingTable();
  }
  if (hTag) hTag.addEventListener('click', ()=> toggleSort('tag'));
  if (hPhase) hPhase.addEventListener('click', ()=> toggleSort('phase'));
  if (hJit) hJit.addEventListener('click', ()=> toggleSort('jitter'));
  if (hFin) hFin.addEventListener('click', ()=> toggleSort('finished'));
}

function initFloatingDrag(){
  const panel = $('#floating-panel'); if (!panel) return;
  const header = panel.querySelector('.card-header'); if (!header) return;
  let dragging=false, offX=0, offY=0;
  function onMove(e){ if(!dragging) return; panel.style.left = (e.clientX - offX) + 'px'; panel.style.top = (e.clientY - offY) + 'px'; }
  function onUp(){ dragging=false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
  header.addEventListener('mousedown', (e)=>{
    dragging=true;
    const rect = panel.getBoundingClientRect();
    offX = e.clientX - rect.left; offY = e.clientY - rect.top;
    // switch to explicit top/left positioning
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
    if (!panel.style.left) panel.style.left = rect.left + 'px';
    if (!panel.style.top) panel.style.top = rect.top + 'px';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}

// Socket
function initSocket() {
  if (socket) socket.disconnect();
  socket = io();
  socket.on('connect', () => setStatus('Connected', 'success'));
  socket.on('disconnect', () => setStatus('Disconnected', 'warning'));
  socket.on('testing_update', data => {
    try {
      // plannedTotal tetap dari awal; jika belum ada, ambil dari event
      if (!plannedTotal) plannedTotal = getTotalValue(data);
      processResults(data.results || []);
      // progress berdasarkan tabel final yang tampil
      setProgress(displayOrder.length, plannedTotal);
      rerenderTableInCompletionOrder(plannedTotal);
      updateSummary();
    } catch (err) { console.error(err); }
  });
  socket.on('testing_complete', data => {
    try {
      if (!plannedTotal) plannedTotal = data.total ?? getTotalValue(data);
      processResults(data.results || []);
      setProgress(displayOrder.length, plannedTotal);
      rerenderTableInCompletionOrder(plannedTotal);
      updateSummary();
      toast('Testing complete', 'success');
    } catch (err) { console.error(err); }
  });
  socket.on('testing_error', data => {
    toast(data?.message || 'Testing error', 'error');
    setStatus('Error', 'error');
  });
  socket.on('config_generated', data => {
    if (data.success) toast('Config generated', 'success'); else toast(`Config error: ${data.error}`, 'error');
  });
}

// Rows (keyed by index to avoid duplicates)
const rowMap = new Map(); // index -> <tr>
function renderRows(list, _finalize=false) {
  const tbody = $('#results-body'); if (!tbody) return;
  // Keep only valid objects with an index
  const items = (Array.isArray(list) ? list : []).filter(r => r && typeof r === 'object' && Number.isFinite(r.index));
  const incoming = new Set(items.map(r => r.index));

  // Remove rows that are no longer present
  for (const [idx, tr] of rowMap.entries()) {
    if (!incoming.has(idx)) {
      tr.remove();
      rowMap.delete(idx);
    }
  }

  // Upsert rows
  for (const r of items) {
    const status = normalizeStatus(r.Status);
    let tr = rowMap.get(r.index);
    if (!tr) {
      tr = document.createElement('tr');
      tr.id = `row-${r.index}`;
      rowMap.set(r.index, tr);
      tbody.appendChild(tr);
    }
    tr.innerHTML = `
      <td>${escapeHtml(r.OriginalTag || r.tag || '')}</td>
      <td>${escapeHtml(r.VpnType || r.type || '')}</td>
      <td>${escapeHtml(r['Tested IP'] || r.server || '-')}</td>
      <td>${fmtLatency(r.Latency)}</td>
      <td>${escapeHtml(r.Country || '❓')}</td>
      <td class="${statusClass(status)}">${status}</td>
    `;
  }
}

function escapeHtml(s){ return (s??'').toString().replace(/[&<>"]/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[m])); }
function normalizeStatus(s){ if (s==='●') return '✅'; if (s?.startsWith('✖')) return '❌'; return s || '⏳'; }
function statusClass(s){ if (s==='✅') return 'badge-ok'; if (s==='❌' || s==='Dead') return 'badge-fail'; if (s==='⏳' || s==='🔄' || s==='🔁' || s==='WAIT') return 'badge-wait'; return ''; }

// Summary
function updateSummary(list){
  // Hitung berdasarkan baris final yang tampil (displayOrder)
  const shown = displayOrder.map(idx => latestByIndex.get(idx)).filter(Boolean);
  const ok = shown.filter(r=>r.Status==='✅').length;
  const bad = shown.filter(r=>r.Status==='❌' || r.Status==='Dead').length;
  const lat = (()=>{ const l=shown.filter(r=>r.Status==='✅' && r.Latency>-1).map(r=>+r.Latency); if(!l.length) return '–'; const avg=Math.round(l.reduce((a,b)=>a+b,0)/l.length); return `${avg} ms`; })();
  $('#stat-success').textContent = ok; $('#stat-failed').textContent = bad; $('#stat-latency').textContent = lat;
}

// API
async function api(path, opts){
  console.debug('[API]', path, opts?.method || 'GET');
  const r = await fetch(path, opts);
  console.debug('[API][resp]', path, r.status);
  if(!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// Config Source UI
function currentSource(){ return document.querySelector('input[name="config-source"]:checked')?.value || 'template'; }
function switchSourceUI(){ const gh = $('#github-panel'); if (currentSource()==='github') gh.classList.remove('hidden'); else gh.classList.add('hidden'); }

// GitHub saved config
async function loadSavedGitHub(){
  try {
    const d = await api('/api/get-github-config');
    if (d.success) {
      if (d.owner) $('#gh-owner').value = d.owner;
      if (d.repo) $('#gh-repo').value = d.repo;
    }
  } catch {}
}

// Restore testing status
async function restoreTesting(){
  try {
    const d = await api('/api/get-testing-status');
    if (d.has_active_testing) {
      plannedTotal = d.total ?? getTotalValue(d);
      // Biarkan proses update socket mengisi tabel; set indikator awal
      setProgress(0, plannedTotal);
      setStatus('Restored','success');
    }
  } catch {}
}

// Actions
async function loadConfig(){
  try {
    if (currentSource()==='template') {
      try { await api('/api/load-template-config'); } catch {}
      const data = await api('/api/load-config', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ source:'local' })
      });
      if (data.success) { toast(data.message || 'Template loaded', 'success'); setStatus('Template loaded','success'); }
      else { toast(data.message || 'Load failed','error'); setStatus('Load failed','error'); }
    } else {
      const token = $('#gh-token').value.trim(); const owner=$('#gh-owner').value.trim(); const repo=$('#gh-repo').value.trim();
      if (token && owner && repo) {
        const s = await api('/api/save-github-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,owner,repo})});
        if (!s.success) { toast(s.message||'Save GitHub failed','error'); return; }
      }
      toast('GitHub ready','success'); setStatus('GitHub ready','success');
    }
  } catch (err) { console.error(err); toast('Action failed','error'); }
}

async function listGithub(){ try { const f = await api('/api/list-github-files'); const sel = $('#gh-files'); sel.innerHTML=''; (f.files||[]).forEach(x=>{ const opt=document.createElement('option'); opt.value=x.path; opt.textContent=x.name; sel.appendChild(opt); }); toast('Files loaded','success'); } catch(err){ console.error(err); toast('List failed','error'); } }
async function loadGithubFile(){ try { const file=$('#gh-files').value; if(!file){ toast('Select file','warning'); return; } const d=await api('/api/load-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'github',file_path:file})}); if(d.success){ toast(d.message||'Loaded','success'); } else { toast(d.message||'Load failed','error'); } } catch(err){ console.error(err); toast('Load failed','error'); } }

// Add & Start
function setMode(mode){ currentMode = mode || 'fast'; setModePill(currentMode==='xray-only'?'XRAY-Only':'Fast'); }
async function addAndStart(){
  try {
    const text = $('#vpn-input').value.trim(); if (!text){ toast('No input','warning'); return; }
    if (currentSource()==='template') { try { await api('/api/load-template-config'); } catch {} await api('/api/load-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'local'})}); }
    const res = await api('/api/add-links-and-test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({links:text})});
    if (!res.success){ toast(res.message||'Add failed','error'); return; }
    resetTableState();
    plannedTotal = getTotalValue(res);
    setProgress(0, plannedTotal);
    $('#vpn-input').value=''; toast('Starting tests…','info');
    // Show one global skeleton immediately to signal progress
    ensureGlobalSkeleton(true);
    const payload = { mode: currentMode };
    socket.emit('start_testing', payload);
  } catch (err) { console.error(err); toast('Start failed','error'); }
}

// Servers apply & Generate
async function applyServers(){
  try {
    const servers = $('#servers-input').value.trim();
    const d = await api('/api/generate-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({custom_servers:servers})});
    if (d.success) toast(`Config updated (${d.account_count} accounts)`, 'success'); else toast(d.message||'Generate failed','error');
  } catch (err) { console.error(err); toast('Generate failed','error'); }
}

// Download & Upload
async function downloadConfig(){
  try {
    const r = await fetch('/api/download-config');
    if (!r.ok) { toast('No config to download','warning'); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'VortexVpn.json'; a.click(); URL.revokeObjectURL(url);
  } catch (err) { console.error(err); toast('Download failed','error'); }
}

function toggleUploadPanel(){ $('#upload-panel').classList.toggle('hidden'); }
async function doUpload(){
  try {
    const commit_message = $('#commit-message').value.trim() || 'Update VPN configuration';
    const d = await api('/api/upload-to-github',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({commit_message})});
    if (d.success) { toast(d.message||'Uploaded','success'); toggleUploadPanel(); } else { toast(d.message||'Upload failed','error'); }
  } catch (err) { console.error(err); toast('Upload failed','error'); }
}

// Global error handler
window.addEventListener('error', (e) => { try { toast(`Error: ${e.message}`, 'error'); } catch {} });
window.addEventListener('unhandledrejection', (e) => { try { toast(`Request failed`, 'error'); } catch {} });

// Init
function bindEvents(){
  console.debug('[UI] bindEvents');
  bindInfoTips();
  bindRipple();
  bindFloatingControls();
  $all('input[name="config-source"]').forEach(r=>r.addEventListener('change', () => { console.debug('[UI] source change'); switchSourceUI(); }));
  const b1=$('#btn-load-config'); if (b1) b1.addEventListener('click', () => { toast('Loading config…','info'); console.debug('[Action] loadConfig'); loadConfig(); });
  const b2=$('#btn-save-gh'); if (b2) b2.addEventListener('click', () => { toast('Saving GitHub…','info'); console.debug('[Action] saveGitHub'); loadConfig(); });
  const b3=$('#btn-list-gh'); if (b3) b3.addEventListener('click', () => { toast('Listing files…','info'); console.debug('[Action] listGitHub'); listGithub(); });
  const b4=$('#btn-load-gh'); if (b4) b4.addEventListener('click', () => { toast('Loading file…','info'); console.debug('[Action] loadGitHubFile'); loadGithubFile(); });
  const b5=$('#btn-add-test'); if (b5) b5.addEventListener('click', () => { toast('Adding & starting…','info'); console.debug('[Action] addAndStart'); addAndStart(); });
  // mode removed
  const b6=$('#btn-apply-servers'); if (b6) b6.addEventListener('click', () => { toast('Applying servers…','info'); console.debug('[Action] applyServers'); applyServers(); });
  const b7=$('#btn-download-config'); if (b7) b7.addEventListener('click', () => { toast('Downloading…','info'); console.debug('[Action] downloadConfig'); downloadConfig(); });
  const b8=$('#btn-upload-github'); if (b8) b8.addEventListener('click', () => { console.debug('[UI] toggleUploadPanel'); toggleUploadPanel(); });
  const b9=$('#btn-do-upload'); if (b9) b9.addEventListener('click', () => { toast('Uploading…','info'); console.debug('[Action] doUpload'); doUpload(); });
}

async function bootstrap(){
  try {
    console.debug('[BOOT] start');
    // Sanity checks
    if (!document || !document.body) throw new Error('DOM not ready');
    if (typeof io === 'undefined') throw new Error('Socket.IO client not loaded');
    if (!document.querySelector('#btn-add-test')) console.warn('[BOOT] UI button #btn-add-test not found (check template)');

    switchSourceUI();
    console.debug('[BOOT] switchSourceUI ok');
    initSocket();
    console.debug('[BOOT] socket ok');
    bindEvents();
    console.debug('[BOOT] bind ok');
    setStatus('Ready','success');
    setMode('fast');
    await loadSavedGitHub();
    console.debug('[BOOT] github ok');
    await restoreTesting();
    console.debug('[BOOT] restore ok');
  } catch (err) {
    console.error('Bootstrap error:', err);
    toast('Init failed','error');
  }
}
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}