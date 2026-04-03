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

  // ── ADD PERSON MODAL ────────────────────────
  function openAddModal() {
    addForm.reset();
    fileInput.value = "";
    uploadPrev.style.display = "none";
    uploadPh.style.display = "block";

    // Clear previous submission handler
    addForm.onsubmit = null;

    // Attach submission handler
    addForm.onsubmit = async (e) => {
      e.preventDefault();
      const btn = addForm.querySelector("[type=submit]");
      btn.disabled = true;

      try {
        const formData = new FormData(addForm);

        const response = await fetch("/api/employees", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Error ${response.status}`);
        }

        const emp = await response.json();
        HN.toast(`✅  ${emp.name} added`);
        addModal.classList.remove("open");
        addForm.reset();
        
        // Reload graph to show new employee
        if (window.load) window.load();
      } catch (err) {
        HN.toast(`⚠️  ${err.message}`);
      } finally {
        btn.disabled = false;
      }
    };

    addModal.classList.add("open");
  }

  // Wire add button
  if (addPersonBtn) addPersonBtn.addEventListener("click", openAddModal);

  // ── File Upload Preview ─────────────────
  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          uploadPrev.src = ev.target.result;
          uploadPrev.style.display = "block";
          uploadPh.style.display = "none";
        };
        reader.readAsDataURL(file);
      }
    });
  }

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

  // ── EDIT MODAL ──────────────────────────────
  function openEditModal(node) {
    if (!node) return;
    
    // Populate form fields
    document.getElementById("edit-id").value = node.id;
    document.getElementById("edit-name").value = node.name || "";
    document.getElementById("edit-title").value = node.title || "";
    document.getElementById("edit-dept").value = node.department || "";
    document.getElementById("edit-company").value = node.company_id || "";
    document.getElementById("edit-tier").value = node.tier || "contributor";
    document.getElementById("edit-email").value = node.email || "";
    document.getElementById("edit-persona").value = node.persona || "";
    document.getElementById("edit-hobbies").value = (node.hobbies || []).join(", ");
    document.getElementById("edit-tags").value = (node.tags || []).join(", ");
    document.getElementById("edit-notes").value = node.notes || "";

    // Update avatar preview
    const avatarDiv = document.getElementById("edit-avatar-preview");
    if (node.image) {
      avatarDiv.innerHTML = `<img src="${node.image}" style="width:100%;height:100%;object-fit:cover;"/>`;
    } else {
      avatarDiv.innerHTML = HN.initials(node.name);
    }

    // Clear previous submission handler
    editForm.onsubmit = null;

    // Attach submission handler
    editForm.onsubmit = async (e) => {
      e.preventDefault();
      const btn = editForm.querySelector("[type=submit]");
      btn.disabled = true;

      try {
        const payload = {
          name: document.getElementById("edit-name").value,
          title: document.getElementById("edit-title").value,
          department: document.getElementById("edit-dept").value,
          company_id: document.getElementById("edit-company").value || null,
          tier: document.getElementById("edit-tier").value,
          email: document.getElementById("edit-email").value,
          persona: document.getElementById("edit-persona").value,
          hobbies: document.getElementById("edit-hobbies").value.split(",").map(h => h.trim()).filter(Boolean),
          tags: document.getElementById("edit-tags").value.split(",").map(t => t.trim()).filter(Boolean),
          notes: document.getElementById("edit-notes").value,
        };

        await HN.api.put(`/api/employees/${node.id}`, payload);
        HN.toast("✅ Changes saved");
        editModal.classList.remove("open");
        // Reload graph to show updates
        if (window.load) window.load();
      } catch (err) {
        HN.toast(`⚠️  ${err.message}`);
      } finally {
        btn.disabled = false;
      }
    };

    editModal.classList.add("open");
  }

  // ── CONNECT MODAL ────────────────────────
  let connFromNode = null;
  let connToNode = null;

  function openConnectModal(fromNode) {
    if (!fromNode) return;
    
    connFromNode = fromNode;
    connToNode = null;

    // Show "from" person
    document.getElementById("conn-from-name").textContent = fromNode.name;
    document.getElementById("conn-from-title").textContent = fromNode.title;
    const connFromAvatar = document.getElementById("conn-from-avatar");
    if (fromNode.image) {
      connFromAvatar.innerHTML = `<img src="${fromNode.image}" style="width:100%;height:100%;object-fit:cover;"/>`;
    } else {
      connFromAvatar.textContent = HN.initials(fromNode.name);
    }

    // Reset search and target
    connSearch.value = "";
    document.getElementById("conn-search-results").style.display = "none";
    document.getElementById("conn-to-selected").style.display = "none";
    document.getElementById("conn-label").value = "";
    document.getElementById("conn-rlabel").value = "";
    document.getElementById("conn-started").value = "";

    // Reset connection type
    document.querySelectorAll(".conn-type-opt input").forEach((inp, i) => {
      inp.checked = i === 0; // formal selected by default
    });

    // Search functionality
    connSearch.oninput = async (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) {
        document.getElementById("conn-search-results").style.display = "none";
        return;
      }

      try {
        const employees = await HN.api.get("/api/employees");
        const filtered = employees.filter(emp =>
          emp.id !== fromNode.id && (
            emp.name.toLowerCase().includes(q) ||
            emp.title.toLowerCase().includes(q)
          )
        );

        const resultsDiv = document.getElementById("conn-search-results");
        resultsDiv.innerHTML = filtered.slice(0, 8).map(emp => `
          <div class="conn-search-item" onclick="selectConnTo({id:${emp.id}, name:'${emp.name}', title:'${emp.title}', image:'${emp.image || ''}'})">
            <div class="conn-search-avatar">
              ${emp.image ? `<img src="${emp.image}"/>` : HN.initials(emp.name)}
            </div>
            <div>
              <div style="font-weight:600;font-size:var(--text-sm);color:var(--text-primary)">${emp.name}</div>
              <div style="font-size:var(--text-xs);color:var(--text-muted)">${emp.title}</div>
            </div>
          </div>
        `).join("");
        resultsDiv.style.display = filtered.length > 0 ? "block" : "none";
      } catch (err) {
        HN.toast("Could not search employees");
      }
    };

    // Submission handler
    document.getElementById("conn-submit").onclick = async () => {
      if (!connToNode) {
        HN.toast("Please select a person to connect to");
        return;
      }

      const btn = document.getElementById("conn-submit");
      btn.disabled = true;

      try {
        const type = document.querySelector(".conn-type-opt input:checked").value;
        const payload = {
          source: connFromNode.id,
          target: connToNode.id,
          type: type,
          label: document.getElementById("conn-label").value,
          reverse_label: document.getElementById("conn-rlabel").value,
          started_date: document.getElementById("conn-started").value || null,
          strength: 1.0,
        };

        await HN.api.post("/api/relationships", payload);
        HN.toast("✅ Connection created");
        connectModal.classList.remove("open");
        if (window.load) window.load();
      } catch (err) {
        HN.toast(`⚠️  ${err.message}`);
      } finally {
        btn.disabled = false;
      }
    };

    connectModal.classList.add("open");
    connSearch.focus();
  }

  window.selectConnTo = function(emp) {
    connToNode = emp;
    document.getElementById("conn-to-name").textContent = emp.name;
    document.getElementById("conn-to-selected").style.display = "flex";
    document.getElementById("conn-search-results").style.display = "none";
    connSearch.value = "";
  };

  window.clearConnTo = function() {
    connToNode = null;
    document.getElementById("conn-to-selected").style.display = "none";
    connSearch.value = "";
    connSearch.focus();
  };

  // ── EDIT CONNECTION MODAL ────────────────
  function openEditConnModal(rel, fromNode) {
    if (!rel) return;

    // Populate relationship data
    document.getElementById("edit-conn-id").value = rel.id;
    document.getElementById("edit-conn-type").value = rel.type;
    document.getElementById("edit-conn-label").value = rel.label || "";
    document.getElementById("edit-conn-rlabel").value = rel.reverse_label || "";
    document.getElementById("edit-conn-date").value = rel.started_date || "";
    document.getElementById("edit-conn-strength").value = rel.strength || 1.0;

    // Update strength display
    updateStrengthLabel();

    // Show from/to names
    const toNode = window.G?.nodes.find(n => n.id === (rel.target === fromNode.id ? rel.source : rel.target));
    document.getElementById("edit-conn-from-name").textContent = fromNode.name;
    document.getElementById("edit-conn-from-label-preview").textContent = 
      rel.source === fromNode.id ? (rel.label || rel.type) : (rel.reverse_label || rel.type);
    
    if (toNode) {
      document.getElementById("edit-conn-to-name").textContent = toNode.name;
      document.getElementById("edit-conn-to-label-preview").textContent = 
        rel.source === fromNode.id ? (rel.reverse_label || rel.type) : (rel.label || rel.type);
    }

    // Update strength label on slider change
    document.getElementById("edit-conn-strength").oninput = updateStrengthLabel;

    function updateStrengthLabel() {
      const val = parseFloat(document.getElementById("edit-conn-strength").value);
      const labels = ["Very weak", "Weak", "Medium", "Strong", "Very strong"];
      const idx = Math.min(4, Math.floor(val * 5));
      document.getElementById("strength-val").textContent = labels[idx];
    }

    // Submission handler
    editConnModal.onsubmit = null;
    editConnModal.onsubmit = async (e) => {
      e.preventDefault();
      const btn = editConnModal.querySelector("[type=submit]");
      btn.disabled = true;

      try {
        const payload = {
          type: document.getElementById("edit-conn-type").value,
          label: document.getElementById("edit-conn-label").value,
          reverse_label: document.getElementById("edit-conn-rlabel").value,
          started_date: document.getElementById("edit-conn-date").value || null,
          strength: parseFloat(document.getElementById("edit-conn-strength").value),
        };

        await HN.api.put(`/api/relationships/${rel.id}`, payload);
        HN.toast("✅ Connection updated");
        editConnModal.classList.remove("open");
        if (window.load) window.load();
      } catch (err) {
        HN.toast(`⚠️  ${err.message}`);
      } finally {
        btn.disabled = false;
      }
    };

    editConnModal.classList.add("open");
  }

  // ── Public API ──
  return {
    openPanel,
    closePanel,
    fillPanel,
    switchTab,
    showContextMenu,
    openAddModal,
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
