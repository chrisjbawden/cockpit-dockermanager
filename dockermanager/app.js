document.addEventListener("DOMContentLoaded", () => {
  const containerList = document.getElementById("container-list");
  const refreshButton = document.getElementById("refresh-button");
  const sortSelect = document.getElementById("sort-select");
  const searchControl = document.getElementById("search-control");
  const searchToggle = document.getElementById("search-toggle");
  const searchInput = document.getElementById("search-input");
  const actionBanner = document.getElementById("action-banner");
  const loadingOverlay = document.getElementById("loading-overlay");

  if (!containerList || typeof cockpit === "undefined") return;

  let containerStats = {};
  let logStreams = {};
  let currentSort = (typeof localStorage !== 'undefined' && localStorage.getItem('sortBy')) || 'name';
  let currentSearch = (typeof localStorage !== 'undefined' && localStorage.getItem('searchQuery')) || '';
  let pauseRefreshUntil = 0; // pause auto-refresh while typing

  // Track and restore focus around refresh to prevent input from disengaging
  let rememberedFocus = null;
  function rememberFocus() {
    try {
      if (document.activeElement === searchInput) {
        rememberedFocus = {
          isSearch: true,
          pos: typeof searchInput.selectionStart === 'number'
            ? searchInput.selectionStart
            : (searchInput.value || '').length
        };
      } else {
        rememberedFocus = null;
      }
    } catch (_) { rememberedFocus = null; }
  }

  function restoreRememberedFocus() {
    try {
      if (rememberedFocus?.isSearch && searchControl?.classList.contains('open')) {
        const pos = Math.max(0, Math.min((searchInput.value || '').length, rememberedFocus.pos || 0));
        searchInput.focus({ preventScroll: true });
        try { searchInput.setSelectionRange(pos, pos); } catch(_){}
      }
    } finally {
      rememberedFocus = null;
    }
  }

  if (sortSelect) {
    try {
      const nameOpt = Array.from(sortSelect.options || []).find(o => o.value === 'name');
      if (nameOpt) nameOpt.textContent = 'Name (A-Z)';
    } catch (_) {}
    try { sortSelect.value = currentSort; } catch (_) {}
    sortSelect.addEventListener('change', () => {
      currentSort = sortSelect.value;
      try { localStorage.setItem('sortBy', currentSort); } catch (_) {}
      rememberFocus();
      reloadContainers(() => {
        restoreRememberedFocus();
      }, true);
    });
  }

  // --- PIN HEADER TOGGLE ---
  const header = document.getElementById("app-header");
  const pinBtn = document.getElementById("pin-btn");
  const spacer = document.getElementById("header-spacer");

  if (header && pinBtn && spacer) {
    function applyPinnedState(isPinned, persist = true) {
      if (isPinned) {
        header.classList.add("pinned");
        spacer.style.height = `${header.offsetHeight}px`; // reserve space
        pinBtn.classList.add("is-pinned");
      } else {
        header.classList.remove("pinned");
        spacer.style.height = "0";
        pinBtn.classList.remove("is-pinned");
      }
      if (persist) localStorage.setItem("headerPinned", String(isPinned));
    }

    // Load saved preference
    const savedPinned = localStorage.getItem("headerPinned") === "true";
    applyPinnedState(savedPinned, false);

    // Toggle on click
    pinBtn.addEventListener("click", () => {
      applyPinnedState(!header.classList.contains("pinned"));
    });

    // Adjust spacer if window resizes
    window.addEventListener("resize", () => {
      if (header.classList.contains("pinned")) {
        spacer.style.height = `${header.offsetHeight}px`;
      }
    });
  }

  // Image modal trigger
  const imageToggleBtn = document.getElementById("image-toggle-btn");
  imageToggleBtn?.addEventListener("click", () => {
    showImagesModal();
  });

  // ------- Images Modal -------
  function showImagesModal() {
    let modal = document.getElementById("images-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "images-modal";
      modal.className = "logs-modal"; // reuse logs modal styles

      modal.innerHTML = `
        <div class="logs-modal-content">
          <div class="logs-modal-header">
            <h3>Docker Images</h3>
            <div class="logs-controls">
              <button id="images-refresh-btn" class="logs-btn">↻ Refresh</button>
              <button id="images-prune-btn" class="logs-btn">🧹 Prune Dangling</button>
              <button id="images-close-btn" class="logs-btn">✖️ Close</button>
            </div>
          </div>
          <div id="images-content" class="logs-content">
            <div class="loading">Loading images…</div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      // Wire modal controls
      document.getElementById("images-close-btn").addEventListener("click", () => {
        modal.style.display = "none";
      });

      document.getElementById("images-refresh-btn").addEventListener("click", () => {
        loadImagesList();
      });

      const pruneBtn = document.getElementById("images-prune-btn");
      pruneBtn.addEventListener("click", () => {
        const content = document.getElementById("images-content");

        // Busy state
        pruneBtn.disabled = true;
        pruneBtn.classList.add("loading");
        const oldLabel = pruneBtn.textContent;
        pruneBtn.textContent = "Pruning…";

        // Optional: show status inside modal
        const prevHTML = content.innerHTML;
        content.innerHTML = `<div class="loading">Pruning dangling images…</div>`;

        cockpit.spawn(["docker", "image", "prune", "-f"], { err: "message" })
          .then(() => loadImagesList())
          .catch(err => {
            showBanner(`❌ Prune failed: ${escapeHtml(String(err))}`);
            content.innerHTML = prevHTML; // restore list if failed
          })
          .finally(() => {
            pruneBtn.disabled = false;
            pruneBtn.classList.remove("loading");
            pruneBtn.textContent = oldLabel;
          });
      });


      // Click outside to close
      modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.style.display = "none";
      });
    }

    modal.style.display = "block";
    loadImagesList();
  }

  function loadImagesList() {
    const content = document.getElementById("images-content");
    if (!content) return;
    content.innerHTML = `<div class="loading">Loading images…</div>`;

    // Repo:Tag, ID, Size, CreatedSince
    const fmt = "{{.Repository}}:{{.Tag}}\\t{{.ID}}\\t{{.Size}}\\t{{.CreatedSince}}";
    cockpit.spawn(["docker", "images", "--format", fmt], { err: "message" })
      .then(output => {
        const lines = output.trim() ? output.trim().split("\n") : [];
        if (lines.length === 0) {
          content.innerHTML = `<div class="empty">No Docker images found.</div>`;
          return;
        }

        // Build list
        const rows = lines.map(line => {
          const [repoTag, id, size, age] = line.split("\t");
          const displayName = (repoTag && repoTag !== "<none>:<none>") ? repoTag : "(dangling)";
          const shortId = id?.replace(/^sha256:/, "").slice(0, 12) || "unknown";

          return `
            <div class="image-row">
              <div class="image-meta">
                <span class="image-name">${escapeHtml(displayName)}</span>
                <span class="image-id">ID: ${escapeHtml(shortId)}</span>
                <span class="image-size">Size: ${escapeHtml(size || "n/a")}</span>
                <span class="image-age">Created: ${escapeHtml(age || "n/a")}</span>
              </div>
              <div class="image-actions">
                <button class="logs-btn image-danger" data-image-id="${id}">🗑️ Delete</button>
              </div>
            </div>
          `;
        }).join("");

        content.innerHTML = `<div class="images-list">${rows}</div>`;

        // Wire delete buttons
        content.querySelectorAll('[data-image-id]').forEach(btn => {
          btn.addEventListener("click", () => {
            const imageId = btn.getAttribute("data-image-id");
            if (!imageId) return;
            deleteImage(imageId, btn);
          });
        });
      })
      .catch(err => {
        content.innerHTML = `<div class="error">Failed to load images: ${escapeHtml(String(err))}</div>`;
      });
  }

  function deleteImage(imageId, buttonEl) {
    const shortId = imageId.replace(/^sha256:/, "").slice(0, 12);

    const originalText = buttonEl.textContent;
    buttonEl.disabled = true;
    buttonEl.textContent = "Deleting…";

    cockpit.spawn(["docker", "rmi", imageId], { err: "message" })
      .then(() => {
        showBanner(`🗑️ Deleted image ${shortId}`);
        loadImagesList();
      })
      .catch(err => {
        showBanner(`❌ Delete failed: ${escapeHtml(String(err))}`);
        buttonEl.disabled = false;
        buttonEl.textContent = originalText;
      });
  }


  // Initialize search UI
  if (searchControl && searchToggle && searchInput) {
    // Restore saved query; open when there is a query
    if ((currentSearch || '').length > 0) {
      searchInput.value = currentSearch;
      searchControl.classList.add('open');
      setTimeout(applyFilterToDOM, 0);
    }

    // Toggle open/close when clicking the magnifier
    searchToggle.addEventListener('click', () => {
      const isOpen = searchControl.classList.toggle('open');
      if (isOpen) {
        requestAnimationFrame(() => { searchInput.focus(); searchInput.select(); });
      } else {
        // Clear query when hiding
        searchInput.value = '';
        currentSearch = '';
        try { localStorage.setItem('searchQuery', ''); } catch(_){}
        applyFilterToDOM();
      }
    });

    let searchDebounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        currentSearch = (searchInput.value || '').trim().toLowerCase();
        try { localStorage.setItem('searchQuery', searchInput.value || ''); } catch(_){}
        applyFilterToDOM();
        // Briefly pause auto-refresh while typing
        pauseRefreshUntil = Date.now() + 1500;
        // In case anything steals focus, restore it
        const el = searchInput;
        setTimeout(() => {
          if (searchControl.classList.contains('open') && document.activeElement !== el) {
            const pos = el.value.length;
            el.focus({ preventScroll: true });
            try { el.setSelectionRange(pos, pos); } catch(_){}
          }
        }, 0);
      }, 1000); // 250ms debounce; adjust as needed
    });

    // Prevent global handlers from hijacking keystrokes
    ['keydown','keypress','keyup'].forEach(evt => {
      searchInput.addEventListener(evt, e => {
        e.stopPropagation();
      });
    });

    // Esc clears query but keeps input open
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        currentSearch = '';
        try { localStorage.setItem('searchQuery', ''); } catch(_){}
        applyFilterToDOM();
      }
    });
  }

  function showBanner(message) {
    if (!actionBanner) return;
    actionBanner.textContent = message;
    actionBanner.style.display = "block";
    setTimeout(() => {
      actionBanner.style.display = "none";
    }, 5000);
  }

  function hideLoading() {
    if (loadingOverlay) {
      loadingOverlay.style.display = "none";
    }
  }

  function showError(message) {
    containerList.innerHTML = `<div class="error">${message}</div>`;
  }

  function runDockerCommand(container, action) {
    showBanner(`${action.charAt(0).toUpperCase() + action.slice(1)}ing ${container}...`);
    cockpit.spawn(["docker", action, container], { err: "message" })
      .then(() => reloadContainers())
      .catch(() => showBanner(`❌ Failed to ${action} ${container}`));
  }

  window.runDockerCommand = runDockerCommand;

  function parsePorts(portText) {
    if (!portText) return "";
    const hostname = window.location.hostname;
    const seen = new Set();
    const matches = portText.match(/(?:[0-9.:\\[\\]]+)?:(\d+)->/g);
    if (!matches) return "";
    return matches.map(m => {
      const portMatch = m.match(/:(\d+)->/);
      if (!portMatch) return null;
      const hostPort = portMatch[1];
      if (seen.has(hostPort)) return null;
      seen.add(hostPort);
      return `<a href="http://${hostname}:${hostPort}" target="_blank">${hostPort}</a>`;
    }).filter(Boolean).join(" ");
  }

  function parseUptimeSeconds(statusRaw) {
    if (!statusRaw) return -1;
    const s = statusRaw.toLowerCase();
    if (!s.startsWith('up')) return -1; // treat only running containers as having uptime

    const units = {
      second: 1,
      minute: 60,
      hour: 3600,
      day: 86400,
      week: 604800,
      month: 2628000,   // approx
      year: 31536000
    };

    const m = s.match(/(\d+)\s*(second|minute|hour|day|week|month|year)/);
    if (m) {
      const n = parseInt(m[1], 10);
      const unit = m[2];
      return (Number.isFinite(n) ? n : 0) * (units[unit] || 1);
    }

    if (s.includes('about an hour') || s.includes('an hour')) return 3600;
    if (s.includes('a minute')) return 60;
    if (s.includes('a day')) return 86400;
    if (s.includes('a week')) return 604800;
    return 0;
  }

  function sortLines(lines) {
    try {
      const rows = lines
        .filter(l => !!l)
        .map(l => {
          const [name, statusRaw = "", portsRaw = ""] = l.split("\t");
          return {
            name,
            statusRaw,
            portsRaw,
            uptimeSeconds: parseUptimeSeconds(statusRaw),
            raw: l
          };
        });

      if ((currentSort || 'name') === 'name') {
        rows.sort((a, b) => a.name.localeCompare(b.name));
      } else if (currentSort === 'uptime') {
        rows.sort((a, b) => (b.uptimeSeconds - a.uptimeSeconds));
      }

      return rows.map(r => r.raw);
    } catch (_) {
      return lines;
    }
  }

  function loadContainerStats() {
    return cockpit.spawn(["docker", "ps", "-a", "--format", "{{.ID}}\t{{.Names}}"], { err: "message" })
      .then(output => {
        const idToName = {};
        const lines = output.trim().split("\n");
        lines.forEach(line => {
          if (!line) return;
          const [id, name] = line.split("\t");
          if (id && name) {
            idToName[id] = name;
            idToName[id.substring(0, 12)] = name;
          }
        });

        return cockpit.spawn(["docker", "stats", "--no-stream", "--format", "{{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"], { err: "message" })
          .then(statsOutput => {
            containerStats = {};
            const statsLines = statsOutput.trim().split("\n");
            statsLines.forEach(line => {
              if (!line) return;
              const [containerId, cpu, memUsage, memPerc] = line.split("\t");
              if (containerId && cpu) {
                const containerName = idToName[containerId];
                if (containerName) {
                  const memoryUsed = memUsage.split(' / ')[0];
                  containerStats[containerName] = {
                    cpu: cpu,
                    memUsage: memoryUsed,
                    memPerc: memPerc
                  };
                }
              }
            });
          });
      })
      .catch(() => {
        containerStats = {};
      });
  }

  function showLogs(containerName) {
    let modal = document.getElementById('logs-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'logs-modal';
      modal.className = 'logs-modal';
      modal.innerHTML = `
        <div class="logs-modal-content">
          <div class="logs-modal-header">
            <h3>Logs: <span id="logs-container-name"></span></h3>
            <div class="logs-controls">
              <button id="logs-follow-btn" class="logs-btn active">⏸️ Stop</button>
              <button id="logs-clear-btn" class="logs-btn">🗑️ Clear</button>
              <button id="logs-close-btn" class="logs-btn">✖️ Close</button>
            </div>
          </div>
          <div id="logs-content" class="logs-content"></div>
        </div>
      `;
      document.body.appendChild(modal);

      document.getElementById('logs-close-btn').addEventListener('click', () => {
        modal.style.display = 'none';
        stopLogStream();
      });

      document.getElementById('logs-clear-btn').addEventListener('click', () => {
        document.getElementById('logs-content').textContent = '';
      });

      document.getElementById('logs-follow-btn').addEventListener('click', () => {
        const btn = document.getElementById('logs-follow-btn');
        const isFollowing = btn.textContent.includes('⏸️');

        if (isFollowing) {
          stopLogStream();
          btn.textContent = '▶️ Follow';
          btn.classList.remove('active');
        } else {
          startLogStream(containerName);
          btn.textContent = '⏸️ Stop';
          btn.classList.add('active');
        }
      });

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.style.display = 'none';
          stopLogStream();
        }
      });
    }

    document.getElementById('logs-container-name').textContent = containerName;
    modal.style.display = 'block';

    const followBtn = document.getElementById('logs-follow-btn');
    followBtn.textContent = '⏸️ Stop';
    followBtn.classList.add('active');

    loadInitialLogs(containerName);
    setTimeout(() => startLogStream(containerName), 1000); 
  }

  function loadInitialLogs(containerName) {
    const logsContent = document.getElementById('logs-content');
    logsContent.innerHTML = '<div class="loading">Loading logs...</div>';

    cockpit.spawn(["docker", "logs", "--tail", "100", containerName], { err: "message" })
      .then(output => {
        logsContent.innerHTML = `<pre>${escapeHtml(output)}</pre>`;
        logsContent.scrollTop = logsContent.scrollHeight;
      })
      .catch(error => {
        logsContent.innerHTML = `<div class="error">Failed to load logs: ${error}</div>`;
      });
  }

  function startLogStream(containerName) {
    stopLogStream(); 
    const logsContent = document.getElementById('logs-content');
    const proc = cockpit.spawn(["docker", "logs", "-f", containerName], { err: "out", pty: false });
    logStreams[containerName] = proc;

    proc.stream(data => {
      const pre = logsContent.querySelector('pre');
      if (pre) {
        const newTextNode = document.createTextNode(data);
        pre.appendChild(newTextNode);
        logsContent.scrollTop = logsContent.scrollHeight;
      }
    });

    proc.then(() => {
      const followBtn = document.getElementById('logs-follow-btn');
      if (followBtn) {
        followBtn.textContent = '▶️ Follow';
        followBtn.classList.remove('active');
      }
    }).catch(error => {
      const followBtn = document.getElementById('logs-follow-btn');
      if (followBtn) {
        followBtn.textContent = '▶️ Follow';
        followBtn.classList.remove('active');
      }
      const pre = logsContent.querySelector('pre');
      if (pre) {
        const errorText = document.createTextNode(`\n\n[ERROR: Log streaming failed - ${error}]\n`);
        pre.appendChild(errorText);
      }
    });
  }

  function stopLogStream() {
    Object.keys(logStreams).forEach(containerName => {
      if (logStreams[containerName]) {
        logStreams[containerName].close();
        delete logStreams[containerName];
      }
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  window.showLogs = showLogs;

  function roundMemUsage(memUsage) {
    if (!memUsage) return 'N/A';
    // Matches "13.4MiB", "782.5KiB", "123MB", etc.
    const match = /^([\d.]+)\s*([A-Za-z]+)/.exec(memUsage);
    if (!match) return memUsage;
    const num = parseFloat(match[1]);
    const unit = match[2].toUpperCase();

    let mb;
    switch (unit) {
      case 'B':
        mb = num / 1000000;
        break;
      case 'KB':
        mb = num / 1000;
        break;
      case 'KIB':
        mb = num * 1024 / 1000000;
        break;
      case 'MB':
        mb = num;
        break;
      case 'MIB':
        mb = num * 1048576 / 1000000;
        break;
      case 'GB':
        mb = num * 1000;
        break;
      case 'GIB':
        mb = num * 1073741824 / 1000000;
        break;
      default:
        mb = num;
    }
    return `${Math.round(mb)} MB`;
  }

  // loadContainers with showLoading flag (default false)
  function loadContainers(onDone, showLoading = false) {
    if (showLoading) {
      containerList.innerHTML = `<div class="loading">Loading containers...</div>`;
    }

    Promise.all([
      cockpit.spawn(["docker", "ps", "-a", "--format", "{{.Names}}\t{{.Status}}\t{{.Ports}}"], { err: "message" }),
      loadContainerStats()
    ])
      .then(([output]) => {
        const lines = output.trim().split("\n");
        if (!lines.length || !lines[0]) {
          containerList.innerHTML = `<div class="empty">No containers found.</div>`;
          onDone?.();
          return;
        }

        const sortedLines = sortLines(lines);

        const cards = sortedLines.map(line => {
          const [name, statusRaw = "", portsRaw = ""] = line.split("\t");
          const isRunning = statusRaw.toLowerCase().startsWith("up");
          const portsHTML = parsePorts(portsRaw);
          const stats = containerStats[name] || {};

          const roundStatPercent = v =>
            (typeof v === "string" && v.endsWith("%"))
              ? (Math.round(parseFloat(v)) + "%")
              : v;

          const statsHTML = isRunning && stats.cpu ? `
            <div class="container-stats">
              <div class="stat-item">
                <span class="stat-label">CPU:</span>
                <span class="stat-value">${roundStatPercent(stats.cpu)}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Memory:</span>
                <span class="stat-value">${roundMemUsage(stats.memUsage)} (${roundStatPercent(stats.memPerc) || 'N/A'})</span>
              </div>
            </div>
          ` : '<div class="container-stats"></div>';

          return `
            <div class="container-card ${isRunning ? "" : "stopped"}">
              <div class="container-info">
                <div class="container-name">${name}</div>
                <div class="container-status">${statusRaw}</div>
                ${statsHTML}
              </div>
              <div class="container-ports">${portsHTML}</div>
              <div class="container-actions">
                ${isRunning
                  ? `<button onclick="runDockerCommand('${name}', 'stop')">Stop</button>
                     <button onclick="runDockerCommand('${name}', 'restart')">Restart</button>`
                  : `<button onclick="runDockerCommand('${name}', 'start')">Start</button>`}
                <button onclick="showLogs('${name}')" class="logs-button">📋 Logs</button>
              </div>
            </div>
          `;
        });

        containerList.innerHTML = cards.join("");
        applyFilterToDOM();
      })
      .catch(() => {
        showError(`ERROR: Unable to access Docker!<br>
        Please ensure Docker is installed and that this user belongs to the <code>docker</code> group. <br>
        <br>
        ie; sudo usermod -aG docker $USER<br>
        Note: Remember to log out and back in after`);
      })
      .finally(() => {
        onDone?.();
      });
  }

  // reloadContainers with showLoading flag (default false)
  function reloadContainers(done, showLoading = false) {
    rememberFocus();
    loadContainers(() => {
      restoreRememberedFocus();
      done?.();
    }, showLoading);
  }

  function applyFilterToDOM() {
    const q = (currentSearch || '').toLowerCase();
    const cards = containerList.querySelectorAll('.container-card');
    if (!cards || cards.length === 0) return;
    cards.forEach(card => {
      const nameEl = card.querySelector('.container-name');
      const name = (nameEl?.textContent || '').toLowerCase();
      const show = !q || name.includes(q);
      card.style.display = show ? '' : 'none';
    });
  }

  function checkDockerAvailable() {
    return cockpit.spawn(["docker", "info"], { err: "message" });
  }

  function initApp() {
    checkDockerAvailable()
      .then(() => {
        // Initial load, show loading
        reloadContainers(undefined, true);

        setInterval(() => {
          if (Date.now() < pauseRefreshUntil) return; // skip while typing
          // Auto-refresh (no loading message)
          reloadContainers(undefined, false);
        }, 15 * 1000);
      })
      .catch(() => {
        showError(`ERROR: Unable to access Docker!<br>
        Please ensure Docker is installed and that this user belongs to the <code>docker</code> group. <br>
        <br>
        ie; sudo usermod -aG docker $USER<br>
        Note: Remember to log out and back in after`);
      })
      .finally(() => {
        hideLoading();
      });
  }

  refreshButton?.addEventListener("click", () => {
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing...";
    refreshButton.style.opacity = 0.6;
    refreshButton.style.cursor = "not-allowed";

    rememberFocus();
    // Manual refresh, show loading
    loadContainers(() => {
      restoreRememberedFocus();
      refreshButton.disabled = false;
      refreshButton.textContent = "Refresh";
      refreshButton.style.opacity = 1;
      refreshButton.style.cursor = "pointer";
    }, true);
  });

  initApp();

  // --- BACKGROUND STATS UPDATER (non-disruptive) ---
  setInterval(() => {
    if (Date.now() < pauseRefreshUntil) return;
    if (!containerList || !containerList.querySelector('.container-card')) return;

    loadContainerStats().then(() => {
      const cards = containerList.querySelectorAll('.container-card');
      cards.forEach(card => {
        const name = card.querySelector('.container-name')?.textContent;
        if (!name) return;
        const stats = containerStats[name] || {};
        const statDiv = card.querySelector('.container-stats');
        const isRunning = card.classList.contains('stopped') ? false : true;

        if (!statDiv || !isRunning || !stats.cpu) {
          if (statDiv) statDiv.innerHTML = '';
          return;
        }

        statDiv.innerHTML = `
          <div class="stat-item">
            <span class="stat-label">CPU:</span>
            <span class="stat-value">${stats.cpu}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Memory:</span>
            <span class="stat-value">${roundMemUsage(stats.memUsage)} (${stats.memPerc || 'N/A'})</span>
          </div>
        `;
      });
    });
  }, 10000); // every 10 seconds

});

// --------- Terminal Panel Controls (unchanged) --------
(function(){
  const panel   = document.getElementById('terminal-panel');
  const btn     = document.getElementById('terminal-toggle-btn');
  const resizer = document.getElementById('terminal-resizer');
  const iframe  = document.getElementById('terminal-iframe');
  const docEl   = document.documentElement;

  function syncPadding(){
    const h = panel.classList.contains('open') ? panel.offsetHeight : 0;
    docEl.style.setProperty('--terminal-panel-height', h + 'px');
  }

  btn.addEventListener('click', () => {
    panel.classList.toggle('open');
    document.body.classList.toggle('with-terminal-padding',
                                    panel.classList.contains('open'));
    syncPadding();
  });

  let dragging=false;
  resizer.addEventListener('mousedown', () => {
    dragging=true;
    document.body.style.userSelect='none';
    iframe.style.pointerEvents='none';
  });

  window.addEventListener('mousemove', e => {
    if(!dragging) return;
    const vh       = window.innerHeight;
    const newH     = vh - e.clientY;
    const clampedH = Math.max(vh*0.2, Math.min(vh*0.9, newH));
    panel.style.height = clampedH + 'px';
    syncPadding();
  });

  window.addEventListener('mouseup', () => {
    if(dragging){
      dragging=false;
      document.body.style.userSelect='';
      iframe.style.pointerEvents='';
    }
  });

})();
