/* ═══════════════════════════════════════════════════
   THE HUMAN NETWORK — network.js v4 (REFACTORED)
   - Modularized: Uses D3Renderer & GraphController
   - Improved separation of concerns
   - Cleaner state management
   - All Phase 1-4 features integrated
═══════════════════════════════════════════════════ */
(function () {
  "use strict";

  // ── Initialize Controllers ──────────────
  GraphController.initDOM();
  const DOM = GraphController.DOM;
  
  let { TIER_R, TIER_C } = D3Renderer;
  let G, sim, zoom, nodeLayer, bubElems, lblElems;
  let focusActive = false, focusNode = null;
  let focusPicker, focusExitPill;

  // ── Helpers ─────────────── 
  function internalPath(d) { return D3Renderer.internalPath(d); }
  function crossPath(d) { return D3Renderer.crossPath(d); }

  /* ── MAIN INIT ──────────────────────────── */
  async function load() {
    try {
      G = await GraphController.loadGraph();
      GraphController.cacheFocusElements();
      focusPicker   = document.getElementById("focus-picker");
      focusExitPill = document.getElementById("focus-exit-pill");
      
      render(G);
      fillCoSelect(G.companies);
      
      // ── Phase 3: Initialize time machine slider ──────────
      if (HNFeatures && HNFeatures.initTimeMachineSlider) {
        setTimeout(() => {
          const nl = d3.select(DOM.svg).select("g.nodes");
          const el = d3.select(DOM.svg).select("g.edges");
          const cl = d3.select(DOM.svg).select("g.cross");
          HNFeatures.initTimeMachineSlider("graph-canvas", G.nodes, 
            [...G.edges.formal, ...G.edges.informal, ...G.edges.cross_company],
            nl, el, cl, document.getElementById("org-overlay"));
        }, 100);
      }
    } catch(e) { HN.toast("⚠️  Could not load network."); }
  }

  function fillCoSelect(cos) {
    const coSelect = DOM.canvas.parentElement?.querySelector("#co-select") || document.getElementById("co-select");
    if (!coSelect) return;
    coSelect.innerHTML = '<option value="">— No company —</option>';
    cos.forEach(c => { 
      const o = document.createElement("option"); 
      o.value = c.id; 
      o.textContent = c.name; 
      coSelect.appendChild(o); 
    });
  }

  /* ── RENDER ──────────────────────────────── */
  function render(data) {
    // Exit focus mode
    focusActive = false;
    focusNode = null;
    if (focusExitPill) focusExitPill.style.display = "none";

    const { nodes, companies, edges } = data;
    const renderData = GraphController.prepareRenderData(data);
    const { nodes: live, links } = renderData;
    
    const W = DOM.canvas.clientWidth || 900;
    const H = DOM.canvas.clientHeight || 600;

    // Initialize SVG structure
    const { svg: d3svg, g, defs, bubbleLayer, crossLayer, edgeLayer, nodeLayer: nL } = 
      D3Renderer.initSvg(DOM.svg);
    nodeLayer = nL;

    // Add clip paths
    D3Renderer.addClipPaths(defs, live);

    // Setup zoom
    zoom = GraphController.createZoom(d3svg, g);

    // Create simulation
    sim = GraphController.createSimulation(live, links, DOM.canvas);

    // Render edges (internal)
    const { edgeElems, internalLinks } = D3Renderer.renderEdges(edgeLayer, links);
    
    // Render edges (cross-company)
    const { crossElems, crossLinks } = D3Renderer.renderCrossEdges(crossLayer, links);

    // Store edge state globally for toggle buttons
    window._hnEdgeElems = edgeElems;
    window._hnCrossElems = crossElems;
    window._hnInternalLinks = internalLinks;
    // Show formal edges by default, toggle others off
    window._hnLineState = { formal: true, informal: false, cross_company: false };
    _applyLineToggle();

    // Render nodes
    const nodeElems = D3Renderer.renderNodes(nodeLayer, live);
    
    // Add node interactions
    nodeElems.call(
      d3.drag()
        .clickDistance(4)
        .on("start", (e, d) => {
          e.sourceEvent.stopPropagation();
          live.filter(n => n.company_id === d.company_id).forEach(n => { n.fx = n.x; n.fy = n.y; });
          if (sim) { sim.alphaTarget(0); sim.stop(); }
        })
        .on("drag", (e, d) => {
          const dx = e.dx, dy = e.dy;
          live.filter(n => n.company_id === d.company_id).forEach(n => {
            n.x += dx; n.y += dy;
            n.fx = n.x; n.fy = n.y;
          });
          nodeLayer.selectAll("g.node").attr("transform", nd => `translate(${nd.x},${nd.y})`);
          edgeLayer.selectAll("path").attr("d", internalPath);
          crossLayer.selectAll("path").attr("d", crossPath);
          companies.forEach(co => D3Renderer.updateBubble(co, live, bubElems, lblElems));
        })
        .on("end", (e, d) => {
          if (sim) sim.alpha(0.05).restart();
        })
    )
    .on("click", onNodeClick);

    // Phase 3: Keyboard navigation
    if (HNFeatures && HNFeatures.initKeyboardNavigation) {
      HNFeatures.initKeyboardNavigation(nodeLayer, fillPanel);
    }

    // Attach context menus
    attachContextMenu(nodeElems);

    // Attach double-click focus picker
    nodeElems.on("dblclick", function(event, d) {
      event.preventDefault();
      event.stopPropagation();
      showFocusPicker(event, d);
    });

    // Render company bubbles
    const { bubElems: bE, lblElems: lE } = D3Renderer.renderCompanies(bubbleLayer, companies);
    bubElems = bE;
    lblElems = lE;

    // Add company bubble interactions
    bubbleLayer.selectAll(".co-group").each(function(_, i) {
      const co = companies[i];
      const bp = d3.select(this).select("path");
      
      bp.on("dblclick", (e) => { e.stopPropagation(); openOrg(co.id); })
        .call(d3.drag()
          .on("start", function(event) {
            event.sourceEvent.stopPropagation();
            d3.select(this).style("cursor", "grabbing");
            live.filter(n => n.company_id === co.id).forEach(n => { n.fx = n.x; n.fy = n.y; });
            if (sim) sim.alphaTarget(0).stop();
          })
          .on("drag", function(event) {
            const dx = event.dx, dy = event.dy;
            live.filter(n => n.company_id === co.id).forEach(n => {
              n.x += dx; n.y += dy;
              n.fx += dx; n.fy += dy;
            });
            nodeLayer.selectAll("g.node")
              .filter(d => d.company_id === co.id)
              .attr("transform", d => `translate(${d.x},${d.y})`);
            D3Renderer.updateBubble(co, live, bubElems, lblElems);
            edgeLayer.selectAll("path").attr("d", internalPath);
            crossLayer.selectAll("path").attr("d", crossPath);
          })
          .on("end", function() {
            d3.select(this).style("cursor", "grab");
            if (sim) sim.alphaTarget(0).restart();
          })
        );
    });

    // Phase 3: Dynamic contrast
    if (HNFeatures && HNFeatures.applyDynamicContrast) {
      HNFeatures.applyDynamicContrast(bubbleLayer, companies);
    }

    // Tick handler
    sim.on("tick", () => {
      edgeElems.attr("d", internalPath);
      crossElems.attr("d", crossPath);
      nodeElems.attr("transform", d => `translate(${d.x},${d.y})`);
      companies.forEach(co => D3Renderer.updateBubble(co, live, bubElems, lblElems));
    });
  }

  /* ── LINE TOGGLE ────────────────────────── */
  function _applyLineToggle() {
    const state = window._hnLineState || { formal: false, informal: false, cross_company: false };
    const edgeElems = window._hnEdgeElems;
    const crossElems = window._hnCrossElems;
    if (!edgeElems || !crossElems) return;

    edgeElems.transition().duration(250)
      .attr("stroke-opacity", d => {
        if (d.type === "formal") return state.formal ? 0.55 : 0;
        if (d.type === "informal") return state.informal ? 0.55 : 0;
        return 0;
      });

    crossElems.transition().duration(250)
      .attr("stroke-opacity", state.cross_company ? 0.7 : 0);

    ["formal", "informal", "cross_company"].forEach(type => {
      const btn = document.getElementById(`line-toggle-${type}`);
      if (!btn) return;
      btn.classList.toggle("active", !!state[type]);
    });
  }

  function initLineToggles() {
    if (document.getElementById("line-toggles")) return;

    const container = document.createElement("div");
    container.id = "line-toggles";
    container.style.cssText = `
      position:fixed;
      top:80px;
      right:16px;
      z-index:150;
      display:flex;
      flex-direction:column;
      gap:6px;
    `;

    const buttons = [
      { type: "formal", label: "Reporting", color: "#7e7385", dash: "none" },
      { type: "informal", label: "Collaboration", color: "#006b5f", dash: "6 4" },
      { type: "cross_company", label: "Cross-Company", color: "#b49632", dash: "5 6" },
    ];

    buttons.forEach(({ type, label, color, dash }) => {
      const btn = document.createElement("button");
      btn.id = `line-toggle-${type}`;
      btn.title = `Toggle ${label} lines`;
      btn.style.cssText = `
        display:flex;align-items:center;gap:8px;
        padding:7px 12px;
        background:var(--surface-card);
        border:1.5px solid var(--outline-variant);
        border-radius:8px;
        cursor:pointer;
        font-family:var(--font-ui);
        font-size:11px;font-weight:700;
        color:var(--text-muted);
        text-transform:uppercase;letter-spacing:.06em;
        box-shadow:var(--shadow-ambient);
        transition:all 150ms;
        white-space:nowrap;
        opacity:0.7;
      `;

      const svgNS = "http://www.w3.org/2000/svg";
      const lineSvg = document.createElementNS(svgNS, "svg");
      lineSvg.setAttribute("width", "28");
      lineSvg.setAttribute("height", "10");
      lineSvg.style.flexShrink = "0";
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", "2");
      line.setAttribute("y1", "5");
      line.setAttribute("x2", "26");
      line.setAttribute("y2", "5");
      line.setAttribute("stroke", color);
      line.setAttribute("stroke-width", "2");
      if (dash !== "none") line.setAttribute("stroke-dasharray", dash);
      lineSvg.appendChild(line);

      btn.appendChild(lineSvg);
      btn.appendChild(document.createTextNode(label));
      btn.addEventListener("click", () => {
        window._hnLineState[type] = !window._hnLineState[type];
        _applyLineToggle();
      });

      btn.addEventListener("mouseenter", () => { btn.style.opacity = "1"; });
      btn.addEventListener("mouseleave", () => {
        btn.style.opacity = window._hnLineState[type] ? "1" : "0.7";
      });

      container.appendChild(btn);
    });

    DOM.canvas.appendChild(container);
  }

  const styleTag = document.createElement("style");
  styleTag.textContent = `
    #line-toggles button.active {
      opacity:1 !important;
      background:var(--surface-high) !important;
      border-color:var(--primary) !important;
      color:var(--text-primary) !important;
      box-shadow:0 0 0 2px rgba(129,39,207,0.15), var(--shadow-ambient) !important;
    }
  `;
  document.head.appendChild(styleTag);

  let currentPanelNode = null;

  /* ── NODE CLICK → PANEL ─────────────────── */
  function onNodeClick(event, d) {
    event.stopPropagation();
    const W = DOM.svg.clientWidth, H = DOM.svg.clientHeight;
    d3.select(DOM.svg).transition().duration(480).ease(d3.easeCubicInOut)
      .call(zoom.transform, d3.zoomIdentity.translate(W / 2 - d.x * 1.1, H / 2 - d.y * 1.1).scale(1.1));
    currentPanelNode = d;
    fillPanel(d);
    openPanel();
  }

    // ── Cross-company edges — HIDDEN by default ──
    const crossLinks = links.filter(e => e.type === "cross_company");
    const crossElems = crossLayer.selectAll("path").data(crossLinks).enter()
      .append("path").attr("fill","none").attr("stroke","#b49632")
      .attr("stroke-width",1.3).attr("stroke-dasharray","5 6")
      .attr("stroke-opacity", 0)   // hidden by default
      .attr("stroke-linecap","round");

    // Pulse animation still attached but invisible until toggled
    crossElems.each(function() {
      const el = d3.select(this);
      (function pulse() {
        el.transition().duration(2000).ease(d3.easeLinear)
          .attrTween("stroke-dashoffset",()=>d3.interpolate(0,-22)).on("end",pulse);
      })();
    });

    // ── Internal edges — HIDDEN by default ──
    const internalLinks = links.filter(e => e.type !== "cross_company");
    const edgeElems = edgeLayer.selectAll("path").data(internalLinks).enter()
      .append("path").attr("fill","none")
      .attr("stroke",       d => d.type === "formal" ? "#7e7385" : "#006b5f")
      .attr("stroke-width", d => {
        const base = d.type === "formal" ? 2.2 : 1.8;
        return base * (d.strength || 1.0);
      })
      .attr("stroke-dasharray", d => d.type === "informal" ? "6 4" : null)
      .attr("stroke-opacity", 0);  // hidden by default

    // ── Store refs globally for toggle buttons ──
    window._hnEdgeElems  = edgeElems;
    window._hnCrossElems = crossElems;
    window._hnInternalLinks = internalLinks;
    // Preserve existing line state, or initialize if not set
    if (!window._hnLineState) {
      window._hnLineState = { formal: true, informal: false, cross_company: false };
    }

    // Apply toggle state after re-render
    _applyLineToggle();

    // ── Nodes ────────────────────────────────
    const nodeElems = nodeLayer.selectAll("g.node").data(live).enter()
      .append("g").attr("class", d=>`node node--${d.tier}`)
      .style("cursor","pointer").attr("opacity",0)
      .call(
        d3.drag()
          .clickDistance(4) // only fire drag if moved more than 4px — prevents dblclick being eaten
          .on("start", (e, d) => {
            e.sourceEvent.stopPropagation();
            // Freeze entire company cluster without kicking physics
            live.filter(n => n.company_id === d.company_id).forEach(n => { n.fx = n.x; n.fy = n.y; });
            if (sim) { sim.alphaTarget(0); sim.stop(); } // stop physics completely — no slingshot
          })
          .on("drag", (e, d) => {
            const dx = e.dx, dy = e.dy;
            live.filter(n => n.company_id === d.company_id).forEach(n => {
              n.x += dx; n.y += dy;
              n.fx = n.x; n.fy = n.y;
            });
            // Repaint directly — no simulation needed
            nodeLayer.selectAll("g.node")
              .attr("transform", nd => `translate(${nd.x},${nd.y})`);
            edgeLayer.selectAll("path").attr("d", internalPath);
            crossLayer.selectAll("path").attr("d", crossPath);
            companies.forEach(co => updateBubble(co, live, bubElems, lblElems));
          })
          .on("end", (e, d) => {
            // Keep nodes pinned where dropped — don't release fx/fy
            // Gently restart physics at very low alpha just to settle edges
            if (sim) sim.alpha(0.05).restart();
          })
      )
      .on("click", onNodeClick);

    nodeElems.append("circle")
      .attr("r",    d=>TIER_R[d.tier])
      .attr("fill", d=>TIER_C[d.tier].fill)
      .attr("stroke",       d=>TIER_C[d.tier].stroke)
      .attr("stroke-width", 2)
      .attr("filter","url(#nshadow)");

    nodeElems.each(function(d) {
      if (!d.image) return;
      d3.select(this).append("image")
        .attr("href",d.image)
        .attr("x",-TIER_R[d.tier]).attr("y",-TIER_R[d.tier])
        .attr("width",TIER_R[d.tier]*2).attr("height",TIER_R[d.tier]*2)
        .attr("clip-path",`url(#cp-${d.id})`)
        .attr("preserveAspectRatio","xMidYMid slice");
    });

    nodeElems.append("text").attr("text-anchor","middle").attr("dy","0.35em")
      .attr("fill",d=>TIER_C[d.tier].text)
      .attr("font-family","'Manrope',sans-serif")
      .attr("font-size",d=>d.tier==="executive"?13:11).attr("font-weight","700")
      .attr("pointer-events","none")
      .text(d=>d.image?"":HN.initials(d.name));

    // Name label — larger offset so it clears the node
    nodeElems.append("text").attr("text-anchor","middle")
      .attr("dy",d=>TIER_R[d.tier]+16).attr("class","node-label")
      .attr("pointer-events","none").text(d=>d.name);

    nodeElems.append("text").attr("text-anchor","middle")
      .attr("dy",d=>TIER_R[d.tier]+30).attr("class","node-sublabel")
      .attr("pointer-events","none").text(d=>d.title);

    // Hover glow
    nodeElems.append("circle").attr("class","nglow")
      .attr("r",d=>TIER_R[d.tier]+7).attr("fill","none")
      .attr("stroke",d=>TIER_C[d.tier].fill).attr("stroke-width",3)
      .attr("opacity",0).style("pointer-events","none");

    nodeElems
      .on("mouseenter",function(){
        d3.select(this).select(".nglow").transition().duration(100).attr("opacity",.45);
        d3.select(this).select("circle:first-child").transition().duration(100).attr("r",d=>TIER_R[d.tier]+3);
      })
      .on("mouseleave",function(){
        d3.select(this).select(".nglow").transition().duration(180).attr("opacity",0);
        d3.select(this).select("circle:first-child").transition().duration(180).attr("r",d=>TIER_R[d.tier]);
      });

    // Staggered reveal animation
    nodeElems.transition().duration(400).delay((_,i)=>i*40).attr("opacity",1);

    // ── Phase 3: Enable keyboard navigation ─────────────
    if (HNFeatures && HNFeatures.initKeyboardNavigation) {
      HNFeatures.initKeyboardNavigation(nodeLayer, fillPanel);
    }

    // Attach right-click context menu
    attachContextMenu(nodeElems);

    // Attach double-click focus picker
    nodeElems.on("dblclick", function(event, d) {
      event.preventDefault();
      event.stopPropagation();
      showFocusPicker(event, d);
    });

    // ── Company bubbles ──────────────────────
    const bubElems = {}, lblElems = {};
    companies.forEach(co => {
      const col = co.color;
      const bg  = bubbleLayer.append("g").attr("class","co-group").attr("data-id",co.id);

      const bp  = bg.append("path").attr("fill",col.fill)
        .attr("stroke",col.stroke).attr("stroke-width",1.5)
        .attr("stroke-dasharray", null).attr("opacity",.85)
        .style("cursor","grab")
        .on("mouseenter",function(){ d3.select(this).transition().duration(160).attr("stroke-width",3.5).attr("fill",col.fill.replace("0.07","0.13")); })
        .on("mouseleave",function(){ d3.select(this).transition().duration(220).attr("stroke-width",2).attr("fill",col.fill); })
        .on("dblclick",(e)=>{ e.stopPropagation(); openOrg(co.id); })
        .call(d3.drag()
          .on("start", function(event) {
            event.sourceEvent.stopPropagation();
            d3.select(this).style("cursor","grabbing");
            // Freeze all members in place so they move as a unit
            live.filter(n => n.company_id === co.id).forEach(n => { n.fx = n.x; n.fy = n.y; });
            if (sim) sim.alphaTarget(0).stop(); // stop physics while dragging bubble
          })
          .on("drag", function(event) {
            const dx = event.dx, dy = event.dy;
            // Move every member node by the same delta
            live.filter(n => n.company_id === co.id).forEach(n => {
              n.x  += dx; n.y  += dy;
              n.fx += dx; n.fy += dy;
            });
            // Immediately repaint without waiting for tick
            nodeLayer.selectAll("g.node")
              .filter(d => d.company_id === co.id)
              .attr("transform", d => `translate(${d.x},${d.y})`);
            updateBubble(co, live, bubElems, lblElems);
            // Update edges live
            edgeLayer.selectAll("path").attr("d", internalPath);
            crossLayer.selectAll("path").attr("d", crossPath);
          })
          .on("end", function() {
            d3.select(this).style("cursor","grab");
            // Keep nodes pinned where user dropped them — don't release fx/fy
            // so the cluster stays put after dragging
            if (sim) sim.alphaTarget(0).restart();
          })
        );

      const bl = bg.append("text").attr("class","co-label")
        .attr("fill",col.label).attr("text-anchor","middle")
        .attr("pointer-events","none").attr("opacity",.85).text(co.name);

      bubElems[co.id] = bp; lblElems[co.id] = bl;
    });

    // ── Phase 3: Apply dynamic text contrast to company labels (WCAG) ──
    if (HNFeatures && HNFeatures.applyDynamicContrast) {
      HNFeatures.applyDynamicContrast(bubbleLayer, companies);
    }

    // ── Tick ─────────────────────────────────
    sim.on("tick", () => {
      edgeElems.attr("d", internalPath);
      crossElems.attr("d", crossPath);
      nodeElems.attr("transform", d=>`translate(${d.x},${d.y})`);
      companies.forEach(co => updateBubble(co, live, bubElems, lblElems));
    });
  }

  /* ── Line toggle ────────────────────────── */
  function _applyLineToggle() {
    const state = window._hnLineState || { formal: false, informal: false, cross_company: false };
    const edgeElems  = window._hnEdgeElems;
    const crossElems = window._hnCrossElems;
    if (!edgeElems || !crossElems) return;

    // Internal lines (formal + informal)
    edgeElems.transition().duration(250)
      .attr("stroke-opacity", d => {
        if (d.type === "formal")   return state.formal   ? 0.55 : 0;
        if (d.type === "informal") return state.informal ? 0.55 : 0;
        return 0;
      });

    // Cross-company lines
    crossElems.transition().duration(250)
      .attr("stroke-opacity", state.cross_company ? 0.7 : 0);

    // Update button styles
    ["formal","informal","cross_company"].forEach(type => {
      const btn = document.getElementById(`line-toggle-${type}`);
      if (!btn) return;
      if (state[type]) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  function initLineToggles() {
    if (document.getElementById("line-toggles")) return; // already exists

    const container = document.createElement("div");
    container.id = "line-toggles";
    container.style.cssText = `
      position:fixed;
      top:80px;
      right:16px;
      z-index:150;
      display:flex;
      flex-direction:column;
      gap:6px;
    `;

    const buttons = [
      { type: "formal",        label: "Reporting",     color: "#7e7385", dash: "none" },
      { type: "informal",      label: "Collaboration", color: "#006b5f", dash: "6 4"  },
      { type: "cross_company", label: "Cross-Company", color: "#b49632", dash: "5 6"  },
    ];

    buttons.forEach(({ type, label, color, dash }) => {
      const btn = document.createElement("button");
      btn.id = `line-toggle-${type}`;
      btn.title = `Toggle ${label} lines`;
      btn.style.cssText = `
        display:flex;align-items:center;gap:8px;
        padding:7px 12px;
        background:var(--surface-card);
        border:1.5px solid var(--outline-variant);
        border-radius:8px;
        cursor:pointer;
        font-family:var(--font-ui);
        font-size:11px;font-weight:700;
        color:var(--text-muted);
        text-transform:uppercase;letter-spacing:.06em;
        box-shadow:var(--shadow-ambient);
        transition:all 150ms;
        white-space:nowrap;
        opacity:0.7;
      `;

      // Line preview SVG
      const svgNS = "http://www.w3.org/2000/svg";
      const lineSvg = document.createElementNS(svgNS, "svg");
      lineSvg.setAttribute("width","28");lineSvg.setAttribute("height","10");
      lineSvg.style.flexShrink = "0";
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1","2");line.setAttribute("y1","5");
      line.setAttribute("x2","26");line.setAttribute("y2","5");
      line.setAttribute("stroke", color);
      line.setAttribute("stroke-width","2");
      if (dash !== "none") line.setAttribute("stroke-dasharray", dash);
      lineSvg.appendChild(line);

      btn.appendChild(lineSvg);
      btn.appendChild(document.createTextNode(label));

      btn.addEventListener("click", () => {
        window._hnLineState[type] = !window._hnLineState[type];
        _applyLineToggle();
      });

      // Hover effects
      btn.addEventListener("mouseenter", () => { btn.style.opacity = "1"; });
      btn.addEventListener("mouseleave", () => {
        btn.style.opacity = window._hnLineState[type] ? "1" : "0.7";
      });

      container.appendChild(btn);
    });

    document.getElementById("graph-canvas").appendChild(container);
  }

  // Active state CSS — injected once
  const styleTag = document.createElement("style");
  styleTag.textContent = `
    #line-toggles button.active {
      opacity:1 !important;
      background:var(--surface-high) !important;
      border-color:var(--primary) !important;
      color:var(--text-primary) !important;
      box-shadow:0 0 0 2px rgba(129,39,207,0.15), var(--shadow-ambient) !important;
    }
  `;
  document.head.appendChild(styleTag);

  /* ── Company cluster drag ───────────────── */
  function lockCompany(d, lock, live) {
    live.filter(n => n.company_id === d.company_id && n.id !== d.id)
      .forEach(n => { if(lock){ n._fx=n.x; n._fy=n.y; n.fx=n.x; n.fy=n.y; } else { n.fx=null; n.fy=null; } });
    if (lock) { d.fx=d.x; d.fy=d.y; } else { d.fx=null; d.fy=null; }
  }

  function moveCompany(d, dx, dy, live) {
    live.filter(n => n.company_id === d.company_id).forEach(n => {
      n.x += dx; n.y += dy;
      if (n.fx !== null && n.fx !== undefined) { n.fx += dx; n.fy += dy; }
    });
    d.fx = d.x; d.fy = d.y;
    sim.alpha(0.05).restart();
  }

  function clusterForce(live, centres, strength) {
    return function(alpha) {
      live.forEach(n => {
        const cid = n.company_id || "none";
        const c   = centres[cid];
        if (!c) return;
        n.vx += (c.x - n.x) * strength * alpha;
        n.vy += (c.y - n.y) * strength * alpha;
      });
    };
  }

  /* ── Bubble hull ────────────────────────── */
  function updateBubble(co, live, bubElems, lblElems) {
    const members = live.filter(n => n.company_id === co.id);
    if (!members.length) return;
    const bp = bubElems[co.id], bl = lblElems[co.id];

    if (members.length === 1) {
      const m = members[0], r = TIER_R[m.tier] + 55;
      bp.attr("d", `M${m.x-r},${m.y}a${r},${r} 0 1,0 ${r*2},0a${r},${r} 0 1,0 ${-r*2},0`);
      bl.attr("x",m.x).attr("y",m.y-r-14);
      return;
    }

    // WIDER padding (60px) so names are never clipped
    const pts = [];
    members.forEach(n => {
      const r = TIER_R[n.tier] + 60;
      for (let i=0;i<10;i++){
        const a = (i/10)*2*Math.PI;
        pts.push([n.x+r*Math.cos(a), n.y+r*Math.sin(a)]);
      }
    });
    const hull = d3.polygonHull(pts);
    if (!hull) return;
    const line = d3.line().curve(d3.curveCatmullRomClosed.alpha(0.5));
    bp.attr("d", line(hull));
    bl.attr("x", d3.mean(members,d=>d.x))
      .attr("y", d3.min(members,d=>d.y-TIER_R[d.tier]) - 20);
  }

  /* ── Edge paths ─────────────────────────── */
  function internalPath(d) {
    const srcR = TIER_R[d.source.tier] + 3;
    const tgtR = TIER_R[d.target.tier] + 3;
    const dx = d.target.x-d.source.x, dy = d.target.y-d.source.y;
    const dr = Math.sqrt(dx*dx+dy*dy)||1;
    const sx = d.source.x+dx*(srcR/dr), sy = d.source.y+dy*(srcR/dr);
    const tx = d.source.x+dx*(1-tgtR/dr), ty = d.source.y+dy*(1-tgtR/dr);
    if (d.type==="informal") return `M${sx},${sy}A${dr*.7},${dr*.7} 0 0,1 ${tx},${ty}`;
    return `M${sx},${sy}L${tx},${ty}`;
  }

  function crossPath(d) {
    const mx = (d.source.x+d.target.x)/2 - (d.target.y-d.source.y)*.15;
    const my = (d.source.y+d.target.y)/2 + (d.target.x-d.source.x)*.15;
    return `M${d.source.x},${d.source.y}Q${mx},${my} ${d.target.x},${d.target.y}`;
  }

  let currentPanelNode = null;

  /* ── Node click → panel ─────────────────── */
  function onNodeClick(event, d) {
    event.stopPropagation();
    const W=svg.clientWidth, H=svg.clientHeight;
    d3.select(svg).transition().duration(480).ease(d3.easeCubicInOut)
      .call(zoom.transform, d3.zoomIdentity.translate(W/2-d.x*1.1,H/2-d.y*1.1).scale(1.1));
    currentPanelNode = d;
    fillPanel(d);
    openPanel();
  }

  function fillPanel(d) {
    currentPanelNode = d;
    document.getElementById("p-name").textContent    = d.name;
    document.getElementById("p-title").textContent   = d.title;
    document.getElementById("p-persona").textContent = d.persona || "No persona yet.";
    document.getElementById("ini-text").textContent  = HN.initials(d.name);

    const img=document.getElementById("profile-pic"), ini=document.getElementById("av-ini");
    if (d.image){ img.src=d.image; img.style.display="block"; ini.style.display="none"; }
    else { img.style.display="none"; ini.style.display="flex"; }

    // Company badge
    const badge = document.getElementById("p-co-badge");
    if (d.company_id) {
      const co = G.companies.find(c=>c.id===d.company_id);
      if (co) {
        badge.style.cssText=`display:inline-flex;border-color:${co.color.stroke};color:${co.color.label};background:${co.color.fill};`;
        document.getElementById("p-co-name").textContent = co.name;
        badge.onclick = () => openOrg(co.id);
        orgBtn.style.display="flex"; orgBtn.onclick=()=>openOrg(co.id);
      }
    } else { badge.style.display="none"; orgBtn.style.display="none"; }

    // Hobbies
    const hc = document.getElementById("p-hobbies");
    if (hc) hc.innerHTML = (d.hobbies||[]).map(h=>`<span class="hobby-chip">${h}</span>`).join("")
      || `<p style="font-size:var(--text-sm);color:var(--text-muted)">None listed.</p>`;

    // Tags
    const tc = document.getElementById("p-tags");
    const tw = document.getElementById("p-tags-wrap");
    if (tc && tw) {
      if (d.tags && d.tags.length) {
        tc.innerHTML = d.tags.map(t=>`<span class="hobby-chip" style="background:var(--primary-muted);border-color:var(--primary-border);color:var(--primary)">#${t}</span>`).join("");
        tw.style.display = "block";
      } else { tw.style.display = "none"; }
    }

    // Notes
    const notesArea = document.getElementById("p-notes");
    if (notesArea) notesArea.value = d.notes || "";
    const saveNotesBtn = document.getElementById("save-notes-btn");
    if (saveNotesBtn) {
      saveNotesBtn.onclick = async () => {
        try {
          await HN.api.put(`/api/employees/${d.id}`, { notes: notesArea.value });
          HN.toast("Notes saved");
          const node = G.nodes.find(n=>n.id===d.id);
          if (node) node.notes = notesArea.value;
        } catch(e) { HN.toast("Could not save notes"); }
      };
    }

    // Relations — bidirectional labels + strength bar + edit & delete
    const rl = document.getElementById("p-rels");
    const allEdges = [
      ...G.edges.formal.map(e=>({...e,type:"formal"})),
      ...G.edges.informal.map(e=>({...e,type:"informal"})),
      ...G.edges.cross_company.map(e=>({...e,type:"cross_company"})),
    ];
    const conn = allEdges.filter(e=>e.source===d.id||e.target===d.id)
      .map(e=>{ const oid=e.source===d.id?e.target:e.source; const o=G.nodes.find(n=>n.id===oid); return o?{...e,other:o}:null; })
      .filter(Boolean);

    rl.innerHTML = conn.length ? "" : `<p style="font-size:var(--text-sm);color:var(--text-muted)">No connections yet.</p>`;
    conn.forEach(r => {
      const co           = r.other.company_id ? G.companies.find(c=>c.id===r.other.company_id) : null;
      const div          = document.createElement("div"); div.className="rel-item";
      const displayLabel = (r.source===d.id)
        ? (r.label || r.type.replace("_"," "))
        : (r.reverse_label || r.label || r.type.replace("_"," "));
      const strengthPct   = Math.round((r.strength||1.0)*100);
      const strengthColor = r.type==="formal"?"#7e7385":r.type==="informal"?"#006b5f":"#b49632";
      const dateStr       = r.started_date ? ` · Since ${r.started_date.slice(0,7)}` : "";

      div.innerHTML=`
        <span class="rel-dot ${r.type}"></span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:var(--text-sm);color:var(--text-primary)">${r.other.name}</div>
          <div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:1px">${displayLabel} · ${r.type.replace("_"," ")}${co?` · ${co.name}`:""}${dateStr}</div>
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
        const n=G.nodes.find(x=>x.id===r.other.id); if(n) fillPanel({...n});
      });
      div.querySelector('[data-action="edit"]').addEventListener("click", e => {
        e.stopPropagation(); openEditConnModal(r, d);
      });
      div.querySelector('[data-action="delete"]').addEventListener("click", async e => {
        e.stopPropagation();
        if (!confirm(`Remove connection between ${d.name} and ${r.other.name}?`)) return;
        try {
          // ── Phase 4: Animate line deletion with rubber-band effect ──
          const edgeElems = d3.select(svg).selectAll(".edges path, .cross path");
          let targetElem = null;
          edgeElems.each(function(edge) {
            if (edge && edge.id === r.id) targetElem = this;
          });
          if (targetElem && HNFeatures && HNFeatures.rubberBandDelete) {
            await HNFeatures.rubberBandDelete(targetElem, 600);
          }
          
          await HN.api.del(`/api/relationships/${r.id}`);
          HN.toast("Connection removed");
          G = await HN.api.get("/api/graph");
          if (sim) sim.stop(); render(G); fillPanel({...d});
        } catch(err) { HN.toast(err.message); }
      });
      rl.appendChild(div);
    });

    // Timeline
    loadTimeline(d.id);
    const addEvBtn = document.getElementById("add-event-btn");
    if (addEvBtn) addEvBtn.onclick = () => openEventModal(d.id);

    msgBtn.onclick = () => d.email ? window.location.href=`mailto:${d.email}` : HN.toast("No email on record.");
    switchTab("overview");
  }

  function openPanel()  {
    panel.classList.add("open");
    panel.removeAttribute("aria-hidden");
    canvas.classList.add("panel-open");
    // Wire Connect button
    const panelConnectBtn = document.getElementById("panel-connect-btn");
    if (panelConnectBtn) {
      panelConnectBtn.onclick = () => { if (currentPanelNode) openConnectModal(currentPanelNode); };
    }
    // Wire Edit button
    const panelEditBtn = document.getElementById("panel-edit-btn");
    if (panelEditBtn) {
      panelEditBtn.onclick = () => { if (currentPanelNode) openEditModal(currentPanelNode); };
    }
  }
  function closePanel() { panel.classList.remove("open"); panel.setAttribute("aria-hidden","true"); canvas.classList.remove("panel-open"); }
  panelClose.addEventListener("click", closePanel);
  // Panel — close only via X button or clicking another node

  /* ── Tabs ────────────────────────────────── */
  document.querySelectorAll(".tab-btn").forEach(b => b.addEventListener("click",()=>switchTab(b.dataset.tab)));
  function switchTab(id) {
    document.querySelectorAll(".tab-btn").forEach(b=>b.classList.toggle("active",b.dataset.tab===id));
    ["overview","network","timeline","notes","hobbies"].forEach(t=>{
      const el = document.getElementById(`tab-${t}`);
      if (el) el.style.display = t===id ? "block" : "none";
    });
  }

  /* ══════════════════════════════════════════
     TIMELINE — load + render event log
  ══════════════════════════════════════════ */
  async function loadTimeline(empId) {
    const container = document.getElementById("p-timeline");
    if (!container) return;
    container.innerHTML = `<p style="font-size:var(--text-sm);color:var(--text-muted)">Loading…</p>`;
    try {
      const events = await HN.api.get(`/api/employees/${empId}/events`);
      if (!events.length) {
        container.innerHTML = `<p style="font-size:var(--text-sm);color:var(--text-muted)">No events yet. Add the first one.</p>`;
        return;
      }
      const iconMap = {
        joined:"domain",left:"logout",promotion:"trending_up",connected:"add_link",
        achievement:"emoji_events",meeting:"calendar_today",intel:"search",note:"sticky_note_2"
      };
      const colorMap = {
        joined:"var(--secondary)",left:"var(--tertiary)",promotion:"var(--primary)",
        connected:"var(--secondary)",achievement:"#b49632",meeting:"var(--text-muted)",
        intel:"var(--tertiary)",note:"var(--text-muted)"
      };
      container.innerHTML = events.map(ev => {
        const icon  = iconMap[ev.event_type]  || "circle";
        const color = colorMap[ev.event_type] || "var(--text-muted)";
        const date  = ev.occurred_at ? new Date(ev.occurred_at).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"}) : "";
        return `
          <div style="display:flex;gap:var(--sp-3);padding:var(--sp-3) 0;border-bottom:1px solid var(--outline-variant);position:relative">
            <div style="width:28px;height:28px;border-radius:9999px;background:var(--surface-mid);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px">
              <span class="material-symbols-outlined" style="font-size:14px;color:${color}">${icon}</span>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:var(--text-sm);color:var(--text-primary);line-height:1.4">${ev.description}</div>
              <div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:2px">${date}</div>
            </div>
            <button onclick="deleteEvent(${ev.id},${empId})" style="border:none;background:none;cursor:pointer;color:var(--text-muted);opacity:0;transition:opacity 150ms;padding:4px;flex-shrink:0" class="ev-del-btn">
              <span class="material-symbols-outlined" style="font-size:14px">close</span>
            </button>
          </div>`;
      }).join("");
      // Show delete on hover
      container.querySelectorAll("div[style*='border-bottom']").forEach(row => {
        const btn = row.querySelector(".ev-del-btn");
        row.addEventListener("mouseenter", () => btn && (btn.style.opacity="1"));
        row.addEventListener("mouseleave", () => btn && (btn.style.opacity="0"));
      });
    } catch(e) {
      container.innerHTML = `<p style="font-size:var(--text-sm);color:var(--text-muted)">Could not load timeline.</p>`;
    }
  }

  window.deleteEvent = async function(evId, empId) {
    try {
      await HN.api.del(`/api/events/${evId}`);
      loadTimeline(empId);
    } catch(e) { HN.toast("Could not delete event"); }
  };

  /* ══════════════════════════════════════════
     ADD EVENT MODAL
  ══════════════════════════════════════════ */
  const eventModal  = document.getElementById("event-modal");
  const eventForm   = document.getElementById("event-form");
  const eventCancel = document.getElementById("event-cancel");

  function openEventModal(empId) {
    document.getElementById("event-emp-id").value = empId;
    document.getElementById("event-desc").value   = "";
    document.getElementById("event-date").value   = new Date().toISOString().slice(0,10);
    eventModal.classList.add("open");
    setTimeout(()=>document.getElementById("event-desc").focus(),150);
  }

  function closeEventModal() { eventModal.classList.remove("open"); }
  if (eventCancel) eventCancel.addEventListener("click", closeEventModal);

  if (eventForm) eventForm.addEventListener("submit", async e => {
    e.preventDefault();
    const empId = document.getElementById("event-emp-id").value;
    const desc  = document.getElementById("event-desc").value.trim();
    if (!desc) { HN.toast("Description is required"); return; }
    const btn = eventForm.querySelector("[type=submit]"); btn.disabled=true;
    try {
      await HN.api.post(`/api/employees/${empId}/events`, {
        event_type:  document.getElementById("event-type").value,
        description: desc,
        occurred_at: document.getElementById("event-date").value || null,
      });
      HN.toast("Event added to timeline");
      closeEventModal();
      loadTimeline(parseInt(empId));
      switchTab("timeline");
    } catch(err) { HN.toast(err.message); }
    finally { btn.disabled=false; btn.innerHTML='<span class="material-symbols-outlined">add</span>Add to Timeline'; }
  });

  /* ══════════════════════════════════════════
     EDIT CONNECTION MODAL
  ══════════════════════════════════════════ */
  const editConnModal  = document.getElementById("edit-conn-modal");
  const editConnForm   = document.getElementById("edit-conn-form");
  const editConnCancel = document.getElementById("edit-conn-cancel");

  // Strength slider label
  const strengthSlider = document.getElementById("edit-conn-strength");
  const strengthVal    = document.getElementById("strength-val");
  if (strengthSlider) {
    strengthSlider.addEventListener("input", () => {
      const v = parseFloat(strengthSlider.value);
      strengthVal.textContent = v >= 0.8 ? "Strong" : v >= 0.5 ? "Medium" : "Weak";
    });
  }

  function openEditConnModal(rel, fromNode) {
    document.getElementById("edit-conn-id").value       = rel.id;
    document.getElementById("edit-conn-type").value     = rel.type;
    document.getElementById("edit-conn-label").value    = rel.label || "";
    document.getElementById("edit-conn-rlabel").value   = rel.reverse_label || "";
    document.getElementById("edit-conn-date").value     = rel.started_date || "";
    document.getElementById("edit-conn-strength").value = rel.strength || 1.0;
    const v = parseFloat(rel.strength||1.0);
    if (strengthVal) strengthVal.textContent = v>=0.8?"Strong":v>=0.5?"Medium":"Weak";

    // Show people names in header
    const other = G.nodes.find(n=>n.id===(rel.source===fromNode.id?rel.target:rel.source));
    document.getElementById("edit-conn-from-name").textContent       = fromNode.name;
    document.getElementById("edit-conn-from-label-preview").textContent = rel.source===fromNode.id ? (rel.label||"→") : (rel.reverse_label||"←");
    document.getElementById("edit-conn-to-name").textContent         = other ? other.name : "—";
    document.getElementById("edit-conn-to-label-preview").textContent   = rel.source===fromNode.id ? (rel.reverse_label||"←") : (rel.label||"→");

    editConnModal.classList.add("open");
  }

  function closeEditConnModal() { editConnModal.classList.remove("open"); }
  if (editConnCancel) editConnCancel.addEventListener("click", closeEditConnModal);

  if (editConnForm) editConnForm.addEventListener("submit", async e => {
    e.preventDefault();
    const id  = document.getElementById("edit-conn-id").value;
    const btn = editConnForm.querySelector("[type=submit]"); btn.disabled=true;
    try {
      await HN.api.put(`/api/relationships/${id}`, {
        connection_type: document.getElementById("edit-conn-type").value,
        label:           document.getElementById("edit-conn-label").value.trim(),
        reverse_label:   document.getElementById("edit-conn-rlabel").value.trim(),
        started_date:    document.getElementById("edit-conn-date").value || null,
        strength:        parseFloat(document.getElementById("edit-conn-strength").value),
      });
      HN.toast("Connection updated");
      closeEditConnModal();
      G = await HN.api.get("/api/graph");
      if (sim) sim.stop(); render(G);
      if (currentPanelNode) fillPanel({...currentPanelNode});
    } catch(err) { HN.toast(err.message); }
    finally { btn.disabled=false; btn.innerHTML='<span class="material-symbols-outlined">save</span>Save Changes'; }
  });

  /* ══════════════════════════════════════════
     ORG CHART — proper top-down hierarchy tree
  ══════════════════════════════════════════ */
  async function openOrg(companyId) {
    orgOverlay.classList.add("open");
    try {
      const data = await HN.api.get(`/api/companies/${companyId}/org`);
      renderOrgTree(data);
    } catch(e) { HN.toast("Could not load org chart."); }
  }

  function renderOrgTree(data) {
    const { company, nodes, edges } = data;
    const col = company.color;

    document.getElementById("org-title").textContent = company.name;
    document.getElementById("org-sub").textContent   = company.industry || "";
    document.getElementById("org-dot").style.background = col.stroke;
    document.getElementById("org-stats").innerHTML = `
      <div class="stat-pill"><span class="stat-n">${nodes.length}</span><span class="stat-l">People</span></div>
      <div class="stat-pill"><span class="stat-n">${edges.filter(e=>e.type==="formal").length}</span><span class="stat-l">Reports</span></div>
      ${company.founded?`<div class="stat-pill"><span class="stat-n">${company.founded}</span><span class="stat-l">Founded</span></div>`:""}
    `;

    const wrap = document.getElementById("org-svg-wrap");
    const W = wrap.clientWidth || 800;
    const H = wrap.clientHeight || 500;
    const orgSvg = d3.select("#org-svg").attr("width",W).attr("height",H);
    orgSvg.selectAll("*").remove();

    // Build hierarchy from formal edges
    const formalEdges = edges.filter(e => e.type === "formal");
    const nodeMap     = new Map(nodes.map(n=>[n.id,{...n}]));

    // Find roots (nodes with no incoming formal edge)
    const hasParent = new Set(formalEdges.map(e=>e.target));
    const roots     = nodes.filter(n=>!hasParent.has(n.id));

    // Build adjacency list
    const children = {};
    formalEdges.forEach(e => {
      if (!children[e.source]) children[e.source]=[];
      children[e.source].push(e.target);
    });

    // Create d3 hierarchy
    function buildTree(nodeId) {
      const n = nodeMap.get(nodeId);
      if (!n) return null;
      const kids = (children[nodeId]||[]).map(buildTree).filter(Boolean);
      return { data: n, children: kids.length ? kids : undefined };
    }

    // Single or multi-root
    let rootData;
    if (roots.length === 1) {
      rootData = buildTree(roots[0].id);
    } else if (roots.length > 1) {
      // Virtual root
      rootData = { data: { id:0, name: company.name, title:"", tier:"executive", virtual:true }, children: roots.map(r=>buildTree(r.id)).filter(Boolean) };
    } else {
      // Fallback: use executive tier as root
      const exec = nodes.find(n=>n.tier==="executive") || nodes[0];
      rootData = buildTree(exec.id);
    }

    if (!rootData) { orgSvg.append("text").attr("x",W/2).attr("y",H/2).attr("text-anchor","middle").attr("fill","var(--text-muted)").text("No hierarchy data yet."); return; }

    const PAD   = 60;
    const NODE_W = 160;
    const NODE_H = 70;

    const tree = d3.tree().nodeSize([NODE_W, NODE_H + 40]);
    const root = d3.hierarchy(rootData, d => d.children);
    tree(root);

    // Centre the tree
    const xs = root.descendants().map(d=>d.x);
    const ys = root.descendants().map(d=>d.y);
    const minX=Math.min(...xs)-NODE_W/2, maxX=Math.max(...xs)+NODE_W/2;
    const minY=Math.min(...ys)-NODE_H/2, maxY=Math.max(...ys)+NODE_H/2;
    const treeW=maxX-minX, treeH=maxY-minY;
    const sx=Math.min((W-PAD*2)/treeW, 1);
    const sy=Math.min((H-PAD*2)/treeH, 1);
    const sc=Math.min(sx,sy,.95);
    const tx=W/2-(minX+treeW/2)*sc, ty=PAD-(minY)*sc;

    const orgZoom = d3.zoom().scaleExtent([0.2,2.5]).on("zoom",e=>g.attr("transform",e.transform));
    orgSvg.call(orgZoom);

    const g = orgSvg.append("g").attr("transform",`translate(${tx},${ty}) scale(${sc})`);

    // Draw links (elegant curves)
    g.append("g").attr("class","org-links").selectAll("path")
      .data(root.links()).enter().append("path")
        .attr("fill","none").attr("stroke",col.stroke).attr("stroke-width",2).attr("stroke-opacity",.5)
        .attr("d", d3.linkVertical().x(d=>d.x).y(d=>d.y + NODE_H/2));

    // Draw nodes as rounded cards
    const nodeG = g.append("g").selectAll("g.onode")
      .data(root.descendants()).enter()
      .append("g").attr("class","onode")
      .attr("transform", d=>`translate(${d.x - NODE_W/2},${d.y})`)
      .style("cursor","pointer")
      .on("click",(event,d)=>{
        if (d.data.data.virtual) return;
        event.stopPropagation();
        closeOrgModal();
        fillPanel({...d.data.data});
        openPanel();
      });

    // Card background
    const tierFill  = { executive: col.stroke, manager: "rgba(0,107,95,0.12)", contributor: "var(--surface-card)" };
    const tierStroke= { executive: col.stroke, manager: col.stroke, contributor: col.stroke };
    const tierText  = { executive: "#fff", manager: col.label, contributor: "var(--text-primary)" };

    nodeG.append("rect")
      .attr("width", NODE_W).attr("height", NODE_H)
      .attr("rx", 10).attr("ry", 10)
      .attr("fill",     d => tierFill[d.data.data.tier]  || "var(--surface-card)")
      .attr("stroke",   d => tierStroke[d.data.data.tier]|| col.stroke)
      .attr("stroke-width", 1.5)
      .attr("filter","drop-shadow(0 3px 8px rgba(19,27,46,0.10))")
      .on("mouseenter",function(){ d3.select(this).transition().duration(120).attr("filter","drop-shadow(0 6px 16px rgba(129,39,207,0.20))"); })
      .on("mouseleave",function(){ d3.select(this).transition().duration(180).attr("filter","drop-shadow(0 3px 8px rgba(19,27,46,0.10))"); });

    // Avatar circle on left
    nodeG.each(function(d) {
      if (d.data.data.virtual) return;
      const grp = d3.select(this);
      grp.append("circle").attr("cx",28).attr("cy",NODE_H/2).attr("r",18)
        .attr("fill",d.data.data.tier==="executive"?col.stroke:col.fill.replace("0.07","0.35"))
        .attr("stroke",col.stroke).attr("stroke-width",1.5);
      if (d.data.data.image) {
        const clipId = `orgc-${d.data.data.id}`;
        g.select("defs") || orgSvg.append("defs");
        orgSvg.select("defs").append("clipPath").attr("id",clipId).append("circle").attr("r",18);
        grp.append("image").attr("href",d.data.data.image)
          .attr("x",10).attr("y",NODE_H/2-18).attr("width",36).attr("height",36)
          .attr("clip-path",`url(#${clipId})`)
          .attr("transform",`translate(0,0)`)
          .attr("preserveAspectRatio","xMidYMid slice");
      } else {
        grp.append("text").attr("x",28).attr("y",NODE_H/2).attr("dy","0.35em")
          .attr("text-anchor","middle").attr("font-family","'Manrope',sans-serif")
          .attr("font-size",11).attr("font-weight","700")
          .attr("fill",d.data.data.tier==="executive"?"#fff":col.label)
          .attr("pointer-events","none")
          .text(HN.initials(d.data.data.name));
      }
    });

    // Name text
    nodeG.append("text")
      .attr("x", 54).attr("y", NODE_H/2 - 8)
      .attr("font-family","'Manrope',sans-serif").attr("font-size",12).attr("font-weight","700")
      .attr("fill", d=>tierText[d.data.data.tier]||"var(--text-primary)")
      .attr("pointer-events","none")
      .text(d => d.data.data.virtual ? "" : d.data.data.name);

    // Title text
    nodeG.append("text")
      .attr("x", 54).attr("y", NODE_H/2 + 10)
      .attr("font-family","'DM Sans',sans-serif").attr("font-size",10)
      .attr("fill", d => d.data.data.tier==="executive"?"rgba(255,255,255,0.8)":col.label)
      .attr("pointer-events","none")
      .text(d => d.data.data.virtual ? "" : d.data.data.title);

    // Dept badge
    nodeG.filter(d=>!d.data.data.virtual).append("text")
      .attr("x", 54).attr("y", NODE_H - 10)
      .attr("font-family","'DM Sans',sans-serif").attr("font-size",9).attr("font-weight","600")
      .attr("fill", d => d.data.data.tier==="executive"?"rgba(255,255,255,0.6)":"var(--text-muted)")
      .attr("pointer-events","none")
      .text(d => d.data.data.department);

    // Informal connections as dashed lines (below cards)
    const informalE = edges.filter(e=>e.type==="informal");
    informalE.forEach(e => {
      const sn = root.descendants().find(d=>d.data.data.id===e.source);
      const tn = root.descendants().find(d=>d.data.data.id===e.target);
      if (!sn||!tn) return;
      g.insert("line","g").attr("class","inf-line")
        .attr("x1",sn.x).attr("y1",sn.y+NODE_H/2)
        .attr("x2",tn.x).attr("y2",tn.y+NODE_H/2)
        .attr("stroke",col.stroke).attr("stroke-width",1.5)
        .attr("stroke-dasharray","5 4").attr("stroke-opacity",.4);
    });
  }

  function closeOrgModal() { orgOverlay.classList.remove("open"); }
  orgClose.addEventListener("click", closeOrgModal);
  // org modal — close only via X/escape

  /* ── Zoom controls ───────────────────────── */
  document.getElementById("zoom-in") .addEventListener("click",()=>d3.select(svg).transition().duration(260).call(zoom.scaleBy,1.4));
  document.getElementById("zoom-out").addEventListener("click",()=>d3.select(svg).transition().duration(260).call(zoom.scaleBy,0.72));
  document.getElementById("zoom-fit").addEventListener("click",()=>{ const W=svg.clientWidth,H=svg.clientHeight; d3.select(svg).transition().duration(480).call(zoom.transform,d3.zoomIdentity.translate(W/2,H/2).scale(0.82)); });

  /* ── Search — zero lag using rAF + CSS class ── */
  let _searchRaf = null;
  searchInput.addEventListener("input", e => {
    const q = e.target.value.toLowerCase().trim();
    if (_searchRaf) cancelAnimationFrame(_searchRaf);
    _searchRaf = requestAnimationFrame(() => {
      if (!nodeLayer) return;
      nodeLayer.selectAll("g.node").style("opacity", function(d) {
        return !q || d.name.toLowerCase().includes(q) || d.title.toLowerCase().includes(q) ? 1 : 0.1;
      });
    });
  });

  /* ── Add person modal ────────────────────── */
  addPersonBtn.addEventListener("click",()=>addModal.classList.add("open"));
  function closeAdd(){ addModal.classList.remove("open"); addForm.reset(); uploadPrev.style.display="none"; uploadPh.style.display="block"; }
  addCancel.addEventListener("click",closeAdd);
  // add modal — close only via cancel/escape
  fileInput.addEventListener("change",e=>{
    const f=e.target.files[0]; if(!f) return;
    const r=new FileReader(); r.onload=ev=>{ uploadPrev.src=ev.target.result; uploadPrev.style.display="block"; uploadPh.style.display="none"; }; r.readAsDataURL(f);
  });
  addForm.addEventListener("submit",async e=>{
    e.preventDefault();
    const btn=addForm.querySelector("[type=submit]"); btn.disabled=true; btn.textContent="Adding…";
    try {
      const res=await fetch("/api/employees",{method:"POST",body:new FormData(addForm)});
      if(!res.ok) throw new Error((await res.json()).error||"Error");
      const emp=await res.json(); HN.toast(`✅  ${emp.name} added`); closeAdd(); await load();
      
      // Apply bloop entrance animation to new node
      if (HNFeatures && HNFeatures.bloopEntrance) {
        const newNodeCircle = nodeLayer.selectAll("circle").filter(d => d.id === emp.id).node();
        if (newNodeCircle) {
          await HNFeatures.bloopEntrance(newNodeCircle, 0);
        }
      }
    } catch(err){ HN.toast(`⚠️  ${err.message}`); }
    finally{ btn.disabled=false; btn.innerHTML='<span class="material-symbols-outlined">add_circle</span>Add to Network'; }
  });

  /* ══════════════════════════════════════════
     RIGHT-CLICK CONTEXT MENU
  ══════════════════════════════════════════ */
  const ctxMenu   = document.getElementById("ctx-menu");
  let ctxNode     = null; // the node that was right-clicked

  // Show menu on right-click of a node
  function attachContextMenu(nodeElems) {
    nodeElems.on("contextmenu", function(event, d) {
      event.preventDefault();
      event.stopPropagation();
      ctxNode = d;

      // Populate header
      document.getElementById("ctx-name").textContent  = d.name;
      document.getElementById("ctx-title").textContent = d.title;

      // Show/hide org chart item based on whether person has a company
      document.getElementById("ctx-org-chart").style.display = d.company_id ? "flex" : "none";

      // Position menu near cursor, keep it within viewport
      const x = Math.min(event.clientX, window.innerWidth  - 210);
      const y = Math.min(event.clientY, window.innerHeight - 220);
      ctxMenu.style.left    = x + "px";
      ctxMenu.style.top     = y + "px";
      ctxMenu.style.display = "block";
    });
  }

  // Hide context menu + focus picker on outside click (these ARE expected to close)
  document.addEventListener("click", () => {
    ctxMenu.style.display = "none";
    if (focusPicker) focusPicker.style.display = "none";
  });

  // Escape — close whichever modal is open
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    ctxMenu.style.display = "none";
    if (focusPicker)   focusPicker.style.display = "none";
    if (focusActive)   exitFocusMode();
    if (orgOverlay    && orgOverlay.classList.contains("open"))        closeOrgModal();
    if (connectModal  && connectModal.classList.contains("open"))      closeConnectModal();
    if (addModal      && addModal.classList.contains("open"))          closeAdd();
    if (editConnModal && editConnModal.classList.contains("open"))     closeEditConnModal();
    if (eventModal    && eventModal.classList.contains("open"))        closeEventModal();
    const editModal = document.getElementById("edit-modal");
    if (editModal     && editModal.classList.contains("open"))         editModal.classList.remove("open");
  });

  // Context menu actions
  document.getElementById("ctx-view-profile").addEventListener("click", () => {
    if (!ctxNode) return;
    fillPanel(ctxNode); openPanel();
  });

  document.getElementById("ctx-connect").addEventListener("click", () => {
    if (!ctxNode) return;
    openConnectModal(ctxNode);
  });

  document.getElementById("ctx-org-chart").addEventListener("click", () => {
    if (!ctxNode || !ctxNode.company_id) return;
    openOrg(ctxNode.company_id);
  });

  document.getElementById("ctx-message").addEventListener("click", () => {
    if (!ctxNode) return;
    ctxNode.email ? window.location.href = `mailto:${ctxNode.email}` : HN.toast("No email on record.");
  });

  /* ══════════════════════════════════════════
     EDIT PERSON MODAL
  ══════════════════════════════════════════ */
  const editModal   = document.getElementById("edit-modal");
  const editForm    = document.getElementById("edit-form");
  const editCancel  = document.getElementById("edit-cancel");
  const editCompany = document.getElementById("edit-company");

  function populateEditCompanySelect() {
    editCompany.innerHTML = '<option value="">— No company —</option>';
    G.companies.forEach(c => {
      const o = document.createElement("option");
      o.value = c.id; o.textContent = c.name;
      editCompany.appendChild(o);
    });
  }

  function openEditModal(node) {
    populateEditCompanySelect();
    document.getElementById("edit-id").value      = node.id;
    document.getElementById("edit-name").value    = node.name;
    document.getElementById("edit-title").value   = node.title;
    document.getElementById("edit-dept").value    = node.department;
    document.getElementById("edit-email").value   = node.email || "";
    document.getElementById("edit-persona").value = node.persona || "";
    document.getElementById("edit-hobbies").value = (node.hobbies || []).join(", ");
    document.getElementById("edit-tier").value    = node.tier || "contributor";
    editCompany.value = node.company_id || "";
    // Phase A new fields
    const tagsEl  = document.getElementById("edit-tags");
    const notesEl = document.getElementById("edit-notes");
    if (tagsEl)  tagsEl.value  = (node.tags  || []).join(", ");
    if (notesEl) notesEl.value = node.notes || "";

    const prev = document.getElementById("edit-avatar-preview");
    if (node.image) {
      prev.innerHTML = `<img src="${node.image}" style="width:100%;height:100%;object-fit:cover;" alt="${node.name}"/>`;
    } else {
      prev.textContent = HN.initials(node.name);
    }
    editModal.classList.add("open");
    setTimeout(() => document.getElementById("edit-name").focus(), 150);
  }

  function closeEditModal() { editModal.classList.remove("open"); }
  editCancel.addEventListener("click", closeEditModal);
  editModal.addEventListener("click", e => { if (e.target === editModal) closeEditModal(); });

  editForm.addEventListener("submit", async e => {
    e.preventDefault();
    const id  = document.getElementById("edit-id").value;
    const btn = document.getElementById("edit-submit");
    if (!id) return;

    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span>Saving…';

    const data = {
      name:                document.getElementById("edit-name").value.trim(),
      title:               document.getElementById("edit-title").value.trim(),
      department:          document.getElementById("edit-dept").value.trim(),
      email:               document.getElementById("edit-email").value.trim() || null,
      persona_description: document.getElementById("edit-persona").value.trim() || null,
      hobbies:             document.getElementById("edit-hobbies").value.trim() || null,
      node_tier:           document.getElementById("edit-tier").value,
      company_id:          editCompany.value ? parseInt(editCompany.value) : null,
      tags:                document.getElementById("edit-tags")  ? document.getElementById("edit-tags").value.trim()  || null : null,
      notes:               document.getElementById("edit-notes") ? document.getElementById("edit-notes").value.trim() || null : null,
    };

    if (!data.name || !data.title || !data.department) {
      HN.toast("⚠️  Name, title and department are required.");
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined">save</span>Save Changes';
      return;
    }

    try {
      await HN.api.put(`/api/employees/${id}`, data);
      HN.toast(`✅  ${data.name} updated`);
      closeEditModal();

      // Reload graph so changes are reflected immediately
      G = await HN.api.get("/api/graph");
      if (sim) sim.stop();
      render(G);

      // Refresh panel if this person's panel is open
      if (currentPanelNode && currentPanelNode.id === parseInt(id)) {
        const updated = G.nodes.find(n => n.id === parseInt(id));
        if (updated) { currentPanelNode = updated; fillPanel(updated); }
      }

    } catch(err) {
      HN.toast(`⚠️  ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined">save</span>Save Changes';
    }
  });

  // Wire context menu edit button
  document.getElementById("ctx-edit").addEventListener("click", () => {
    if (!ctxNode) return;
    openEditModal(ctxNode);
  });

  // Patch render to attach context menu after nodes are created
  const _origRender = render;
  // We attach context menu inside render — patched below at attachContextMenu call site

  /* ══════════════════════════════════════════
     CONNECT PEOPLE MODAL
  ══════════════════════════════════════════ */
  const connectModal  = document.getElementById("connect-modal");
  const connSearch    = document.getElementById("conn-search");
  const connResults   = document.getElementById("conn-search-results");
  const connToSel     = document.getElementById("conn-to-selected");
  const connToName    = document.getElementById("conn-to-name");
  const connLabel     = document.getElementById("conn-label");
  const connSubmit    = document.getElementById("conn-submit");
  const connCancel    = document.getElementById("conn-cancel");

  let connFromNode = null; // person we're connecting FROM
  let connToNode   = null; // person we're connecting TO

  function openConnectModal(fromNode) {
    connFromNode = fromNode;
    connToNode   = null;

    // Fill "from" section
    document.getElementById("conn-from-name").textContent  = fromNode.name;
    document.getElementById("conn-from-title").textContent = fromNode.title;
    const fromAvatar = document.getElementById("conn-from-avatar");
    if (fromNode.image) {
      fromAvatar.innerHTML = `<img src="${fromNode.image}" style="width:100%;height:100%;object-fit:cover;" alt="${fromNode.name}"/>`;
    } else {
      fromAvatar.textContent = HN.initials(fromNode.name);
    }

    // Reset form
    connSearch.value      = "";
    connLabel.value       = "";
    connResults.style.display = "none";
    connToSel.style.display   = "none";
    document.querySelector('input[name="conn-type"][value="formal"]').checked = true;
    document.querySelectorAll(".conn-type-opt").forEach(o => o.querySelector("input").dispatchEvent(new Event("change")));

    connectModal.classList.add("open");
    setTimeout(() => connSearch.focus(), 200);
  }

  function closeConnectModal() {
    connectModal.classList.remove("open");
    connFromNode = null;
    connToNode   = null;
  }

  connCancel.addEventListener("click", closeConnectModal);
  // connect modal — close only via cancel/escape

  // Search people to connect TO
  connSearch.addEventListener("input", HN.debounce(e => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) { connResults.style.display = "none"; return; }

    const matches = G.nodes.filter(n =>
      n.id !== (connFromNode ? connFromNode.id : -1) &&
      (n.name.toLowerCase().includes(q) || n.title.toLowerCase().includes(q))
    ).slice(0, 8);

    if (!matches.length) {
      connResults.style.display = "none";
      return;
    }

    connResults.innerHTML = matches.map(n => {
      const co = n.company_id ? G.companies.find(c => c.id === n.company_id) : null;
      const avatarHTML = n.image
        ? `<img src="${n.image}" style="width:100%;height:100%;object-fit:cover;" alt="${n.name}"/>`
        : HN.initials(n.name);
      return `
        <div class="conn-search-item" data-id="${n.id}">
          <div class="conn-search-avatar">${avatarHTML}</div>
          <div>
            <div style="font-weight:600;font-size:var(--text-sm);color:var(--text-primary)">${n.name}</div>
            <div style="font-size:var(--text-xs);color:var(--text-muted)">${n.title}${co ? ` · ${co.name}` : ""}</div>
          </div>
        </div>`;
    }).join("");
    connResults.style.display = "block";

    // Click to select
    connResults.querySelectorAll(".conn-search-item").forEach(item => {
      item.addEventListener("click", () => {
        const id   = parseInt(item.dataset.id);
        connToNode = G.nodes.find(n => n.id === id);
        if (!connToNode) return;

        connToName.textContent    = connToNode.name;
        connToSel.style.display   = "flex";
        connResults.style.display = "none";
        connSearch.value          = "";
      });
    });
  }, 120));

  // Clear selected "to" person
  window.clearConnTo = function() {
    connToNode = null;
    connToSel.style.display = "none";
    connSearch.value = "";
    connSearch.focus();
  };

  // Submit connection
  connSubmit.addEventListener("click", async () => {
    if (!connFromNode) { HN.toast("⚠️  No source person selected."); return; }
    if (!connToNode)   { HN.toast("⚠️  Please select who to connect to."); return; }
    if (connFromNode.id === connToNode.id) { HN.toast("⚠️  Can't connect someone to themselves."); return; }

    const type  = document.querySelector('input[name="conn-type"]:checked')?.value || "formal";
    const label = connLabel.value.trim();

    connSubmit.disabled   = true;
    connSubmit.textContent = "Connecting…";

    try {
      await HN.api.post("/api/relationships", {
        source_id:       connFromNode.id,
        target_id:       connToNode.id,
        connection_type: type,
        label:           label,
        reverse_label:   document.getElementById("conn-rlabel") ? document.getElementById("conn-rlabel").value.trim() : "",
        started_date:    document.getElementById("conn-started") ? document.getElementById("conn-started").value || null : null,
        strength:        1.0,
      });

      HN.toast(`✅  ${connFromNode.name} → ${connToNode.name} connected as ${type.replace("_", " ")}`);
      closeConnectModal();

      // Reload graph so new line appears instantly
      G = await HN.api.get("/api/graph");
      if (sim) sim.stop();
      render(G);

    } catch(err) {
      HN.toast(`⚠️  ${err.message}`);
    } finally {
      connSubmit.disabled  = false;
      connSubmit.innerHTML = '<span class="material-symbols-outlined">add_link</span>Create Connection';
    }
  });

  /* ══════════════════════════════════════════
     FOCUS MODE — double-click node
     Shows only selected connection type for
     that person; dims everything else.
  ══════════════════════════════════════════ */
  focusPicker   = document.getElementById("focus-picker");
  focusExitPill = document.getElementById("focus-exit-pill");

  const TYPE_LABELS = {
    formal:        "Reporting Lines",
    informal:      "Collaboration",
    cross_company: "Cross-Company",
    all:           "All Connections",
  };

  function showFocusPicker(event, d) {
    focusNode = d;
    document.getElementById("focus-picker-name").textContent = d.name;

    // Position near cursor, keep in viewport
    const x = Math.min(event.clientX + 12, window.innerWidth  - 230);
    const y = Math.min(event.clientY - 10, window.innerHeight - 280);
    focusPicker.style.left    = x + "px";
    focusPicker.style.top     = y + "px";
    focusPicker.style.display = "block";
  }

  // Hide picker on outside click
  document.addEventListener("click", e => {
    if (!focusPicker.contains(e.target)) focusPicker.style.display = "none";
  });

  // Pick a connection type → enter focus mode
  document.querySelectorAll(".focus-pick-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const type = btn.dataset.type;
      focusPicker.style.display = "none";
      if (!focusNode) return;
      enterFocusMode(focusNode, type);
    });
  });

  function enterFocusMode(node, type) {
    focusActive = true;

    // All edges of this type
    let relevantEdges;
    if (type === "all") {
      relevantEdges = [
        ...G.edges.formal,
        ...G.edges.informal,
        ...G.edges.cross_company,
      ];
    } else {
      relevantEdges = G.edges[type] || [];
    }

    // IDs connected to focusNode via relevant edges
    const connectedIds = new Set([node.id]);
    relevantEdges.forEach(e => {
      if (e.source === node.id) connectedIds.add(e.target);
      if (e.target === node.id) connectedIds.add(e.source);
    });

    // ── Dim / highlight nodes ─────────────────
    nodeLayer.selectAll("g.node").each(function(d) {
      const isConnected = connectedIds.has(d.id);
      const isFocus     = d.id === node.id;
      d3.select(this).transition().duration(280)
        .style("opacity", isConnected ? 1 : 0.06);

      // Pulse ring on the focus node
      if (isFocus) {
        d3.select(this).select(".nglow")
          .transition().duration(300).attr("opacity", 0.6);
      }
    });

    // ── Dim / highlight edges ─────────────────
    // Internal edges
    d3.select(svg).selectAll(".edges path").each(function(d) {
      const isThisType  = type === "all" || d.type === type;
      const isConnected = (d.source.id === node.id || d.target.id === node.id) && isThisType;
      d3.select(this).transition().duration(280)
        .attr("stroke-opacity", isConnected ? 1 : 0.03)
        .attr("stroke-width",   isConnected ? (d.type === "formal" ? 3.5 : 2.8) : (d.type === "formal" ? 2.2 : 1.8));
    });

    // Cross-company edges — reveal only relevant ones
    d3.select(svg).selectAll(".cross path").each(function(d) {
      const isThisType  = type === "all" || type === "cross_company";
      const isConnected = (d.source.id === node.id || d.target.id === node.id) && isThisType;
      // Always reveal connected ones; hide unconnected (keep at 0)
      d3.select(this).transition().duration(280)
        .attr("stroke-opacity", isConnected ? 0.9 : 0);
    });

    // ── Dim company bubbles ───────────────────
    // Companies that have at least one connected person stay visible
    const connectedCompanies = new Set(
      G.nodes.filter(n => connectedIds.has(n.id) && n.company_id).map(n => n.company_id)
    );
    d3.select(svg).selectAll(".co-group").each(function() {
      const cid = parseInt(d3.select(this).attr("data-id"));
      d3.select(this).transition().duration(280)
        .style("opacity", connectedCompanies.has(cid) ? 1 : 0.06);
    });

    // ── Show exit pill ────────────────────────
    const label = TYPE_LABELS[type] || type;
    document.getElementById("focus-exit-label").textContent = `Focus: ${label} — ${node.name}`;
    focusExitPill.style.display = "flex";
  }

  function exitFocusMode() {
    if (!focusActive) return;
    focusActive = false;
    focusNode   = null;

    // Restore all nodes
    nodeLayer.selectAll("g.node").transition().duration(250).style("opacity", 1);
    nodeLayer.selectAll(".nglow").transition().duration(250).attr("opacity", 0);

    // Restore internal edges
    d3.select(svg).selectAll(".edges path").transition().duration(250)
      .attr("stroke-opacity", 0.55)
      .attr("stroke-width", function(d) {
        const base = d && d.type === "formal" ? 2.2 : 1.8;
        return base * (d && d.strength ? d.strength : 1.0);
      });

    // Cross-company lines go back to HIDDEN (0) not visible
    d3.select(svg).selectAll(".cross path").transition().duration(250)
      .attr("stroke-opacity", 0);

    // Restore company bubbles
    d3.select(svg).selectAll(".co-group").transition().duration(250).style("opacity", 1);

    // Reapply tags filter if active
    if (activeTags && activeTags.size) applyTagsFilter();

    // Hide exit pill
    if (focusExitPill) focusExitPill.style.display = "none";
  }

  // Exit focus on pill click
  focusExitPill.addEventListener("click", exitFocusMode);

  // Focus exits via pill or Escape only — not on canvas click

  // Exit focus on Escape
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && focusActive) exitFocusMode();
  });

  /* ══════════════════════════════════════════
     TAGS FILTER — filter nodes by tag
  ══════════════════════════════════════════ */
  let activeTags = new Set();

  async function loadTagsBar() {
    try {
      const tags = await HN.api.get("/api/tags");
      const chipsEl = document.getElementById("tags-chips");
      const clearBtn = document.getElementById("tags-clear");
      if (!chipsEl || !tags.length) return;

      chipsEl.innerHTML = tags.map(t => `
        <button class="tag-filter-chip" data-tag="${t}" style="
          padding:3px var(--sp-3);border:1.5px solid var(--outline-variant);
          border-radius:var(--radius-full);background:transparent;
          font-size:var(--text-xs);font-weight:600;color:var(--text-secondary);
          cursor:pointer;transition:all 120ms;white-space:nowrap;
        ">#${t}</button>`).join("");

      chipsEl.querySelectorAll(".tag-filter-chip").forEach(chip => {
        chip.addEventListener("click", () => {
          const tag = chip.dataset.tag;
          if (activeTags.has(tag)) {
            activeTags.delete(tag);
            chip.style.background = "transparent";
            chip.style.borderColor = "var(--outline-variant)";
            chip.style.color = "var(--text-secondary)";
          } else {
            activeTags.add(tag);
            chip.style.background = "var(--primary-muted)";
            chip.style.borderColor = "var(--primary)";
            chip.style.color = "var(--primary)";
          }
          clearBtn.style.display = activeTags.size ? "block" : "none";
          applyTagsFilter();
        });
      });

      clearBtn.addEventListener("click", () => {
        activeTags.clear();
        chipsEl.querySelectorAll(".tag-filter-chip").forEach(c => {
          c.style.background = "transparent";
          c.style.borderColor = "var(--outline-variant)";
          c.style.color = "var(--text-secondary)";
        });
        clearBtn.style.display = "none";
        applyTagsFilter();
      });
    } catch(e) { /* tags bar is optional */ }
  }

  function applyTagsFilter() {
    if (!nodeLayer) return;
    if (!activeTags.size) {
      nodeLayer.selectAll("g.node").style("opacity", 1);
      return;
    }
    nodeLayer.selectAll("g.node").style("opacity", function(d) {
      const nodeTags = d.tags || [];
      return nodeTags.some(t => activeTags.has(t)) ? 1 : 0.08;
    });
  }

  /* ══════════════════════════════════════════
     IMAGE CROP MODAL
     Canvas-based circular crop with drag + zoom
  ══════════════════════════════════════════ */
  (function() {
    const cropModal   = document.getElementById("crop-modal");
    const cropImage   = document.getElementById("crop-image");
    const cropCanvas  = document.getElementById("crop-canvas");
    const cropZoom    = document.getElementById("crop-zoom");
    const cropConfirm = document.getElementById("crop-confirm");
    const cropCancel  = document.getElementById("crop-cancel");
    const cropContainer = document.getElementById("crop-container");

    if (!cropModal) return;

    let cropState = { scale:1, offsetX:0, offsetY:0, dragStartX:0, dragStartY:0, isDragging:false, callback:null };

    // Public API — call this instead of showing file input directly
    window.openCropModal = function(file, onConfirm) {
      cropState.callback = onConfirm;
      const url = URL.createObjectURL(file);
      cropImage.onload = () => {
        // Fit image to container
        const cw = 300, ch = 300;
        const scale = Math.max(cw / cropImage.naturalWidth, ch / cropImage.naturalHeight);
        cropState.scale   = scale;
        cropState.offsetX = (cw - cropImage.naturalWidth  * scale) / 2;
        cropState.offsetY = (ch - cropImage.naturalHeight * scale) / 2;
        updateCropTransform();
        cropZoom.value = scale;
      };
      cropImage.src = url;
      cropModal.classList.add("open");
    };

    function updateCropTransform() {
      cropImage.style.transform = `translate(${cropState.offsetX}px,${cropState.offsetY}px) scale(${cropState.scale})`;
      cropImage.style.transformOrigin = "0 0";
      cropImage.style.width  = cropImage.naturalWidth  + "px";
      cropImage.style.height = cropImage.naturalHeight + "px";
    }

    // Drag to reposition
    cropContainer.addEventListener("mousedown", e => {
      cropState.isDragging = true;
      cropState.dragStartX = e.clientX - cropState.offsetX;
      cropState.dragStartY = e.clientY - cropState.offsetY;
      cropContainer.style.cursor = "grabbing";
    });
    document.addEventListener("mousemove", e => {
      if (!cropState.isDragging) return;
      cropState.offsetX = e.clientX - cropState.dragStartX;
      cropState.offsetY = e.clientY - cropState.dragStartY;
      updateCropTransform();
    });
    document.addEventListener("mouseup", () => {
      cropState.isDragging = false;
      cropContainer.style.cursor = "move";
    });

    // Touch drag
    cropContainer.addEventListener("touchstart", e => {
      const t = e.touches[0];
      cropState.isDragging = true;
      cropState.dragStartX = t.clientX - cropState.offsetX;
      cropState.dragStartY = t.clientY - cropState.offsetY;
    }, {passive:true});
    cropContainer.addEventListener("touchmove", e => {
      if (!cropState.isDragging) return;
      const t = e.touches[0];
      cropState.offsetX = t.clientX - cropState.dragStartX;
      cropState.offsetY = t.clientY - cropState.dragStartY;
      updateCropTransform();
    }, {passive:true});
    cropContainer.addEventListener("touchend", () => { cropState.isDragging = false; });

    // Scroll to zoom
    cropContainer.addEventListener("wheel", e => {
      e.preventDefault();
      cropState.scale = Math.max(0.5, Math.min(3, cropState.scale - e.deltaY * 0.002));
      cropZoom.value = cropState.scale;
      updateCropTransform();
    }, {passive:false});

    // Slider zoom
    cropZoom.addEventListener("input", () => {
      cropState.scale = parseFloat(cropZoom.value);
      updateCropTransform();
    });

    // Confirm — render to canvas and export as blob
    cropConfirm.addEventListener("click", () => {
      const size = 300;
      cropCanvas.width  = size;
      cropCanvas.height = size;
      const ctx = cropCanvas.getContext("2d");
      ctx.save();
      ctx.beginPath();
      ctx.arc(size/2, size/2, size/2, 0, Math.PI*2);
      ctx.clip();
      ctx.drawImage(cropImage,
        cropState.offsetX, cropState.offsetY,
        cropImage.naturalWidth * cropState.scale,
        cropImage.naturalHeight * cropState.scale
      );
      ctx.restore();
      cropCanvas.toBlob(blob => {
        cropModal.classList.remove("open");
        if (cropState.callback) cropState.callback(blob);
      }, "image/jpeg", 0.92);
    });

    cropCancel.addEventListener("click", () => cropModal.classList.remove("open"));
  })();

  // Patch file inputs to go through crop modal
  function patchFileInputWithCrop(inputId, previewId, placeholderId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    // Remove existing listeners by cloning
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);
    newInput.addEventListener("change", e => {
      const file = e.target.files[0];
      if (!file) return;
      window.openCropModal(file, blob => {
        // Show preview
        const prev = document.getElementById(previewId);
        const ph   = document.getElementById(placeholderId);
        if (prev) { prev.src = URL.createObjectURL(blob); prev.style.display="block"; }
        if (ph)   ph.style.display = "none";
        // Store cropped blob on the input for form submission
        const croppedFile = new File([blob], "profile.jpg", {type:"image/jpeg"});
        const dt = new DataTransfer();
        dt.items.add(croppedFile);
        newInput.files = dt.files;
      });
      newInput.value = "";
    });
  }
  patchFileInputWithCrop("file-input", "upload-prev", "upload-ph");

  /* ══════════════════════════════════════════
     HAMBURGER MENU — mobile nav
  ══════════════════════════════════════════ */
  (function() {
    const hamburger = document.getElementById("hamburger-btn");
    const drawer    = document.getElementById("mobile-drawer");
    if (!hamburger || !drawer) return;
    hamburger.addEventListener("click", e => {
      e.stopPropagation();
      drawer.classList.toggle("open");
      hamburger.querySelector(".material-symbols-outlined").textContent =
        drawer.classList.contains("open") ? "close" : "menu";
    });
    // Close drawer when a link is tapped
    drawer.querySelectorAll("a").forEach(a => a.addEventListener("click", () => {
      drawer.classList.remove("open");
      hamburger.querySelector(".material-symbols-outlined").textContent = "menu";
    }));
  })();

  /* ══════════════════════════════════════════
     MOBILE TOUCH — pinch to zoom on graph
  ══════════════════════════════════════════ */
  (function() {
    let lastDist = null;
    svg.addEventListener("touchstart", e => {
      if (e.touches.length === 2) lastDist = null;
    }, {passive:true});
    svg.addEventListener("touchmove", e => {
      if (e.touches.length !== 2 || !zoom) return;
      const dx   = e.touches[0].clientX - e.touches[1].clientX;
      const dy   = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (lastDist !== null) {
        const ratio = dist / lastDist;
        d3.select(svg).call(zoom.scaleBy, ratio);
      }
      lastDist = dist;
    }, {passive:true});
  })();

  /* ── Boot ────────────────────────────────── */
  load();
  loadTagsBar();
  initLineToggles();
  let rt; window.addEventListener("resize",()=>{ clearTimeout(rt); rt=setTimeout(()=>{ if(sim) sim.stop(); render(G); },280); });

})();
