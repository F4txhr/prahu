// State
let socket = null;
let currentMode = 'accurate';
let totals = { total: 0, completed: 0 };
let results = [];

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
const skeletonSet = new Set(); // indexes with active skeleton placeholder

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
  skeletonSet.clear(); // Clear skeleton set on reset
  rowMap.clear();
  const tbody = $('#results-body'); if (tbody) tbody.innerHTML = '';
}

function insertSkeletonBelow(idx) {
  const tbody = $('#results-body'); if (!tbody) return;
  if (skeletonSet.has(idx)) return;
  const sk = document.createElement('tr');
  sk.className = 'skel-row';
  sk.id = `skel-${idx}`;
  sk.innerHTML = `
    <td><span class="skeleton-line lg"></span></td>
    <td><span class="skeleton-line sm"></span></td>
    <td><span class="skeleton-line md"></span></td>
    <td><span class="skeleton-line sm"></span></td>
    <td><span class="skeleton-line sm"></span></td>
    <td><span class="skeleton-line md"></span></td>
  `;
  const tr = rowMap.get(idx);
  if (tr && tr.nextSibling) tr.parentNode.insertBefore(sk, tr.nextSibling);
  else tbody.appendChild(sk);
  skeletonSet.add(idx);
}

function removeSkeleton(idx) {
  const el = document.getElementById(`skel-${idx}`);
  if (el) el.remove();
  skeletonSet.delete(idx);
}

function processResults(list) {
  if (!Array.isArray(list)) return;
  for (const r of list) {
    if (!r || typeof r !== 'object' || !Number.isFinite(r.index)) continue;
    latestByIndex.set(r.index, r);
    const twoPhase = (currentMode === 'hybrid' || currentMode === 'accurate');

    // Handle phase transitions
    if (twoPhase) {
      // If phase1 success (non-xray success) just completed, show placeholder skeleton row (subtle preview)
      if (r.Status === '✅' && !r.XRAY && !shownSet.has(r.index)) {
        // Do not show final row yet; just mark as completed placeholder in order
        shownSet.add(r.index);
        displayOrder.push(r.index);
        // Render a soft placeholder for this index
        upsertRow({ ...r, Status: '🔄' });
        insertSkeletonBelow(r.index);
        continue; // skip showing as final in phase1
      }
      // If final XRAY success arrives, replace row and remove skeleton
      if (r.Status === '✅' && r.XRAY) {
        // Ensure in order if not already
        if (!shownSet.has(r.index)) { shownSet.add(r.index); displayOrder.push(r.index); }
        upsertRow(r);
        removeSkeleton(r.index);
        continue;
      }
    }

    // For failures or single-phase modes, show normally when final
    if (shouldShowResult(r)) {
      if (!shownSet.has(r.index)) { shownSet.add(r.index); displayOrder.push(r.index); }
      upsertRow(r);
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

function rerenderTableInCompletionOrder() {
  const tbody = $('#results-body'); if (!tbody) return;
  const frag = document.createDocumentFragment();
  for (const idx of displayOrder) {
    const tr = rowMap.get(idx);
    if (tr) frag.appendChild(tr);
  }
  tbody.innerHTML = '';
  tbody.appendChild(frag);
}

// Socket
function initSocket() {
  if (socket) socket.disconnect();
  socket = io();
  socket.on('connect', () => setStatus('Connected', 'success'));
  socket.on('disconnect', () => setStatus('Disconnected', 'warning'));
  socket.on('testing_update', data => {
    try {
      const total = getTotalValue(data);
      const completed = data.completed ?? data.results?.filter(r => isFinalStatus(r.Status)).length ?? 0;
      setProgress(completed, total);
      processResults(data.results || []);
      rerenderTableInCompletionOrder();
    } catch (err) { console.error(err); }
  });
  socket.on('testing_complete', data => {
    try {
      const total = data.total ?? getTotalValue(data);
      setProgress(data.successful ?? 0, total);
      processResults(data.results || []);
      rerenderTableInCompletionOrder();
      updateSummary((data.results || []).filter(shouldShowResult));
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
  const ok = list.filter(r=>r.Status==='✅').length;
  const bad = list.filter(r=>r.Status==='❌' || r.Status==='Dead').length;
  const lat = (()=>{ const l=list.filter(r=>r.Status==='✅' && r.Latency>-1).map(r=>+r.Latency); if(!l.length) return '–'; const avg=Math.round(l.reduce((a,b)=>a+b,0)/l.length); return `${avg} ms`; })();
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
      const total = d.total ?? getTotalValue(d);
      setProgress(d.completed ?? 0, total);
      renderRows(d.results || []);
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
function setMode(mode){ currentMode = mode; setModePill(mode); $all('.segmented-item').forEach(b=>b.classList.toggle('active', b.getAttribute('data-mode')===mode)); }
async function addAndStart(){
  try {
    const text = $('#vpn-input').value.trim(); if (!text){ toast('No input','warning'); return; }
    if (currentSource()==='template') { try { await api('/api/load-template-config'); } catch {} await api('/api/load-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'local'})}); }
    const res = await api('/api/add-links-and-test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({links:text})});
    if (!res.success){ toast(res.message||'Add failed','error'); return; }
    resetTableState();
    const total = getTotalValue(res); setProgress(0,total); $('#vpn-input').value=''; toast('Starting tests…','info');
    const payload = { mode: currentMode }; if (currentMode==='hybrid') { const n = parseInt($('#top-n').value||'20',10); payload.topN = isNaN(n)?20:Math.max(1,Math.min(999,n)); }
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
  $all('input[name="config-source"]').forEach(r=>r.addEventListener('change', () => { console.debug('[UI] source change'); switchSourceUI(); }));
  const b1=$('#btn-load-config'); if (b1) b1.addEventListener('click', () => { toast('Loading config…','info'); console.debug('[Action] loadConfig'); loadConfig(); });
  const b2=$('#btn-save-gh'); if (b2) b2.addEventListener('click', () => { toast('Saving GitHub…','info'); console.debug('[Action] saveGitHub'); loadConfig(); });
  const b3=$('#btn-list-gh'); if (b3) b3.addEventListener('click', () => { toast('Listing files…','info'); console.debug('[Action] listGitHub'); listGithub(); });
  const b4=$('#btn-load-gh'); if (b4) b4.addEventListener('click', () => { toast('Loading file…','info'); console.debug('[Action] loadGitHubFile'); loadGithubFile(); });
  const b5=$('#btn-add-test'); if (b5) b5.addEventListener('click', () => { toast('Adding & starting…','info'); console.debug('[Action] addAndStart'); addAndStart(); });
  $all('.segmented-item').forEach(b=> b.addEventListener('click', ()=> { console.debug('[UI] setMode', b.getAttribute('data-mode')); setMode(b.getAttribute('data-mode')); }));
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
    setMode('accurate');
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