/**
 * THE HUMAN NETWORK — graph-controller.js
 * State management and orchestration layer
 * Coordinates DOM, API, and D3 rendering
 */

const GraphController = (() => {
  "use strict";

  // ── State ────────────────────────────────
  let G = { nodes: [], companies: [], edges: { formal: [], informal: [], cross_company: [] } };
  let sim = null, zoom = null;
  let focusActive = false, focusNode = null;
  let focusPicker = null, focusExitPill = null;

  // ── DOM Cache ────────────────────────────
  const DOM = {
    svg: null,
    canvas: null,
    panel: null,
    addForm: null,
    searchInput: null,

    // Cache all elements at init
    init() {
      this.svg = document.getElementById("graph-svg");
      this.canvas = document.getElementById("graph-canvas");
      this.panel = document.getElementById("profile-panel");
      this.addForm = document.getElementById("add-form");
      this.searchInput = document.getElementById("search-input");
      return this;
    },

    // Validate all required elements exist
    validate() {
      const required = ["svg", "canvas", "panel", "addForm"];
      const missing = required.filter(key => !this[key]);
      if (missing.length > 0) {
        throw new Error(`Missing DOM elements: ${missing.join(", ")}`);
      }
      return this;
    },
  };

  // ── Helpers ──────────────────────────────
  function seedNodePositions(nodes, companies, canvas) {
    const W = canvas.clientWidth || 900;
    const H = canvas.clientHeight || 600;

    const cids = [...new Set(nodes.map(n => n.company_id || "none"))];
    const aStep = (2 * Math.PI) / Math.max(cids.length, 1);
    const spread = Math.min(W, H) * 0.34;
    const centres = {};

    cids.forEach((cid, i) => {
      centres[cid] = {
        x: W / 2 + spread * Math.cos(aStep * i - Math.PI / 2),
        y: H / 2 + spread * Math.sin(aStep * i - Math.PI / 2),
      };
      nodes.filter(n => (n.company_id || "none") === cid).forEach(n => {
        n.x = centres[cid].x + (Math.random() - 0.5) * 60;
        n.y = centres[cid].y + (Math.random() - 0.5) * 60;
      });
    });

    return centres;
  }

  function clusterForce(nodes, centres, strength) {
    return function (alpha) {
      nodes.forEach(n => {
        const cid = n.company_id || "none";
        const c = centres[cid];
        if (!c) return;
        n.vx += (c.x - n.x) * strength * alpha;
        n.vy += (c.y - n.y) * strength * alpha;
      });
    };
  }

  function buildLinkMap(nodes) {
    const nodeMap = new Map(nodes.map(n => [n.id, { ...n }]));
    return nodeMap;
  }

  function buildLinkData(edges, nodeMap) {
    const allEdges = [
      ...edges.formal.map(e => ({ ...e })),
      ...edges.informal.map(e => ({ ...e })),
      ...edges.cross_company.map(e => ({ ...e })),
    ];
    return allEdges.map(e => ({
      ...e,
      source: nodeMap.get(e.source) || e.source,
      target: nodeMap.get(e.target) || e.target,
    })).filter(e => typeof e.source === "object");
  }

  // ── Public API ──
  return {
    DOM,
    getGraphData() { return G; },
    getSimulation() { return sim; },
    getZoom() { return zoom; },
    getFocusState() { return { focusActive, focusNode }; },

    /**
     * Initialize DOM and validate
     */
    initDOM() {
      return DOM.init().validate();
    },

    /**
     * Load graph data from API
     */
    async loadGraph() {
      try {
        G = await HN.api.get("/api/graph");
        return G;
      } catch (err) {
        HN.toast("⚠️  Could not load network.");
        throw err;
      }
    },

    /**
     * Create force simulation
     */
    createSimulation(nodes, links, canvas) {
      const W = canvas.clientWidth || 900;
      const H = canvas.clientHeight || 600;

      const centres = seedNodePositions(nodes, G.companies, canvas);

      sim = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id)
          .distance(d => d.type === "cross_company" ? 380 : d.type === "informal" ? 180 : 150)
          .strength(d => d.type === "cross_company" ? 0.04 : 0.5))
        .force("charge", d3.forceManyBody().strength(-350))
        .force("center", d3.forceCenter(W / 2, H / 2).strength(0.04))
        .force("collide", d3.forceCollide(d => D3Renderer.TIER_R[d.tier] + 28))
        .force("cluster", clusterForce(nodes, centres, 0.07))
        .alphaDecay(0.03)
        .velocityDecay(0.4);

      return sim;
    },

    /**
     * Create zoom behavior
     */
    createZoom(svg, g) {
      zoom = d3.zoom().scaleExtent([0.15, 3])
        .on("zoom", e => g.attr("transform", e.transform));
      svg.call(zoom);
      return zoom;
    },

    /**
     * Prepare node and link data for rendering
     */
    prepareRenderData(data) {
      const { nodes, companies, edges } = data;
      const nodeMap = buildLinkMap(nodes);
      const live = [...nodeMap.values()];
      const links = buildLinkData(edges, nodeMap);

      return { nodes: live, companies, links, nodeMap };
    },

    /**
     * Clear focus mode
     */
    clearFocus() {
      focusActive = false;
      focusNode = null;
      if (focusExitPill) focusExitPill.style.display = "none";
    },

    /**
     * Update focus state
     */
    setFocus(isActive, node) {
      focusActive = isActive;
      focusNode = node;
    },

    /**
     * Cache focus UI elements
     */
    cacheFocusElements() {
      focusPicker = document.getElementById("focus-picker");
      focusExitPill = document.getElementById("focus-exit-pill");
    },
  };
})();
