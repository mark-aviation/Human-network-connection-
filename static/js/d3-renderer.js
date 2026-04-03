/**
 * THE HUMAN NETWORK — d3-renderer.js
 * Centralized D3.js rendering logic
 * Handles all SVG manipulation, transitions, and visual updates
 */

const D3Renderer = (() => {
  "use strict";

  // ── Configuration ────────────────────────
  const TIER_R = { executive: 38, manager: 30, contributor: 24 };
  const TIER_C = {
    executive:   { fill: "#8127cf", stroke: "#6900b3", text: "#fff" },
    manager:     { fill: "#006b5f", stroke: "#004d44", text: "#fff" },
    contributor: { fill: "#ffffff", stroke: "#8127cf", text: "#131b2e" },
  };

  // ── Helpers ──────────────────────────────
  function internalPath(d) {
    if (!d.source || !d.target) return "";
    const dx = d.target.x - d.source.x;
    const dy = d.target.y - d.source.y;
    const dist = Math.hypot(dx, dy);
    const sr = TIER_R[d.source.tier] || 24;
    const tr = TIER_R[d.target.tier] || 24;
    const frac_start = sr / dist;
    const frac_end = 1 - (tr / dist);
    const x1 = d.source.x + dx * frac_start;
    const y1 = d.source.y + dy * frac_start;
    const x2 = d.source.x + dx * frac_end;
    const y2 = d.source.y + dy * frac_end;
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  function crossPath(d) {
    return internalPath(d); // Same calculation for cross-company edges
  }

  // ── Public API ──
  return {
    TIER_R,
    TIER_C,
    internalPath,
    crossPath,

    /**
     * Initialize SVG structure (layers, defs, root group)
     */
    initSvg(svg) {
      d3.select(svg).selectAll("*").remove();
      const d3svg = d3.select(svg);
      const defs = d3svg.append("defs");

      // Shadow filter
      const sh = defs.append("filter").attr("id", "nshadow");
      sh.append("feDropShadow")
        .attr("dx", 0).attr("dy", 3).attr("stdDeviation", 5)
        .attr("flood-color", "rgba(19,27,46,0.15)");

      // Root group for zoom/pan
      const g = d3svg.append("g").attr("class", "root");

      // Layer groups
      const bubbleLayer = g.append("g").attr("class", "bubbles");
      const crossLayer = g.append("g").attr("class", "cross");
      const edgeLayer = g.append("g").attr("class", "edges");
      const nodeLayer = g.append("g").attr("class", "nodes");

      return { svg: d3svg, g, defs, bubbleLayer, crossLayer, edgeLayer, nodeLayer };
    },

    /**
     * Add clip paths for node images
     */
    addClipPaths(defs, nodes) {
      nodes.forEach(n => {
        defs.append("clipPath").attr("id", `cp-${n.id}`)
          .append("circle").attr("r", TIER_R[n.tier]);
      });
    },

    /**
     * Render node visual elements
     */
    renderNodes(nodeLayer, nodes) {
      const nodeElems = nodeLayer.selectAll("g.node").data(nodes).enter()
        .append("g").attr("class", d => `node node--${d.tier}`)
        .style("cursor", "pointer").attr("opacity", 0);

      // Main circle
      nodeElems.append("circle")
        .attr("r", d => TIER_R[d.tier])
        .attr("fill", d => TIER_C[d.tier].fill)
        .attr("stroke", d => TIER_C[d.tier].stroke)
        .attr("stroke-width", 2)
        .attr("filter", "url(#nshadow)");

      // Profile image (if exists)
      nodeElems.each(function (d) {
        if (!d.image) return;
        d3.select(this).append("image")
          .attr("href", d.image)
          .attr("x", -TIER_R[d.tier]).attr("y", -TIER_R[d.tier])
          .attr("width", TIER_R[d.tier] * 2).attr("height", TIER_R[d.tier] * 2)
          .attr("clip-path", `url(#cp-${d.id})`)
          .attr("preserveAspectRatio", "xMidYMid slice");
      });

      // Initials (if no image)
      nodeElems.append("text").attr("text-anchor", "middle").attr("dy", "0.35em")
        .attr("fill", d => TIER_C[d.tier].text)
        .attr("font-family", "'Manrope',sans-serif")
        .attr("font-size", d => d.tier === "executive" ? 13 : 11)
        .attr("font-weight", "700")
        .attr("pointer-events", "none")
        .text(d => d.image ? "" : HN.initials(d.name));

      // Name label
      nodeElems.append("text").attr("text-anchor", "middle")
        .attr("dy", d => TIER_R[d.tier] + 16).attr("class", "node-label")
        .attr("pointer-events", "none")
        .attr("fill", "#131b2e")
        .attr("font-family", "'Manrope',sans-serif")
        .attr("font-size", "12")
        .attr("font-weight", "600")
        .text(d => d.name);

      // Title/role
      nodeElems.append("text").attr("text-anchor", "middle")
        .attr("dy", d => TIER_R[d.tier] + 30).attr("class", "node-sublabel")
        .attr("pointer-events", "none")
        .attr("fill", "#8795a3")
        .attr("font-family", "'Manrope',sans-serif")
        .attr("font-size", "10")
        .text(d => d.title);

      // Hover glow (invisible initially)
      nodeElems.append("circle").attr("class", "nglow")
        .attr("r", d => TIER_R[d.tier] + 7).attr("fill", "none")
        .attr("stroke", d => TIER_C[d.tier].fill).attr("stroke-width", 3)
        .attr("opacity", 0).style("pointer-events", "none");

      // Hover effects
      nodeElems
        .on("mouseenter", function () {
          d3.select(this).select(".nglow").transition().duration(100).attr("opacity", 0.45);
          d3.select(this).select("circle:first-child").transition().duration(100)
            .attr("r", d => TIER_R[d.tier] + 3);
        })
        .on("mouseleave", function () {
          d3.select(this).select(".nglow").transition().duration(180).attr("opacity", 0);
          d3.select(this).select("circle:first-child").transition().duration(180)
            .attr("r", d => TIER_R[d.tier]);
        });

      // Staggered reveal
      nodeElems.transition().duration(400).delay((_, i) => i * 40).attr("opacity", 1);

      return nodeElems;
    },

    /**
     * Render edge visual elements
     */
    renderEdges(edgeLayer, links) {
      const internalLinks = links.filter(e => e.type !== "cross_company");
      const edgeElems = edgeLayer.selectAll("path").data(internalLinks).enter()
        .append("path").attr("fill", "none")
        .attr("stroke", d => d.type === "formal" ? "#7e7385" : "#006b5f")
        .attr("stroke-width", d => {
          const base = d.type === "formal" ? 2.2 : 1.8;
          return base * (d.strength || 1.0);
        })
        .attr("stroke-dasharray", d => d.type === "informal" ? "6 4" : null)
        .attr("stroke-opacity", 0);

      return { edgeElems, internalLinks };
    },

    /**
     * Render cross-company edges
     */
    renderCrossEdges(crossLayer, links) {
      const crossLinks = links.filter(e => e.type === "cross_company");
      const crossElems = crossLayer.selectAll("path").data(crossLinks).enter()
        .append("path").attr("fill", "none").attr("stroke", "#b49632")
        .attr("stroke-width", 1.3).attr("stroke-dasharray", "5 6")
        .attr("stroke-opacity", 0)
        .attr("stroke-linecap", "round");

      // Pulse animation (invisible until toggled)
      crossElems.each(function () {
        const el = d3.select(this);
        (function pulse() {
          el.transition().duration(2000).ease(d3.easeLinear)
            .attrTween("stroke-dashoffset", () => d3.interpolate(0, -22))
            .on("end", pulse);
        })();
      });

      return { crossElems, crossLinks };
    },

    /**
     * Render company bubbles and labels
     */
    renderCompanies(bubbleLayer, companies) {
      const bubElems = {}, lblElems = {};

      companies.forEach(co => {
        const col = co.color;
        const bg = bubbleLayer.append("g").attr("class", "co-group").attr("data-id", co.id);

        const bp = bg.append("path")
          .attr("fill", col.fill)
          .attr("stroke", col.stroke).attr("stroke-width", 1.5)
          .attr("stroke-dasharray", null).attr("opacity", 0.85)
          .style("cursor", "grab")
          .on("mouseenter", function () {
            d3.select(this).transition().duration(160)
              .attr("stroke-width", 3.5)
              .attr("fill", col.fill.replace("0.07", "0.13"));
          })
          .on("mouseleave", function () {
            d3.select(this).transition().duration(220)
              .attr("stroke-width", 2)
              .attr("fill", col.fill);
          });

        const bl = bg.append("text").attr("class", "co-label")
          .attr("fill", col.label).attr("text-anchor", "middle")
          .attr("pointer-events", "none").attr("opacity", 0.85)
          .text(co.name);

        bubElems[co.id] = bp;
        lblElems[co.id] = bl;
      });

      return { bubElems, lblElems };
    },

    /**
     * Update company bubble position and size
     */
    updateBubble(co, nodes, bubElems, lblElems) {
      if (!bubElems[co.id]) return;

      const members = nodes.filter(n => n.company_id === co.id);
      if (members.length === 0) return;

      const xs = members.map(n => n.x);
      const ys = members.map(n => n.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const rx = (maxX - minX) / 2 + 48;
      const ry = (maxY - minY) / 2 + 48;

      const path = `
        M ${cx - rx},${cy}
        C ${cx - rx},${cy - ry * 0.552} ${cx - rx * 0.552},${cy - ry} ${cx},${cy - ry}
        C ${cx + rx * 0.552},${cy - ry} ${cx + rx},${cy - ry * 0.552} ${cx + rx},${cy}
        C ${cx + rx},${cy + ry * 0.552} ${cx + rx * 0.552},${cy + ry} ${cx},${cy + ry}
        C ${cx - rx * 0.552},${cy + ry} ${cx - rx},${cy + ry * 0.552} ${cx - rx},${cy}
        Z
      `;

      bubElems[co.id].attr("d", path);
      lblElems[co.id].attr("x", cx).attr("y", cy);
    },
  };
})();
