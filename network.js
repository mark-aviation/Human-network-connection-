/* ═══════════════════════════════════════════════════
   THE HUMAN NETWORK — network.js v3
   - No arrowheads
   - Wider node spacing (names always visible)
   - Wider company bubbles
   - Drag whole company cluster
   - Companies start far apart
   - Staggered node reveal
   - Hierarchy org chart (top-down tree)
   - Double-click bubble = org chart
═══════════════════════════════════════════════════ */
(function () {
  "use strict";

  const TIER_R = { executive: 38, manager: 30, contributor: 24 };
  const TIER_C = {
    executive:   { fill: "#8127cf", stroke: "#6900b3", text: "#fff" },
    manager:     { fill: "#006b5f", stroke: "#004d44", text: "#fff" },
    contributor: { fill: "#ffffff", stroke: "#8127cf", text: "#131b2e" },
  };

  let G = { nodes: [], companies: [], edges: { formal: [], informal: [], cross_company: [] } };
  let sim = null, zoom = null;

  /* ── DOM ─────────────────────────────────── */
  const svg         = document.getElementById("graph-svg");
  const canvas      = document.getElementById("graph-canvas");
  const panel       = document.getElementById("profile-panel");
  const panelClose  = document.getElementById("panel-close");
  const addPersonBtn= document.getElementById("add-person-btn");
  const addModal    = document.getElementById("add-modal");
  const addCancel   = document.getElementById("add-cancel");
  const addForm     = document.getElementById("add-form");
  const fileInput   = document.getElementById("file-input");
  const uploadPrev  = document.getElementById("upload-prev");
  const uploadPh    = document.getElementById("upload-ph");
  const coSelect    = document.getElementById("co-select");
  const searchInput = document.getElementById("search-input");
  const orgOverlay  = document.getElementById("org-overlay");
  const orgClose    = document.getElementById("org-close");
  const msgBtn      = document.getElementById("msg-btn");
  const orgBtn      = document.getElementById("org-btn");

  /* ── Load ────────────────────────────────── */
  async function load() {
    try {
      G = await HN.api.get("/api/graph");
      render(G);
      fillCoSelect(G.companies);
    } catch(e) { HN.toast("⚠️  Could not load network."); }
  }

  function fillCoSelect(cos) {
    coSelect.innerHTML = '<option value="">— No company —</option>';
    cos.forEach(c => { const o = document.createElement("option"); o.value = c.id; o.textContent = c.name; coSelect.appendChild(o); });
  }

  /* ── RENDER ──────────────────────────────── */
  function render(data) {
    const { nodes, companies, edges } = data;
    const W = canvas.clientWidth  || 900;
    const H = canvas.clientHeight || 600;

    const nodeMap = new Map(nodes.map(n => [n.id, { ...n }]));
    const live    = [...nodeMap.values()];

    const allEdges = [
      ...edges.formal.map(e=>({...e})),
      ...edges.informal.map(e=>({...e})),
      ...edges.cross_company.map(e=>({...e})),
    ];
    const links = allEdges.map(e => ({
      ...e,
      source: nodeMap.get(e.source) || e.source,
      target: nodeMap.get(e.target) || e.target,
    })).filter(e => typeof e.source === "object");

    d3.select(svg).selectAll("*").remove();
    const d3svg = d3.select(svg);
    const defs  = d3svg.append("defs");

    // Shadow filter
    const sh = defs.append("filter").attr("id","nshadow");
    sh.append("feDropShadow").attr("dx",0).attr("dy",3).attr("stdDeviation",5).attr("flood-color","rgba(19,27,46,0.15)");

    // Clip paths
    live.forEach(n => {
      defs.append("clipPath").attr("id",`cp-${n.id}`)
        .append("circle").attr("r", TIER_R[n.tier]);
    });

    const g           = d3svg.append("g").attr("class","root");
    const bubbleLayer = g.append("g").attr("class","bubbles");
    const crossLayer  = g.append("g").attr("class","cross");
    const edgeLayer   = g.append("g").attr("class","edges");
    const nodeLayer   = g.append("g").attr("class","nodes");

    // Zoom
    zoom = d3.zoom().scaleExtent([0.15,3])
      .on("zoom", e => g.attr("transform", e.transform));
    d3svg.call(zoom);

    // Seed positions — companies start FAR apart
    const cids    = [...new Set(live.map(n => n.company_id || "none"))];
    const aStep   = (2 * Math.PI) / Math.max(cids.length, 1);
    const spread  = Math.min(W, H) * 0.34;
    const centres = {};
    cids.forEach((cid, i) => {
      centres[cid] = {
        x: W / 2 + spread * Math.cos(aStep * i - Math.PI / 2),
        y: H / 2 + spread * Math.sin(aStep * i - Math.PI / 2),
      };
      live.filter(n => (n.company_id || "none") === cid).forEach(n => {
        n.x = centres[cid].x + (Math.random() - .5) * 60;
        n.y = centres[cid].y + (Math.random() - .5) * 60;
      });
    });

    // Simulation — wider spacing, faster settle
    sim = d3.forceSimulation(live)
      .force("link", d3.forceLink(links).id(d=>d.id)
        .distance(d => d.type === "cross_company" ? 380 : d.type === "informal" ? 180 : 150)
        .strength(d => d.type === "cross_company" ? 0.04 : 0.5))
      .force("charge",  d3.forceManyBody().strength(-350))
      .force("center",  d3.forceCenter(W/2, H/2).strength(0.04))
      .force("collide", d3.forceCollide(d => TIER_R[d.tier] + 28)) // more space
      .force("cluster", clusterForce(live, centres, 0.07))
      .alphaDecay(0.03)
      .velocityDecay(0.4);

    // ── Cross-company edges (animated gold dashes) ──
    const crossLinks = links.filter(e => e.type === "cross_company");
    const crossElems = crossLayer.selectAll("path").data(crossLinks).enter()
      .append("path").attr("fill","none").attr("stroke","#b49632")
      .attr("stroke-width",1.3).attr("stroke-dasharray","5 6")
      .attr("stroke-opacity",.5).attr("stroke-linecap","round");

    crossElems.each(function() {
      const el = d3.select(this);
      (function pulse() {
        el.transition().duration(2000).ease(d3.easeLinear)
          .attrTween("stroke-dashoffset",()=>d3.interpolate(0,-22)).on("end",pulse);
      })();
    });

    // ── Internal edges — NO arrowheads ──────
    const internalLinks = links.filter(e => e.type !== "cross_company");
    const edgeElems = edgeLayer.selectAll("path").data(internalLinks).enter()
      .append("path").attr("fill","none")
      .attr("stroke",       d => d.type === "formal" ? "#7e7385" : "#006b5f")
      .attr("stroke-width", d => d.type === "formal" ? 2.2 : 1.8)
      .attr("stroke-dasharray", d => d.type === "informal" ? "6 4" : null)
      .attr("stroke-opacity", .55);
    // ↑ No marker-end — arrowheads removed as requested

    // ── Nodes ────────────────────────────────
    const nodeElems = nodeLayer.selectAll("g.node").data(live).enter()
      .append("g").attr("class", d=>`node node--${d.tier}`)
      .style("cursor","pointer").attr("opacity",0)
      .call(d3.drag()
        .on("start", (e,d) => { if(!e.active) sim.alphaTarget(.3).restart(); lockCompany(d,true,live); })
        .on("drag",  (e,d) => moveCompany(d,e.dx,e.dy,live))
        .on("end",   (e,d) => { if(!e.active) sim.alphaTarget(0); lockCompany(d,false,live); }))
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

    // ── Company bubbles ──────────────────────
    const bubElems = {}, lblElems = {};
    companies.forEach(co => {
      const col = co.color;
      const bg  = bubbleLayer.append("g").attr("class","co-group").attr("data-id",co.id);
      const bp  = bg.append("path").attr("fill",col.fill)
        .attr("stroke",col.stroke).attr("stroke-width",2)
        .attr("stroke-dasharray","8 4").attr("opacity",.9)
        .style("cursor","pointer")
        .on("mouseenter",function(){ d3.select(this).transition().duration(160).attr("stroke-width",3.5).attr("fill",col.fill.replace("0.07","0.13")); })
        .on("mouseleave",function(){ d3.select(this).transition().duration(220).attr("stroke-width",2).attr("fill",col.fill); })
        .on("dblclick",(e)=>{ e.stopPropagation(); openOrg(co.id); });

      const bl = bg.append("text").attr("class","co-label")
        .attr("fill",col.label).attr("text-anchor","middle")
        .attr("pointer-events","none").attr("opacity",.85).text(co.name);

      bubElems[co.id] = bp; lblElems[co.id] = bl;
    });

    // ── Tick ─────────────────────────────────
    sim.on("tick", () => {
      edgeElems.attr("d", internalPath);
      crossElems.attr("d", crossPath);
      nodeElems.attr("transform", d=>`translate(${d.x},${d.y})`);
      companies.forEach(co => updateBubble(co, live, bubElems, lblElems));
    });
  }

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

  /* ── Node click → panel ─────────────────── */
  function onNodeClick(event, d) {
    event.stopPropagation();
    const W=svg.clientWidth, H=svg.clientHeight;
    d3.select(svg).transition().duration(480).ease(d3.easeCubicInOut)
      .call(zoom.transform, d3.zoomIdentity.translate(W/2-d.x*1.1,H/2-d.y*1.1).scale(1.1));
    fillPanel(d);
    openPanel();
  }

  function fillPanel(d) {
    document.getElementById("p-name").textContent  = d.name;
    document.getElementById("p-title").textContent = d.title;
    document.getElementById("p-persona").textContent = d.persona || "No persona yet.";
    document.getElementById("ini-text").textContent  = HN.initials(d.name);

    const img=document.getElementById("profile-pic"), ini=document.getElementById("av-ini");
    if (d.image){ img.src=d.image; img.style.display="block"; ini.style.display="none"; }
    else { img.style.display="none"; ini.style.display="flex"; }

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
    hc.innerHTML = (d.hobbies||[]).map(h=>`<span class="hobby-chip">${h}</span>`).join("") || `<p style="font-size:var(--text-sm);color:var(--text-muted)">None listed.</p>`;

    // Relations
    const rl = document.getElementById("p-rels");
    const allE = [
      ...G.edges.formal.map(e=>({...e,type:"formal"})),
      ...G.edges.informal.map(e=>({...e,type:"informal"})),
      ...G.edges.cross_company.map(e=>({...e,type:"cross_company"})),
    ];
    const conn = allE.filter(e=>e.source===d.id||e.target===d.id)
      .map(e=>{ const oid=e.source===d.id?e.target:e.source; const o=G.nodes.find(n=>n.id===oid); return o?{...e,other:o}:null; })
      .filter(Boolean);

    rl.innerHTML = conn.length ? "" : `<p style="font-size:var(--text-sm);color:var(--text-muted)">No connections yet.</p>`;
    conn.forEach(r => {
      const co = r.other.company_id ? G.companies.find(c=>c.id===r.other.company_id) : null;
      const div = document.createElement("div"); div.className="rel-item";
      div.innerHTML=`<span class="rel-dot ${r.type}"></span><div><div style="font-weight:600;font-size:var(--text-sm)">${r.other.name}</div><div style="font-size:var(--text-xs);color:var(--text-muted)">${r.label||r.other.title} · ${r.type.replace("_"," ")}${co?` · ${co.name}`:""}</div></div>`;
      div.onclick=()=>{ const n=G.nodes.find(x=>x.id===r.other.id); if(n) fillPanel({...n}); };
      rl.appendChild(div);
    });

    msgBtn.onclick = () => d.email ? window.location.href=`mailto:${d.email}` : HN.toast("No email on record.");
    switchTab("overview");
  }

  function openPanel()  { panel.classList.add("open"); panel.removeAttribute("aria-hidden"); canvas.classList.add("panel-open"); }
  function closePanel() { panel.classList.remove("open"); panel.setAttribute("aria-hidden","true"); canvas.classList.remove("panel-open"); }
  panelClose.addEventListener("click", closePanel);
  document.addEventListener("click", e => {
    if (panel.classList.contains("open") && !panel.contains(e.target) && !e.target.closest(".node") && !e.target.closest(".co-group")) closePanel();
  });

  /* ── Tabs ────────────────────────────────── */
  document.querySelectorAll(".tab-btn").forEach(b => b.addEventListener("click",()=>switchTab(b.dataset.tab)));
  function switchTab(id) {
    document.querySelectorAll(".tab-btn").forEach(b=>b.classList.toggle("active",b.dataset.tab===id));
    ["overview","network","hobbies"].forEach(t=>{ document.getElementById(`tab-${t}`).style.display=t===id?"block":"none"; });
  }

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
  orgOverlay.addEventListener("click", e=>{ if(e.target===orgOverlay) closeOrgModal(); });

  /* ── Zoom controls ───────────────────────── */
  document.getElementById("zoom-in") .addEventListener("click",()=>d3.select(svg).transition().duration(260).call(zoom.scaleBy,1.4));
  document.getElementById("zoom-out").addEventListener("click",()=>d3.select(svg).transition().duration(260).call(zoom.scaleBy,0.72));
  document.getElementById("zoom-fit").addEventListener("click",()=>{ const W=svg.clientWidth,H=svg.clientHeight; d3.select(svg).transition().duration(480).call(zoom.transform,d3.zoomIdentity.translate(W/2,H/2).scale(0.82)); });

  /* ── Search ──────────────────────────────── */
  searchInput.addEventListener("input", HN.debounce(e=>{
    const q=e.target.value.toLowerCase().trim();
    d3.selectAll(".node").style("opacity",function(d){ return !q||d.name.toLowerCase().includes(q)||d.title.toLowerCase().includes(q)?1:0.15; });
  },140));

  /* ── Add person modal ────────────────────── */
  addPersonBtn.addEventListener("click",()=>addModal.classList.add("open"));
  function closeAdd(){ addModal.classList.remove("open"); addForm.reset(); uploadPrev.style.display="none"; uploadPh.style.display="block"; }
  addCancel.addEventListener("click",closeAdd);
  addModal.addEventListener("click",e=>{ if(e.target===addModal) closeAdd(); });
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
    } catch(err){ HN.toast(`⚠️  ${err.message}`); }
    finally{ btn.disabled=false; btn.innerHTML='<span class="material-symbols-outlined">add_circle</span>Add to Network'; }
  });

  /* ── Boot ────────────────────────────────── */
  load();
  let rt; window.addEventListener("resize",()=>{ clearTimeout(rt); rt=setTimeout(()=>{ if(sim) sim.stop(); render(G); },280); });

})();
