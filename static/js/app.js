// State
let socket = null;
let currentMode = 'default';
let totals = { total: 0, completed: 0 };
let results = [];
let plannedTotal = 0; // total akun yang akan dites (dari add-links-and-test)
// floating panel removed

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
  const asn = r.ASN || '-';
  const titleStatus = r.Reason ? `Reason: ${r.Reason}` : '';
  const titleICMP = r.ICMP ? `ICMP: ${r.ICMP}` : '';
  return `
    <td title="${escapeHtml(tag)}">${escapeHtml(truncate(tag,24))}</td>
    <td>${escapeHtml(transport)}</td>
    <td title="${escapeHtml(titleStatus)}">${phase}</td>
    <td title="${escapeHtml(titleICMP)}">${jitter}</td>
    <td>${escapeHtml(asn)}</td>
    <td>${escapeHtml(finished)}</td>
    <td>
      <button class="btn btn-soft text-xs px-2 py-1" data-copy="tag" data-idx="${r.index}">Tag</button>
      <button class="btn btn-soft text-xs px-2 py-1" data-copy="ip" data-idx="${r.index}">IP</button>
      <button class="btn btn-soft text-xs px-2 py-1" data-copy="json" data-idx="${r.index}">JSON</button>
    </td>`;
}

// floating panel removed

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

  // floating panel removed
}

// floating panel removed

// Global error handler
window.addEventListener('error', (e) => { try { toast(`Error: ${e.message}`, 'error'); } catch {} });
window.addEventListener('unhandledrejection', (e) => { try { toast(`Request failed`, 'error'); } catch {} });

// Init
function bindEvents(){
  console.debug('[UI] bindEvents');
  bindInfoTips();
  bindRipple();
  // floating panel removed
  $all('input[name="config-source"]').forEach(r=>r.addEventListener('change', () => { console.debug('[UI] source change'); switchSourceUI(); }));
  // Bind test mode radios
  $all('input[name="test-mode"]').forEach(r=>r.addEventListener('change', (e) => {
    const v = e.target.value === 'xray-only' ? 'xray-only' : 'fast';
    setMode(v);
  }));
  const b1=$('#btn-load-config'); if (b1) b1.addEventListener('click', () => { toast('Loading config…','info'); console.debug('[Action] loadConfig'); loadConfig(); });
  const b0=$('#btn-use-source'); if (b0) b0.addEventListener('click', () => { const url='https://yumicftigarun.web.id/api/v1/sub/?format=raw&limit=10&vpn=vless,trojan,ss,vmess&port=80,443&domain=plus-store.naver.com&cc=ID,SG'; $('#vpn-input').value = url; toast('Source URL set','success'); });
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