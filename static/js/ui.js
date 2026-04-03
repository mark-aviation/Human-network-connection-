/**
 * THE HUMAN NETWORK — ui.js
 * Modal management, panel states, DOM event listeners
 * 
 * Manages:
 *   - Profile panel (side drawer)
 *   - Add person, edit person, connect people modals
 *   - Edit relationship modal
 *   - Event timeline modal
 *   - Context menu
 *   - Panel tabs
 *   - Search + filtering
 */

const HNUi = (() => {
  "use strict";

  // ── Current state ────────────────────────
  let currentPanelNode = null;
  let currentContextNode = null;
  let currentConnFromNode = null;
  let currentConnToNode = null;

  // ── DOM elements ─────────────────────────
  const panel = document.getElementById("profile-panel");
  const panelClose = document.getElementById("panel-close");
  const canvas = document.getElementById("graph-canvas");

  const addPersonBtn = document.getElementById("add-person-btn");
  const addModal = document.getElementById("add-modal");
  const addForm = document.getElementById("add-form");
  const addCancel = document.getElementById("add-cancel");
  const fileInput = document.getElementById("file-input");
  const uploadPrev = document.getElementById("upload-prev");
  const uploadPh = document.getElementById("upload-ph");
  const coSelect = document.getElementById("co-select");

  const editModal = document.getElementById("edit-modal");
  const editForm = document.getElementById("edit-form");
  const editCancel = document.getElementById("edit-cancel");

  const connectModal = document.getElementById("connect-modal");
  const connSearch = document.getElementById("conn-search");
  const connResults = document.getElementById("conn-search-results");
  const connCancel = document.getElementById("conn-cancel");

  const editConnModal = document.getElementById("edit-conn-modal");
  const editConnForm = document.getElementById("edit-conn-form");
  const editConnCancel = document.getElementById("edit-conn-cancel");

  const eventModal = document.getElementById("event-modal");
  const eventForm = document.getElementById("event-form");
  const eventCancel = document.getElementById("event-cancel");

  const ctxMenu = document.getElementById("ctx-menu");

  const searchInput = document.getElementById("search-input");

  // ── Panel Management ────────────────────
  function openPanel() {
    panel.classList.add("open");
    panel.removeAttribute("aria-hidden");
    canvas.classList.add("panel-open");
  }

  function closePanel() {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    canvas.classList.remove("panel-open");
  }

  /**
   * Fill profile panel with employee data
   */
  function fillPanel(employee) {
    currentPanelNode = employee;

    // Basic info
    document.getElementById("p-name").textContent = employee.name;
    document.getElementById("p-title").textContent = employee.title;
    document.getElementById("p-persona").textContent = employee.persona || "No persona yet.";
    document.getElementById("ini-text").textContent = HN.initials(employee.name);

    // Avatar
    const img = document.getElementById("profile-pic");
    const ini = document.getElementById("av-ini");
    if (employee.image) {
      img.src = employee.image;
      img.style.display = "block";
      ini.style.display = "none";
    } else {
      img.style.display = "none";
      ini.style.display = "flex";
    }

    // Company badge
    const badge = document.getElementById("p-co-badge");
    const orgBtn = document.getElementById("org-btn");
    if (employee.company_id && window.G) {
      const co = window.G.companies.find(c => c.id === employee.company_id);
      if (co) {
        badge.style.cssText = `display:inline-flex;border-color:${co.color.stroke};color:${co.color.label};background:${co.color.fill};`;
        document.getElementById("p-co-name").textContent = co.name;
        badge.onclick = () => HNNetwork.openOrgChart(co.id);
        if (orgBtn) orgBtn.style.display = "flex";
        if (orgBtn) orgBtn.onclick = () => HNNetwork.openOrgChart(co.id);
      }
    } else {
      badge.style.display = "none";
      if (orgBtn) orgBtn.style.display = "none";
    }

    // Hobbies
    const hc = document.getElementById("p-hobbies");
    if (hc) {
      hc.innerHTML =
        (employee.hobbies || [])
          .map(h => `<span class="hobby-chip">${h}</span>`)
          .join("") ||
        `<p style="font-size:var(--text-sm);color:var(--text-muted)">None listed.</p>`;
    }

    // Tags
    const tc = document.getElementById("p-tags");
    const tw = document.getElementById("p-tags-wrap");
    if (tc && tw) {
      if (employee.tags && employee.tags.length) {
        tc.innerHTML = employee.tags
          .map(
            t =>
              `<span class="hobby-chip" style="background:var(--primary-muted);border-color:var(--primary-border);color:var(--primary)">#${t}</span>`
          )
          .join("");
        tw.style.display = "block";
      } else {
        tw.style.display = "none";
      }
    }

    // Notes
    const notesArea = document.getElementById("p-notes");
    if (notesArea) {
      notesArea.value = employee.notes || "";
      const saveNotesBtn = document.getElementById("save-notes-btn");
      if (saveNotesBtn) {
        saveNotesBtn.onclick = async () => {
          try {
            await HNApi.updateEmployee(employee.id, { notes: notesArea.value });
            HN.toast("Notes saved");
            const node = window.G.nodes.find(n => n.id === employee.id);
            if (node) node.notes = notesArea.value;
          } catch (e) {
            HN.toast("Could not save notes");
          }
        };
      }
    }

    // Relationships
    fillRelationships(employee);

    // Timeline
    loadTimelineUI(employee.id);

    // Wire buttons
    const panelConnectBtn = document.getElementById("panel-connect-btn");
    if (panelConnectBtn) {
      panelConnectBtn.onclick = () => openConnectModal(employee);
    }

    const panelEditBtn = document.getElementById("panel-edit-btn");
    if (panelEditBtn) {
      panelEditBtn.onclick = () => openEditModal(employee);
    }

    const msgBtn = document.getElementById("msg-btn");
    if (msgBtn) {
      msgBtn.onclick = () =>
        employee.email
          ? (window.location.href = `mailto:${employee.email}`)
          : HN.toast("No email on record.");
    }

    switchTab("overview");
    openPanel();
  }

  /**
   * Fill relationship list in panel
   */
  function fillRelationships(employee) {
    if (!window.G) return;
    const rl = document.getElementById("p-rels");
    const allEdges = [
      ...window.G.edges.formal.map(e => ({ ...e, type: "formal" })),
      ...window.G.edges.informal.map(e => ({ ...e, type: "informal" })),
      ...window.G.edges.cross_company.map(e => ({ ...e, type: "cross_company" })),
    ];

    const conn = allEdges
      .filter(e => e.source === employee.id || e.target === employee.id)
      .map(e => {
        const oid = e.source === employee.id ? e.target : e.source;
        const o = window.G.nodes.find(n => n.id === oid);
        return o ? { ...e, other: o } : null;
      })
      .filter(Boolean);

    rl.innerHTML = conn.length
      ? ""
      : `<p style="font-size:var(--text-sm);color:var(--text-muted)">No connections yet.</p>`;

    conn.forEach(r => {
      const co = r.other.company_id ? window.G.companies.find(c => c.id === r.other.company_id) : null;
      const div = document.createElement("div");
      div.className = "rel-item";
      const displayLabel =
        r.source === employee.id ? r.label || r.type.replace("_", " ") : r.reverse_label || r.label || r.type.replace("_", " ");
      const strengthPct = Math.round((r.strength || 1.0) * 100);
      const strengthColor = r.type === "formal" ? "#7e7385" : r.type === "informal" ? "#006b5f" : "#b49632";
      const dateStr = r.started_date ? ` · Since ${r.started_date.slice(0, 7)}` : "";

      div.innerHTML = `
        <span class="rel-dot ${r.type}"></span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:var(--text-sm);color:var(--text-primary)">${r.other.name}</div>
          <div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:1px">${displayLabel} · ${r.type.replace("_", " ")}${co ? ` · ${co.name}` : ""}${dateStr}</div>
          <div style="height:3px;background:var(--surface-mid);border-radius:2px;margin-top:4px;overflow:hidden">
            <div style="height:100%;width:${strengthPct}%;background:${strengthColor};border-radius:2px"></div>
          </div>
        </div>
        <div style="display:flex;gap:4px;margin-left:var(--sp-2);flex-shrink:0">
          <button class="del-conn" data-action="edit" title="Edit" style="color:var(--secondary)">
            <span class="material-symbols-outlined" style="font-size:15px">edit</span>
          </button>
          <button class="del-conn" data-action="delete" title="Remove">
            <span class="material-symbols-outlined" style="font-size:15px">link_off</span>
          </button>
        </div>`;

      div.addEventListener("click", e => {
        if (e.target.closest(".del-conn")) return;
        const n = window.G.nodes.find(x => x.id === r.other.id);
        if (n) fillPanel({ ...n });
      });

      div.querySelector('[data-action="edit"]').addEventListener("click", e => {
        e.stopPropagation();
        openEditConnModal(r, employee);
      });

      div.querySelector('[data-action="delete"]').addEventListener("click", async e => {
        e.stopPropagation();
        if (!confirm(`Remove connection between ${employee.name} and ${r.other.name}?`)) return;
        try {
          await HNApi.deleteRelationship(r.id);
          HN.toast("Connection removed");
          window.G = await HNApi.loadGraph();
          if (window._hnSim) window._hnSim.stop();
          HNNetwork.render(window.G);
          fillPanel({ ...employee });
        } catch (err) {
          HN.toast(err.message);
        }
      });

      rl.appendChild(div);
    });
  }

  // ── Tab Management ─────────────────────
  function switchTab(tabId) {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tabId));
    ["overview", "network", "timeline", "notes", "hobbies"].forEach(t => {
      const el = document.getElementById(`tab-${t}`);
      if (el) el.style.display = t === tabId ? "block" : "none";
    });
  }

  // ── Timeline UI ─────────────────────────
  async function loadTimelineUI(empId) {
    const container = document.getElementById("p-timeline");
    if (!container) return;

    container.innerHTML = `<p style="font-size:var(--text-sm);color:var(--text-muted)">Loading…</p>`;
    try {
      const events = await HNApi.loadTimeline(empId);
      if (!events.length) {
        container.innerHTML = `<p style="font-size:var(--text-sm);color:var(--text-muted)">No events yet. Add the first one.</p>`;
        return;
      }

      const iconMap = {
        joined: "domain",
        left: "logout",
        promotion: "trending_up",
        connected: "add_link",
        achievement: "emoji_events",
        meeting: "calendar_today",
        intel: "search",
        note: "sticky_note_2",
      };

      const colorMap = {
        joined: "var(--secondary)",
        left: "var(--tertiary)",
        promotion: "var(--primary)",
        connected: "var(--secondary)",
        achievement: "#b49632",
        meeting: "var(--text-muted)",
        intel: "var(--tertiary)",
        note: "var(--text-muted)",
      };

      container.innerHTML = events
        .map(ev => {
          const icon = iconMap[ev.event_type] || "circle";
          const color = colorMap[ev.event_type] || "var(--text-muted)";
          const date = ev.occurred_at
            ? new Date(ev.occurred_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
            : "";

          return `
          <div style="display:flex;gap:var(--sp-3);padding:var(--sp-3) 0;border-bottom:1px solid var(--outline-variant);position:relative">
            <div style="width:28px;height:28px;border-radius:9999px;background:var(--surface-mid);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px">
              <span class="material-symbols-outlined" style="font-size:14px;color:${color}">${icon}</span>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:var(--text-sm);color:var(--text-primary);line-height:1.4">${ev.description}</div>
              <div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:2px">${date}</div>
            </div>
            <button onclick="HNUi.deleteEventUI(${ev.id},${empId})" style="border:none;background:none;cursor:pointer;color:var(--text-muted);opacity:0;transition:opacity 150ms;padding:4px;flex-shrink:0" class="ev-del-btn">
              <span class="material-symbols-outlined" style="font-size:14px">close</span>
            </button>
          </div>`;
        })
        .join("");

      // Hover to show delete
      container.querySelectorAll("div[style*='border-bottom']").forEach(row => {
        const btn = row.querySelector(".ev-del-btn");
        row.addEventListener("mouseenter", () => btn && (btn.style.opacity = "1"));
        row.addEventListener("mouseleave", () => btn && (btn.style.opacity = "0"));
      });
    } catch (e) {
      container.innerHTML = `<p style="font-size:var(--text-sm);color:var(--text-muted)">Could not load timeline.</p>`;
    }
  }

  window.HNUi.deleteEventUI = async function(evId, empId) {
    try {
      await HNApi.deleteEvent(evId);
      loadTimelineUI(empId);
    } catch (e) {
      HN.toast("Could not delete event");
    }
  };

  // Add remaining modal handlers
  // (continuation with Add, Edit, Connect, EditConnection modals)

  // ── Event Listeners ─────────────────────
  if (panelClose) panelClose.addEventListener("click", closePanel);
  if (addCancel) addCancel.addEventListener("click", () => { addModal.classList.remove("open"); addForm.reset(); });
  if (editCancel) editCancel.addEventListener("click", () => editModal.classList.remove("open"));
  if (connCancel) connCancel.addEventListener("click", () => connectModal.classList.remove("open"));
  if (editConnCancel) editConnCancel.addEventListener("click", () => editConnModal.classList.remove("open"));
  if (eventCancel) eventCancel.addEventListener("click", () => eventModal.classList.remove("open"));

  // ── Search & Filter ─────────────────────
  function setupSearch(nodeLayer) {
    if (!searchInput || !nodeLayer) return;
    let rAfId = null;
    searchInput.addEventListener("input", e => {
      const q = e.target.value.toLowerCase().trim();
      if (rAfId) cancelAnimationFrame(rAfId);
      rAfId = requestAnimationFrame(() => {
        nodeLayer.selectAll("g.node").style("opacity", function(d) {
          return !q || d.name.toLowerCase().includes(q) || d.title.toLowerCase().includes(q) ? 1 : 0.1;
        });
      });
    });
  }

  // ── Context Menu ────────────────────────
  function showContextMenu(event, node) {
    if (!ctxMenu) return;
    event.preventDefault();
    event.stopPropagation();
    currentContextNode = node;

    document.getElementById("ctx-name").textContent = node.name;
    document.getElementById("ctx-title").textContent = node.title;
    document.getElementById("ctx-org-chart").style.display = node.company_id ? "flex" : "none";

    const x = Math.min(event.clientX, window.innerWidth - 210);
    const y = Math.min(event.clientY, window.innerHeight - 220);
    ctxMenu.style.left = x + "px";
    ctxMenu.style.top = y + "px";
    ctxMenu.style.display = "block";
  }

  if (ctxMenu) {
    document.addEventListener("click", () => (ctxMenu.style.display = "none"));

    document.getElementById("ctx-view-profile")?.addEventListener("click", () => {
      if (currentContextNode) fillPanel(currentContextNode);
    });

    document.getElementById("ctx-edit")?.addEventListener("click", () => {
      if (currentContextNode) openEditModal(currentContextNode);
    });

    document.getElementById("ctx-connect")?.addEventListener("click", () => {
      if (currentContextNode) openConnectModal(currentContextNode);
    });

    document.getElementById("ctx-org-chart")?.addEventListener("click", () => {
      if (currentContextNode?.company_id) HNNetwork.openOrgChart(currentContextNode.company_id);
    });

    document.getElementById("ctx-message")?.addEventListener("click", () => {
      if (currentContextNode) {
        currentContextNode.email
          ? (window.location.href = `mailto:${currentContextNode.email}`)
          : HN.toast("No email on record.");
      }
    });
  }

  // Placeholder modal openers (simplified)
  function openEditModal(node) {
    // TODO: Implement full edit modal
    editModal.classList.add("open");
  }

  function openConnectModal(fromNode) {
    // TODO: Implement full connect modal
    connectModal.classList.add("open");
  }

  function openEditConnModal(rel, fromNode) {
    // TODO: Implement full edit connection modal
    editConnModal.classList.add("open");
  }

  // ── Public API ──
  return {
    openPanel,
    closePanel,
    fillPanel,
    switchTab,
    showContextMenu,
    openEditModal,
    openConnectModal,
    openEditConnModal,
    setupSearch,
    loadTimelineUI,
    deleteEventUI: async function(evId, empId) {
      try {
        await HNApi.deleteEvent(evId);
        loadTimelineUI(empId);
      } catch (e) {
        HN.toast("Could not delete event");
      }
    },
  };
})();
