// app.js 
document.addEventListener("DOMContentLoaded", () => {
  const containerList   = document.getElementById("container-list");
  const refreshButton   = document.getElementById("refresh-button");
  const sortSelect      = document.getElementById("sort-select");
  const searchControl   = document.getElementById("search-control");
  const searchToggle    = document.getElementById("search-toggle");
  const searchInput     = document.getElementById("search-input");
  const actionBanner    = document.getElementById("action-banner");
  const loadingOverlay  = document.getElementById("loading-overlay");

  if (!containerList || typeof cockpit === "undefined") return;

  let containerStats = {};
  let currentSort    = localStorage.getItem('sortBy') || 'name';
  let currentSearch  = localStorage.getItem('searchQuery') || '';
  let pauseRefreshUntil = 0;
  window.__stopManageTerminal = null;

  // keep exactly ONE declaration for the logs follower used in the Manage modal
  let manageLogProc = null;
  let manageLogToken = 0;

  // --- focus preservation around refresh ---
  let rememberedFocus = null;
  function rememberFocus(){
    if (document.activeElement === searchInput) {
      rememberedFocus = { isSearch: true, pos: searchInput.selectionStart ?? (searchInput.value||'').length };
    } else rememberedFocus = null;
  }
  function restoreRememberedFocus(){
    if (rememberedFocus?.isSearch && searchControl?.classList.contains('open')) {
      const pos = Math.max(0, Math.min((searchInput.value||'').length, rememberedFocus.pos||0));
      searchInput.focus({ preventScroll: true });
      try { searchInput.setSelectionRange(pos, pos); } catch(_) {}
    }
    rememberedFocus = null;
  }

  // --- sort ---
  if (sortSelect) {
    try { sortSelect.value = currentSort; } catch(_){}
    sortSelect.addEventListener('change', () => {
      currentSort = sortSelect.value;
      localStorage.setItem('sortBy', currentSort);
      rememberFocus();
      reloadContainers(() => restoreRememberedFocus(), true);
    });
  }

  // --- pin header ---
  const header = document.getElementById("app-header");
  const pinBtn = document.getElementById("pin-btn");
  const spacer = document.getElementById("header-spacer");
  if (header && pinBtn && spacer) {
    function applyPinned(isPinned, persist=true){
      if (isPinned) {
        header.classList.add("pinned");
        spacer.style.height = `${header.offsetHeight}px`;
        pinBtn.classList.add("is-pinned");
      } else {
        header.classList.remove("pinned");
        spacer.style.height = "0";
        pinBtn.classList.remove("is-pinned");
      }
      if (persist) localStorage.setItem("headerPinned", String(isPinned));
    }
    applyPinned(localStorage.getItem("headerPinned")==="true", false);
    pinBtn.addEventListener("click", () => applyPinned(!header.classList.contains("pinned")));
    window.addEventListener("resize", () => { if (header.classList.contains("pinned")) spacer.style.height = `${header.offsetHeight}px`; });
  }

  // --- images modal ---
  document.getElementById("image-toggle-btn")?.addEventListener("click", showImagesModal);
  function showImagesModal(){ openOrBuildImagesModal(); }
  function openOrBuildImagesModal(){
    let modal = document.getElementById("images-modal");
    if (!modal){
      modal = document.createElement("div");
      modal.id = "images-modal";
      modal.className = "logs-modal";
      modal.innerHTML = `
        <div class="logs-modal-content">
          <div class="logs-modal-header">
            <h3>Docker Images</h3>
            <div class="logs-controls">
              <button id="images-refresh-btn" class="logs-btn" aria-label="Refresh images" title="Refresh images">↻</button>
              <button id="images-prune-btn" class="logs-btn">Auto Prune</button>
              <button id="images-close-btn" class="logs-btn">✖️ Close</button>
            </div>
          </div>
          <div id="images-content" class="logs-content"><div class="loading">Loading images…</div></div>
        </div>`;
      document.body.appendChild(modal);
      document.getElementById("images-close-btn").addEventListener("click", () => modal.style.display = "none");
      document.getElementById("images-refresh-btn").addEventListener("click", loadImagesList);
      const pruneBtn = document.getElementById("images-prune-btn");
      pruneBtn.addEventListener("click", () => {
        const content = document.getElementById("images-content");
        const prev = pruneBtn.textContent; pruneBtn.disabled=true; pruneBtn.classList.add("loading"); pruneBtn.textContent="Pruning…";
        const old = content.innerHTML; content.innerHTML = `<div class="loading">Pruning dangling images…</div>`;
        cockpit.spawn(["docker","image","prune","-f"],{err:"message"})
          .then(loadImagesList)
          .catch(err=>{ showBanner(`❌ Prune failed: ${escapeHtml(String(err))}`); content.innerHTML = old; })
          .finally(()=>{ pruneBtn.disabled=false; pruneBtn.classList.remove("loading"); pruneBtn.textContent=prev; });
      });
      modal.addEventListener("click", e => { if (e.target === modal) modal.style.display="none"; });
    }
    modal.style.display = "block";
    loadImagesList();
  }
  function loadImagesList(){
    const content = document.getElementById("images-content");
    if (!content) return;
    content.innerHTML = `<div class="loading">Loading images…</div>`;
    const fmt = "{{.Repository}}:{{.Tag}}\\t{{.ID}}\\t{{.Size}}\\t{{.CreatedSince}}";
    Promise.all([
      cockpit.spawn(["docker","images","--no-trunc","--format",fmt],{err:"message"}),
      cockpit.spawn(["docker","ps","-a","--no-trunc","--format","{{.Image}}\t{{.ImageID}}"],{err:"message"}).catch(()=>"")
    ])
      .then(([imagesOut, containersOut]) => {
        const usedImageRefs = new Set();
        (containersOut||"").trim().split("\n").forEach(line => {
          if (!line) return;
          const [imageRef = "", rawId = ""] = line.split("\t");
          if (imageRef) usedImageRefs.add(imageRef);
          if (!rawId) return;
          const variants = [rawId];
          const trimmed = rawId.replace(/^sha256:/,"");
          if (trimmed && trimmed !== rawId) variants.push(trimmed);
          const short = trimmed.slice(0,12);
          if (short) variants.push(short);
          variants.forEach(v => usedImageRefs.add(v));
        });
        const lines = imagesOut.trim() ? imagesOut.trim().split("\n") : [];
        if (!lines.length){ content.innerHTML = `<div class="empty">No Docker images found.</div>`; return; }

        const removable = lines.filter(line => {
          const [, id] = line.split("\t");
          if (!id) return false;
          if (usedImageRefs.has(id)) return false;
          const plain = id.replace(/^sha256:/,"");
          if (plain){
            if (usedImageRefs.has(plain) || usedImageRefs.has(plain.slice(0,12))) return false;
          }
          const [repoTag] = line.split("\t");
          if (repoTag && usedImageRefs.has(repoTag)) return false;
          return true;
        });

        if (!removable.length){
          content.innerHTML = `<div class="empty">All images are currently in use by containers.</div>`;
          return;
        }

        content.innerHTML = `<div class="images-list">${
          removable.map(line=>{
            const [repoTag, id, size, age] = line.split("\t");
            const name = (repoTag && repoTag!=="<none>:<none>") ? repoTag : "(dangling)";
            const short = (id||"").replace(/^sha256:/,"").slice(0,12)||"unknown";
            return `<div class="image-row">
                      <div class="image-meta">
                        <span class="image-name">${escapeHtml(name)}</span>
                        <span class="image-id">ID: ${escapeHtml(short)}</span>
                        <span class="image-size">Size: ${escapeHtml(size||"n/a")}</span>
                        <span class="image-age">Created: ${escapeHtml(age||"n/a")}</span>
                      </div>
                      <div class="image-actions"><button class="logs-btn image-danger" data-image-id="${id}">Delete</button></div>
                    </div>`;
          }).join("")}
        </div>`;

        content.querySelectorAll("[data-image-id]").forEach(btn => {
          const imageId = btn.getAttribute("data-image-id");
          if (!imageId) return;
          btn.addEventListener("click", () => {
            const orig = btn.textContent;
            btn.disabled = true;
            btn.textContent = "Deleting…";
            const shortId = imageId.replace(/^sha256:/,"").slice(0,12) || imageId;
            cockpit.spawn(["docker","rmi",imageId],{err:"message"})
              .then(()=>{ showBanner(`🗑️ Deleted ${shortId}`); loadImagesList(); })
              .catch(err=>{ showBanner(`❌ Delete failed: ${escapeHtml(String(err))}`); btn.disabled=false; btn.textContent=orig; });
          });
        });
      })
      .catch(err => { content.innerHTML = `<div class="error">Failed to load images: ${escapeHtml(String(err))}</div>`; });
  }

  // --- search ---
  if (searchControl && searchToggle && searchInput){
    if ((currentSearch||'').length>0){ searchInput.value=currentSearch; searchControl.classList.add('open'); setTimeout(applyFilterToDOM,0); }
    searchToggle.addEventListener('click',()=>{
      const isOpen = searchControl.classList.toggle('open');
      if (isOpen){ requestAnimationFrame(()=>{ searchInput.focus(); searchInput.select(); }); }
      else { searchInput.value=''; currentSearch=''; localStorage.setItem('searchQuery',''); applyFilterToDOM(); }
    });
    let debounce; searchInput.addEventListener('input',()=>{
      clearTimeout(debounce);
      debounce = setTimeout(()=>{
        currentSearch = (searchInput.value||'').trim().toLowerCase();
        localStorage.setItem('searchQuery', searchInput.value||'');
        applyFilterToDOM();
        pauseRefreshUntil = Date.now()+1500;
      }, 800);
    });
    ['keydown','keypress','keyup'].forEach(evt => searchInput.addEventListener(evt, e=>e.stopPropagation()));
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape'){ searchInput.value=''; currentSearch=''; localStorage.setItem('searchQuery',''); applyFilterToDOM(); }
    });
  }

  // --- helpers ---
  function showBanner(msg){ if(!actionBanner) return; actionBanner.textContent=msg; actionBanner.style.display="block"; setTimeout(()=>actionBanner.style.display="none", 5000); }
  function hideLoading(){ if(loadingOverlay) loadingOverlay.style.display="none"; }
  function showError(msg){ containerList.innerHTML = `<div class="error">${msg}</div>`; }

  function runDockerCommand(container, action){
    showBanner(`${action.charAt(0).toUpperCase()+action.slice(1)}ing ${container}…`);
    cockpit.spawn(["docker", action, container], { err:"message" })
      .then(()=>reloadContainers())
      .catch(()=>showBanner(`❌ Failed to ${action} ${container}`));
  }
  window.runDockerCommand = runDockerCommand;

  function parsePorts(text){
    if(!text) return "";
    const hostname = window.location.hostname, seen=new Set();
    const matches = text.match(/(?:[0-9.:\[\]]+)?:(\d+)->/g); if(!matches) return "";
    return matches.map(m=>{ const mm = m.match(/:(\d+)->/); if(!mm) return null; const hp=mm[1]; if(seen.has(hp)) return null; seen.add(hp); return `<a href="http://${hostname}:${hp}" target="_blank">${hp}</a>`; }).filter(Boolean).join(" ");
  }

  function parseUptimeSeconds(s){
    if(!s) return -1; const t=s.toLowerCase(); if(!t.startsWith('up')) return -1;
    const units={second:1,minute:60,hour:3600,day:86400,week:604800,month:2628000,year:31536000};
    const m=t.match(/(\d+)\s*(second|minute|hour|day|week|month|year)/); if(m){ return parseInt(m[1],10)*(units[m[2]]||1); }
    if(t.includes('about an hour')||t.includes('an hour')) return 3600;
    if(t.includes('a minute')) return 60;
    if(t.includes('a day')) return 86400;
    if(t.includes('a week')) return 604800;
    return 0;
  }

  function sortLines(lines){
    try{
      const rows = lines.filter(Boolean).map(l=>{ const [name,statusRaw="",portsRaw=""]=l.split("\t"); return { name, statusRaw, portsRaw, uptimeSeconds:parseUptimeSeconds(statusRaw), raw:l }; });
      if ((currentSort||'name')==='name') rows.sort((a,b)=>a.name.localeCompare(b.name));
      else if (currentSort==='uptime') rows.sort((a,b)=>b.uptimeSeconds-a.uptimeSeconds);
      return rows.map(r=>r.raw);
    }catch(_){ return lines; }
  }

  function loadContainerStats(){
    return cockpit.spawn(["docker","ps","-a","--format","{{.ID}}\t{{.Names}}"],{err:"message"})
      .then(out=>{
        const id2name={}; out.trim().split("\n").forEach(line=>{ if(!line) return; const [id,name]=line.split("\t"); if(id&&name){ id2name[id]=name; id2name[id.substring(0,12)]=name; } });
        return cockpit.spawn(["docker","stats","--no-stream","--format","{{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"],{err:"message"})
          .then(stats=>{
            containerStats={};
            stats.trim().split("\n").forEach(line=>{
              if(!line) return;
              const [cid,cpu,memUsage,memPerc]=line.split("\t");
              const name=id2name[cid];
              if(name){
                const used=(memUsage||'').split(' / ')[0];
                containerStats[name]={cpu,memUsage:used,memPerc};
              }
            });
          });
      })
      .catch(()=>{ containerStats={}; });
  }

  // -------------- Manage modal (Logs / Terminal / Details + Delete) --------------

  function openManageModal(containerName){
    const modal    = document.getElementById('manage-modal');
    const nameSpan = document.getElementById('manage-container-name');
    const tabBtns  = Array.from(document.querySelectorAll('.tab-btn'));
    const tabPanels= Array.from(document.querySelectorAll('.tab-panel'));
    const tabsBar  = document.querySelector('#manage-modal .tabs');

    nameSpan.textContent = containerName;
    modal.style.display  = 'block';

    // Ensure EXACTLY one Delete button in the tabs row (right-aligned)
    document.querySelectorAll('#manage-modal .logs-btn.danger').forEach(el=>el.remove());
    const delBtn = document.createElement('button');
    delBtn.id = 'delete-container-btn';
    delBtn.className = 'logs-btn danger';
    delBtn.textContent = 'Delete';
    delBtn.style.marginLeft = 'auto';
    tabsBar.appendChild(delBtn);
    delBtn.onclick = () => {
      const msg = `Delete container "${containerName}"? This will stop it if running.`;
      if (!window.confirm(msg)) return;
      cockpit.spawn(["docker","rm","-f",containerName],{err:"message"})
        .then(()=>{ showBanner(`🗑️ Deleted ${containerName}`); stopManageLogStream(); stopModalTerminal(); modal.style.display='none'; reloadContainers(); })
        .catch(err=>showBanner(`❌ Delete failed: ${escapeHtml(String(err))}`));
    };

    // default active tab
    activateTab('tab-logs');

    // Close button = silent teardown (no "[disconnected]" print)
    const closeBtn = document.getElementById('manage-close-btn');
    if (closeBtn){
      closeBtn.onclick = () => {
        stopManageLogStream();
        stopModalTerminal();
        modal.style.display = 'none';
      };
    }

    // tabs switching
    tabBtns.forEach(btn => {
      btn.onclick = () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activateTab(btn.dataset.tab);
      };
    });

    // Logs
    const followBtn = document.getElementById('tablogs-follow-btn');
    const clearBtn  = document.getElementById('tablogs-clear-btn');
    followBtn.onclick = () => {
      const following = followBtn.textContent.includes('⏸️');
      if (following){ stopManageLogStream(); followBtn.textContent='▶️ Follow'; followBtn.classList.remove('active'); }
      else { startManageLogStream(containerName); followBtn.textContent='⏸️ Stop'; followBtn.classList.add('active'); }
    };
    clearBtn.onclick = () => document.getElementById('tablogs-content').innerHTML = '<pre></pre>';
    loadInitialLogsInto(containerName, 'tablogs-content');
    setTimeout(()=>{
      startManageLogStream(containerName, { tail: 0 });
      followBtn.textContent='⏸️ Stop';
      followBtn.classList.add('active');
    }, 300);

    // Terminal (command-per-request)
    const openBtn = document.getElementById('open-terminal-btn');
    const shellSel = document.getElementById('shell-select');
    const outputEl = document.getElementById('modal-terminal-output');
    const inputEl  = document.getElementById('modal-terminal-input');

    if (openBtn) openBtn.setAttribute('aria-label','Open terminal');
    if (shellSel) shellSel.setAttribute('aria-label','Shell');
    if (inputEl)  inputEl.setAttribute('aria-label','Terminal input');

    let isTerminalActive = false;
    let terminalContainer = null;
    let terminalSessionId = 0;

    resetTerminalUI({ silent: true, clear: true });

    if (openBtn){
      openBtn.onclick = evt => {
        evt.preventDefault();
        evt.stopPropagation();
        if (isTerminalActive && terminalContainer === containerName) stopTerminalSession({ silent: false });
        else openTerminal();
      };
    }
    if (inputEl){
      ['keydown','keypress','keyup'].forEach(evt => inputEl.addEventListener(evt, e=>e.stopPropagation()));
      inputEl.onkeydown = handleTerminalInput;
    }

    window.__stopManageTerminal = (opts={}) => stopTerminalSession({ silent: true, clear: true, ...opts });

    // Details (robust)
    ensureDetailsContainer();
    loadDetails(containerName);

    function openTerminal(){
      if (!outputEl || !inputEl) return;
      const shell = (shellSel?.value || '/bin/sh').trim() || '/bin/sh';
      terminalSessionId = Date.now();
      terminalContainer = containerName;
      isTerminalActive = true;
      updateTerminalToggle();
      outputEl.textContent = '';
      appendTerminalLine(`Connected to ${containerName} using ${shell}`);
      inputEl.disabled = false;
      inputEl.value = '';
      try { inputEl.focus({ preventScroll: true }); } catch(_) { inputEl.focus(); }
      appendPrompt();
    }

    function appendPrompt(){ appendTerminalLine('$'); }

    function runCommand(cmd){
      if (!isTerminalActive || terminalContainer !== containerName) return;
      const session = terminalSessionId;
      appendTerminalLine(`$ ${cmd}`);
      const trimmed = cmd.trim();
      if (!trimmed){ appendPrompt(); return; }
      const target = terminalContainer || containerName;
      const shell = (shellSel?.value || '/bin/sh').trim() || '/bin/sh';
      const proc = cockpit.spawn(['docker','exec', target, shell, '-lc', cmd], { err:'message', superuser:'try' });
      proc.stream(data => { if (terminalSessionId === session) appendTerminalChunk(data); });
      proc.then(
        () => { if (terminalSessionId === session) appendPrompt(); },
        err => {
          if (terminalSessionId !== session) return;
          appendTerminalLine(`[error: ${String(err)}]`);
          appendPrompt();
        }
      );
    }

    function stopTerminalSession(opts={}){
      const merge = { silent: !!opts.silent, clear: !!opts.clear };
      if (!merge.clear) merge.clear = false;
      resetTerminalUI(merge);
    }

    function appendTerminalChunk(chunk){
      if (!outputEl || chunk == null) return;
      outputEl.textContent += chunk;
      outputEl.scrollTop = outputEl.scrollHeight;
    }

    function appendTerminalLine(text){
      if (!outputEl || text == null) return;
      if (outputEl.textContent && !outputEl.textContent.endsWith('\n')) outputEl.textContent += '\n';
      outputEl.textContent += `${text}\n`;
      outputEl.scrollTop = outputEl.scrollHeight;
    }

    function handleTerminalInput(event){
      if (!isTerminalActive || terminalContainer !== containerName) return;
      if (event.key === 'Enter'){
        event.preventDefault();
        const cmd = inputEl.value;
        inputEl.value = '';
        runCommand(cmd);
      } else if (event.key === 'c' && event.ctrlKey){
        event.preventDefault();
        appendTerminalLine('^C');
        appendPrompt();
      }
    }

    function updateTerminalToggle(){
      if (openBtn){
        openBtn.textContent = isTerminalActive ? 'Close terminal' : 'Open terminal';
        openBtn.classList.toggle('terminal-open', isTerminalActive);
      }
      if (inputEl) inputEl.disabled = !isTerminalActive;
    }

    function resetTerminalUI(opts={}){
      const silent = !!opts.silent;
      const clear = !!opts.clear;
      isTerminalActive = false;
      terminalContainer = null;
      terminalSessionId = Date.now();
      updateTerminalToggle();
      if (inputEl && clear) inputEl.value='';
      if (clear && outputEl) outputEl.textContent = '';
      if (!silent && outputEl) appendTerminalLine('[disconnected]');
    }

    function activateTab(id){
      tabPanels.forEach(p=>p.classList.toggle('active', p.id===id));
      tabBtns.forEach(b=>b.classList.toggle('active', b.dataset.tab===id));
      if (id !== 'tab-logs') stopManageLogStream();
    }
  }
  window.openManageModal = openManageModal;

  function stopModalTerminal(opts={}){
    const fn = window.__stopManageTerminal;
    if (typeof fn === 'function') fn(opts);
  }

  // ------ Details helpers ------
  function ensureDetailsContainer(){
    const panel = document.getElementById('tab-details');
    if (!panel) return;
    let content = panel.querySelector('#details-content');
    if (!content){
      content = document.createElement('div');
      content.id = 'details-content';
      content.className = 'logs-content';
      panel.appendChild(content);
    }
  }

  function loadDetails(name){
    const detailsEl = document.getElementById('details-content');
    if (!detailsEl) return;
    detailsEl.innerHTML = `<div class="loading">Loading details…</div>`;

    cockpit.spawn(["docker","inspect","--type","container", name], { err:"message" })
      .then(out => {
        try {
          const parsed = JSON.parse(out);
          const obj = Array.isArray(parsed) ? (parsed[0] || {}) : parsed;
          detailsEl.innerHTML = renderDetails(obj);
        } catch (e) {
          // Fallback: ask docker to pre-format JSON
          cockpit.spawn(["docker","inspect","--type","container","--format","{{json .}}", name], { err:"message" })
            .then(out2 => { detailsEl.innerHTML = renderDetails(JSON.parse(out2)); })
            .catch(err => { detailsEl.innerHTML = `<div class="error">Failed to parse details: ${escapeHtml(String(err))}</div>`; });
        }
      })
      .catch(err => { detailsEl.innerHTML = `<div class="error">Failed to load details: ${escapeHtml(String(err))}</div>`; });
  }

  // ------ Logs in Manage modal ------
  function startManageLogStream(containerName, opts={}) {
    stopManageLogStream({ skipUI: true, keepToken: true });
    const el = document.getElementById('tablogs-content');
    let tailArg;
    if (Number.isInteger(opts.tail)) tailArg = String(opts.tail);
    else tailArg = "0";
    const token = ++manageLogToken;
    const args = ["docker", "logs"];
    args.push("--tail", tailArg);
    args.push("-f", containerName);
    const proc = cockpit.spawn(args, { err: "out", pty: false });
    manageLogProc = proc;
    proc.stream(data => {
      let pre = el.querySelector('pre');
      if (!pre) { el.innerHTML = '<pre></pre>'; pre = el.querySelector('pre'); }
      pre.appendChild(document.createTextNode(data));
      el.scrollTop = el.scrollHeight;
    });
    proc.finally?.(()=>{
      if (manageLogToken !== token) return;
      const b=document.getElementById('tablogs-follow-btn');
      if(b){ b.textContent='▶️ Follow'; b.classList.remove('active'); }
    });
  }
  function stopManageLogStream(opts={}) {
    if (manageLogProc) {
      try { manageLogProc.close(); } catch(_) {}
      manageLogProc = null;
      if (!opts.keepToken) manageLogToken++;
    }
    if (!opts.skipUI) {
      const b = document.getElementById('tablogs-follow-btn');
      if (b) { b.textContent='▶️ Follow'; b.classList.remove('active'); }
    }
  }
  function loadInitialLogsInto(containerName, targetId) {
    const el = document.getElementById(targetId);
    el.innerHTML = '<div class="loading">Loading logs...</div>';
    cockpit.spawn(["docker", "logs", "--tail", "100", containerName], { err: "message" })
      .then(output => { el.innerHTML = `<pre>${escapeHtml(output)}</pre>`; el.scrollTop = el.scrollHeight; })
      .catch(error => { el.innerHTML = `<div class="error">Failed to load logs: ${escapeHtml(String(error))}</div>`; });
  }

  // ------ list rendering ------
  function roundMemUsage(mem){
    if(!mem) return 'N/A';
    const m = /^([\d.]+)\s*([A-Za-z]+)/.exec(mem); if(!m) return mem;
    const n=parseFloat(m[1]); const u=m[2].toUpperCase(); let mb;
    switch(u){case'B':mb=n/1e6;break;case'KB':mb=n/1e3;break;case'KIB':mb=n*1024/1e6;break;case'MB':mb=n;break;case'MIB':mb=n*1048576/1e6;break;case'GB':mb=n*1e3;break;case'GIB':mb=n*1073741824/1e6;break;default:mb=n}
    return `${Math.round(mb)} MB`;
  }

  function loadContainers(onDone, showLoading=false){
    if (showLoading) containerList.innerHTML = `<div class="loading">Loading containers...</div>`;
    Promise.all([
      cockpit.spawn(["docker","ps","-a","--format","{{.Names}}\t{{.Status}}\t{{.Ports}}"],{err:"message"}),
      loadContainerStats()
    ])
    .then(([out])=>{
      const lines = out.trim().split("\n");
      if (!lines.length || !lines[0]){ containerList.innerHTML = `<div class="empty">No containers found.</div>`; onDone?.(); return; }
      const sorted = sortLines(lines);
      containerList.innerHTML = sorted.map(line=>{
        const [name,statusRaw="",portsRaw=""]=line.split("\t");
        const running = statusRaw.toLowerCase().startsWith("up");
        const portsHTML = parsePorts(portsRaw);
        const stats = containerStats[name] || {};
        const pct = v => (typeof v==="string" && v.endsWith("%")) ? (Math.round(parseFloat(v))+"%") : v;
        const statsHTML = running && stats.cpu ? `
          <div class="container-stats">
            <div class="stat-item"><span class="stat-label">CPU:</span><span class="stat-value">${pct(stats.cpu)}</span></div>
            <div class="stat-item"><span class="stat-label">Memory:</span><span class="stat-value">${roundMemUsage(stats.memUsage)} (${pct(stats.memPerc)||'N/A'})</span></div>
          </div>` : '<div class="container-stats"></div>';
        return `
          <div class="container-card ${running?"":"stopped"}">
            <div class="container-info">
              <div class="container-name">${name}</div>
              <div class="container-status">${statusRaw}</div>
              ${statsHTML}
            </div>
            <div class="container-ports">${portsHTML}</div>
            <div class="container-actions">
              ${running
                ? `<button onclick="runDockerCommand('${name}','stop')">Stop</button>
                   <button onclick="runDockerCommand('${name}','restart')">Restart</button>`
                : `<button onclick="runDockerCommand('${name}','start')">Start</button>`}
              <button onclick="openManageModal('${name}')" class="cog-btn" title="Manage" aria-label="Manage">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M19.14,12.94a7.43,7.43,0,0,0,.05-.94,7.43,7.43,0,0,0-.05-.94l2.11-1.65a.5.5,0,0,0,.12-.64l-2-3.46a.5.5,0,0,0-.6-.22l-2.49,1a7.34,7.34,0,0,0-1.63-.94l-.38-2.65A.5.5,0,0,0,13.7,2H10.3a.5.5,0,0,0-.49.41L9.43,5.06a7.34,7.34,0,0,0-1.63.94l-2.49-1a.5.5,0,0,0-.6.22l-2,3.46a.5.5,0,0,0,.12.64L5,11.06a7.43,7.43,0,0,0-.05.94,7.43,7.43,0,0,0,.05.94L2.86,14.59a.5.5,0,0,0-.12.64l2,3.46a.5.5,0,0,0,.6.22l2.49,1a7.34,7.34,0,0,0,1.63.94l.38,2.65a.5.5,0,0,0,.49.41h3.4a.5.5,0,0,0,.49-.41l.38-2.65a7.34,7.34,0,0,0,1.63-.94l2.49,1a.5.5,0,0,0,.6-.22l2-3.46a.5.5,0,0,0-.12-.64ZM12,15.5A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z"/>
                </svg>
              </button>
            </div>
          </div>`;
      }).join("");
      applyFilterToDOM();
    })
    .catch(()=>{
      showError(`ERROR: Unable to access Docker!<br>
      Ensure Docker is installed and your user is in the <code>docker</code> group.<br><br>
      e.g. <code>sudo usermod -aG docker $USER</code><br>Log out/in afterwards.`);
    })
    .finally(()=>onDone?.());
  }

  function reloadContainers(done, showLoading=false){ rememberFocus(); loadContainers(()=>{ restoreRememberedFocus(); done?.(); }, showLoading); }
  function applyFilterToDOM(){ const q=(currentSearch||'').toLowerCase(); containerList.querySelectorAll('.container-card').forEach(card=>{ const name=(card.querySelector('.container-name')?.textContent||'').toLowerCase(); card.style.display = (!q||name.includes(q)) ? '' : 'none'; }); }
  function checkDockerAvailable(){ return cockpit.spawn(["docker","info"],{err:"message"}); }

  function initApp(){
    checkDockerAvailable()
      .then(()=>{ reloadContainers(undefined,true); setInterval(()=>{ if(Date.now()<pauseRefreshUntil) return; reloadContainers(undefined,false); },15000); })
      .catch(()=>{ showError(`ERROR: Unable to access Docker!<br>Ensure Docker is installed and your user is in the <code>docker</code> group.`); })
      .finally(()=>hideLoading());
  }

  refreshButton?.addEventListener("click", ()=>{
    refreshButton.disabled=true; refreshButton.textContent="Refreshing…"; refreshButton.style.opacity=.6; refreshButton.style.cursor="not-allowed";
    rememberFocus();
    loadContainers(()=>{ restoreRememberedFocus(); refreshButton.disabled=false; refreshButton.textContent="Refresh"; refreshButton.style.opacity=1; refreshButton.style.cursor="pointer"; }, true);
  });

  initApp();

  // background stats updater
  setInterval(()=>{
    if (Date.now()<pauseRefreshUntil) return;
    if (!containerList.querySelector('.container-card')) return;
    loadContainerStats().then(()=>{
      containerList.querySelectorAll('.container-card').forEach(card=>{
        const name = card.querySelector('.container-name')?.textContent; if(!name) return;
        const stats = containerStats[name]||{};
        const div = card.querySelector('.container-stats');
        const running = !card.classList.contains('stopped');
        if (!div || !running || !stats.cpu) { if (div) div.innerHTML=''; return; }
        div.innerHTML = `
          <div class="stat-item"><span class="stat-label">CPU:</span><span class="stat-value">${stats.cpu}</span></div>
          <div class="stat-item"><span class="stat-label">Memory:</span><span class="stat-value">${roundMemUsage(stats.memUsage)} (${stats.memPerc||'N/A'})</span></div>`;
      });
    });
  }, 10000);
});

