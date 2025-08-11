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

// Ripple position
$all('.btn').forEach(b => b.addEventListener('pointerdown', e => {
  const rect = b.getBoundingClientRect();
  b.style.setProperty('--x', `${e.clientX - rect.left}px`);
  b.style.setProperty('--y', `${e.clientY - rect.top}px`);
}));

// Toast
function toast(message, type='info') {
  const c = $('#toast-container'); if (!c) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  c.appendChild(el);
  setTimeout(() => { el.remove(); }, 3000);
}

// Info popover (simple tooltip)
function bindInfoTips() {
  $all('.info-btn').forEach(btn => {
    let tip; const text = btn.getAttribute('data-info') || '';
    btn.addEventListener('mouseenter', () => {
      tip = document.createElement('div');
      tip.className = 'toast';
      tip.style.position = 'absolute';
      tip.style.transform = 'translateY(8px)';
      tip.style.whiteSpace = 'nowrap';
      tip.textContent = text;
      const r = btn.getBoundingClientRect();
      tip.style.left = `${r.left - 8}px`;
      tip.style.top = `${r.bottom + 6 + window.scrollY}px`;
      tip.style.zIndex = 40;
      document.body.appendChild(tip);
    });
    btn.addEventListener('mouseleave', () => tip && tip.remove());
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
  });
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

// Socket
function initSocket() {
  if (socket) socket.disconnect();
  socket = io();
  socket.on('connect', () => setStatus('Connected', 'success'));
  socket.on('disconnect', () => setStatus('Disconnected', 'warning'));
  socket.on('testing_update', data => {
    const total = getTotalValue(data);
    const completed = data.completed ?? data.results?.filter(r => !['WAIT','🔄','🔁'].includes(r.Status)).length ?? 0;
    setProgress(completed, total);
    renderRows(data.results || []);
  });
  socket.on('testing_complete', data => {
    const total = data.total ?? getTotalValue(data);
    setProgress(data.successful ?? 0, total);
    results = data.results || [];
    renderRows(results, true);
    updateSummary(results);
    toast('Testing complete', 'success');
  });
  socket.on('testing_error', data => {
    toast(data?.message || 'Testing error', 'error');
    setStatus('Error', 'error');
  });
  socket.on('config_generated', data => {
    if (data.success) toast('Config generated', 'success'); else toast(`Config error: ${data.error}`, 'error');
  });
}

// Rows
function renderRows(list, finalize=false) {
  const tbody = $('#results-body'); if (!tbody) return;
  if (finalize) tbody.innerHTML = '';
  const frag = document.createDocumentFragment();
  list.forEach(r => {
    const tr = document.createElement('tr');
    const status = normalizeStatus(r.Status);
    tr.innerHTML = `
      <td>${escapeHtml(r.OriginalTag || r.tag || '')}</td>
      <td>${escapeHtml(r.VpnType || r.type || '')}</td>
      <td>${escapeHtml(r['Tested IP'] || r.server || '-')}</td>
      <td>${fmtLatency(r.Latency)}</td>
      <td>${escapeHtml(r.Country || '❓')}</td>
      <td class="${statusClass(status)}">${status}</td>
    `;
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
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
async function api(path, opts){ const r = await fetch(path, opts); if(!r.ok) throw new Error(`${r.status}`); return r.json(); }

// Config Source UI
function currentSource(){ return document.querySelector('input[name="config-source"]:checked')?.value || 'template'; }
function switchSourceUI(){ const gh = $('#github-panel'); if (currentSource()==='github') gh.classList.remove('hidden'); else gh.classList.add('hidden'); }

// Actions
async function loadConfig(){
  if (currentSource()==='template') {
    // Try direct template endpoint first
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
}

async function listGithub(){ const f = await api('/api/list-github-files'); const sel = $('#gh-files'); sel.innerHTML=''; (f.files||[]).forEach(x=>{ const opt=document.createElement('option'); opt.value=x.path; opt.textContent=x.name; sel.appendChild(opt); }); }
async function loadGithubFile(){ const file=$('#gh-files').value; if(!file){ toast('Select file','warning'); return; } const d=await api('/api/load-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'github',file_path:file})}); if(d.success){ toast(d.message||'Loaded','success'); } else { toast(d.message||'Load failed','error'); } }

// Add & Start
function setMode(mode){ currentMode = mode; setModePill(mode); $all('.segmented-item').forEach(b=>b.classList.toggle('active', b.getAttribute('data-mode')===mode)); }
async function addAndStart(){
  const text = $('#vpn-input').value.trim(); if (!text){ toast('No input','warning'); return; }
  // Ensure config loaded
  if (currentSource()==='template') { try { await api('/api/load-template-config'); } catch {} await api('/api/load-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'local'})}); }
  const res = await api('/api/add-links-and-test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({links:text})});
  if (!res.success){ toast(res.message||'Add failed','error'); return; }
  const total = getTotalValue(res); setProgress(0,total); $('#vpn-input').value=''; toast('Starting tests…','info');
  const payload = { mode: currentMode }; if (currentMode==='hybrid') { const n = parseInt($('#top-n').value||'20',10); payload.topN = isNaN(n)?20:Math.max(1,Math.min(999,n)); }
  socket.emit('start_testing', payload);
}

// Servers apply & Generate
async function applyServers(){
  const servers = $('#servers-input').value.trim();
  const d = await api('/api/generate-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({custom_servers:servers})});
  if (d.success) toast(`Config updated (${d.account_count} accounts)`, 'success'); else toast(d.message||'Generate failed','error');
}

// Download & Upload
async function downloadConfig(){
  // Try to fetch as blob and force download
  const r = await fetch('/api/download-config');
  if (!r.ok) { toast('No config to download','warning'); return; }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'VortexVpn.json'; a.click(); URL.revokeObjectURL(url);
}

function toggleUploadPanel(){ $('#upload-panel').classList.toggle('hidden'); }
async function doUpload(){
  const commit_message = $('#commit-message').value.trim() || 'Update VPN configuration';
  const d = await api('/api/upload-to-github',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({commit_message})});
  if (d.success) { toast(d.message||'Uploaded','success'); toggleUploadPanel(); } else { toast(d.message||'Upload failed','error'); }
}

// Init
function bindEvents(){
  bindInfoTips();
  $all('input[name="config-source"]').forEach(r=>r.addEventListener('change', switchSourceUI));
  $('#btn-load-config').addEventListener('click', loadConfig);
  $('#btn-save-gh').addEventListener('click', loadConfig);
  $('#btn-list-gh').addEventListener('click', listGithub);
  $('#btn-load-gh').addEventListener('click', loadGithubFile);
  $('#btn-add-test').addEventListener('click', addAndStart);
  $all('.segmented-item').forEach(b=> b.addEventListener('click', ()=> setMode(b.getAttribute('data-mode'))));
  $('#btn-apply-servers').addEventListener('click', applyServers);
  $('#btn-download-config').addEventListener('click', downloadConfig);
  $('#btn-upload-github').addEventListener('click', toggleUploadPanel);
  $('#btn-do-upload').addEventListener('click', doUpload);
}

window.addEventListener('DOMContentLoaded', async () => {
  switchSourceUI();
  initSocket();
  bindEvents();
  setStatus('Ready','success');
  setMode('accurate');
});