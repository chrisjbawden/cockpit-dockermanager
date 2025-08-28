document.addEventListener("DOMContentLoaded", () => {
  const containerList = document.getElementById("container-list");
  const refreshButton = document.getElementById("refresh-button");
  const actionBanner = document.getElementById("action-banner");
  const loadingOverlay = document.getElementById("loading-overlay");

  if (!containerList || typeof cockpit === "undefined") return;

  let containerStats = {};
  let logStreams = {};

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
      .then(() => loadContainers())
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

    const proc = cockpit.spawn(["docker", "logs", "-f", containerName], { 
      err: "out",  
      pty: false 
    });

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
      console.log("Log stream ended normally");
      const followBtn = document.getElementById('logs-follow-btn');
      if (followBtn) {
        followBtn.textContent = '▶️ Follow';
        followBtn.classList.remove('active');
      }
    }).catch(error => {
      console.error("Log stream error:", error);
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

  function loadContainers(onDone) {
    containerList.innerHTML = `<div class="loading">Loading containers...</div>`;

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

        const cards = lines.map(line => {
          const [name, statusRaw = "", portsRaw = ""] = line.split("\t");
          const isRunning = statusRaw.toLowerCase().startsWith("up");
          const portsHTML = parsePorts(portsRaw);
          const stats = containerStats[name] || {};

          const statsHTML = isRunning && stats.cpu ? `
            <div class="container-stats">
              <div class="stat-item">
                <span class="stat-label">CPU:</span>
                <span class="stat-value">${stats.cpu}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Memory:</span>
                <span class="stat-value">${stats.memUsage || 'N/A'}</span>
              </div>
            </div>
          ` : '';

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

  function checkDockerAvailable() {
    return cockpit.spawn(["docker", "info"], { err: "message" });
  }

  function initApp() {
    checkDockerAvailable()
      .then(() => {
        loadContainers();

        setInterval(() => loadContainers(), 30 * 1000);
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

    loadContainers(() => {
      refreshButton.disabled = false;
      refreshButton.textContent = "Refresh";
      refreshButton.style.opacity = 1;
      refreshButton.style.cursor = "pointer";
    });
  });

  initApp();
});

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

  let dragMoved = false;

  btn.addEventListener('click', (e) => {
    if (dragMoved) {
      dragMoved = false;
      return;
    }
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

  let btnDragging = false, offsetX = 0, offsetY = 0;

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  btn.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    btnDragging = true;
    dragMoved = false;
    btn.style.cursor = 'grabbing';
    btn.style.left = btn.getBoundingClientRect().left + "px";
    btn.style.top = btn.getBoundingClientRect().top + "px";
    btn.style.right = "";
    btn.style.bottom = "";
    btn.style.position = "fixed";
    offsetX = e.clientX - btn.getBoundingClientRect().left;
    offsetY = e.clientY - btn.getBoundingClientY().top;
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('mousemove', function(e) {
    if (!btnDragging) return;
    dragMoved = true;
    const btnW = btn.offsetWidth, btnH = btn.offsetHeight;
    const x = clamp(e.clientX - offsetX, 0, window.innerWidth - btnW);
    const y = clamp(e.clientY - offsetY, 0, window.innerHeight - btnH);
    btn.style.left = x + "px";
    btn.style.top = y + "px";
    btn.style.right = "";
    btn.style.bottom = "";
    btn.style.position = "fixed";
  });

  document.addEventListener('mouseup', function() {
    if (btnDragging) {
      btnDragging = false;
      btn.style.cursor = 'grab';
      setTimeout(() => { dragMoved = false; }, 100);
    }
  });

  btn.addEventListener('touchstart', function(e) {
    btnDragging = true;
    dragMoved = false;
    btn.style.cursor = 'grabbing';
    btn.style.left = btn.getBoundingClientRect().left + "px";
    btn.style.top = btn.getBoundingClientRect().top + "px";
    btn.style.right = "";
    btn.style.bottom = "";
    btn.style.position = "fixed";
    offsetX = e.touches[0].clientX - btn.getBoundingClientRect().left;
    offsetY = e.touches[0].clientY - btn.getBoundingClientRect().top;
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', function(e) {
    if (!btnDragging) return;
    dragMoved = true;
    const btnW = btn.offsetWidth, btnH = btn.offsetHeight;
    const x = clamp(e.touches[0].clientX - offsetX, 0, window.innerWidth - btnW);
    const y = clamp(e.touches[0].clientY - offsetY, 0, window.innerHeight - btnH);
    btn.style.left = x + "px";
    btn.style.top = y + "px";
    btn.style.right = "";
    btn.style.bottom = "";
    btn.style.position = "fixed";
  }, { passive: false });

  document.addEventListener('touchend', function() {
    if (btnDragging) {
      btnDragging = false;
      btn.style.cursor = 'grab';
      setTimeout(() => { dragMoved = false; }, 100);
    }
  });
})();