// --------- Terminal Panel Controls ---------
(function(){
  const panel   = document.getElementById('terminal-panel');
  const btn     = document.getElementById('terminal-toggle-btn');
  const resizer = document.getElementById('terminal-resizer');
  const iframe  = document.getElementById('terminal-iframe');
  const docEl   = document.documentElement;

  if (!panel || !btn || !resizer || !iframe) return;

  function syncPadding(){
    const h = panel.classList.contains('open') ? panel.offsetHeight : 0;
    docEl.style.setProperty('--terminal-panel-height', `${h}px`);
  }

  btn.addEventListener('click', () => {
    panel.classList.toggle('open');
    document.body.classList.toggle('with-terminal-padding', panel.classList.contains('open'));
    syncPadding();
  });

  let dragging = false;
  resizer.addEventListener('mousedown', () => {
    dragging = true;
    document.body.style.userSelect = 'none';
    iframe.style.pointerEvents = 'none';
  });

  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const vh   = window.innerHeight;
    const newH = vh - e.clientY;
    const clamped = Math.max(vh * 0.2, Math.min(vh * 0.9, newH));
    panel.style.height = `${clamped}px`;
    syncPadding();
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    iframe.style.pointerEvents = '';
  });
})();

// ---------- shared helpers ----------
function escapeHtml(t){ const d=document.createElement('div'); d.textContent=t; return d.innerHTML; }

// Details renderer
function renderDetails(obj){
  const s = x => escapeHtml(String(x ?? ''));
  const image  = obj?.Config?.Image;
  const state  = obj?.State?.Status || obj?.State?.Health?.Status || 'unknown';
  const mounts = Array.isArray(obj?.Mounts) ? obj.Mounts : [];
  const nets   = obj?.NetworkSettings?.Networks || {};
  const ports  = obj?.NetworkSettings?.Ports || {};
  const envArr = Array.isArray(obj?.Config?.Env) ? obj.Config.Env : [];

  const mountsHtml = mounts.length
    ? mounts.map(m => `<li><code>${s(m.Source)}</code> → <code>${s(m.Destination)}</code> (${s(m.Type)})</li>`).join("")
    : '<li><em>No mounts</em></li>';

  const netsHtml = Object.keys(nets).length
    ? Object.entries(nets).map(([n,v]) => `<li><strong>${s(n)}</strong> — IP: <code>${s(v?.IPAddress||'')}</code></li>`).join("")
    : '<li><em>No networks</em></li>';

  const portsHtml = Object.keys(ports).length
    ? Object.entries(ports).map(([p,arr]) => {
        if (!arr) return `<li><code>${s(p)}</code> → <em>unpublished</em></li>`;
        const t = arr.map(x => `${s(x.HostIp||'0.0.0.0')}:${s(x.HostPort)}`).join(', ');
        return `<li><code>${s(p)}</code> → ${t}</li>`;
      }).join("")
    : '<li><em>No published ports</em></li>';

  const envHtml = envArr.length
    ? envArr.map(item => {
        const [key, ...rest] = String(item).split('=');
        const value = rest.join('=');
        return `<li><strong>${s(key)}</strong> = <code>${s(value)}</code></li>`;
      }).join("")
    : '<li><em>No environment variables</em></li>';

  return `
    <div class="logs-content" style="background:#111;">
      <div style="font-family:system-ui,sans-serif">
        <p><strong>Image:</strong> ${s(image)}</p>
        <p><strong>State:</strong> ${s(state)}</p>
        <h4>Volumes / Mounts</h4><ul>${mountsHtml}</ul>
        <h4>Networks</h4><ul>${netsHtml}</ul>
        <h4>Ports</h4><ul>${portsHtml}</ul>
        <h4>Environment</h4><ul>${envHtml}</ul>
      </div>
    </div>`;
}
