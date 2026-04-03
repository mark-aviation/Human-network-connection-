/**
 * THE HUMAN NETWORK — features.js
 * Phase 3 & 4: Accessibility, Animations, Timeline Filtering
 * 
 * Features:
 *   - Keyboard navigation (Tab + Enter to open profile)
 *   - Dynamic text contrast (WCAG compliant)
 *   - Time machine slider (filter by date)
 *   - Rubber-band line deletion
 *   - Bloop entrance animation
 */

const HNFeatures = (() => {
  "use strict";

  // ══════════════════════════════════════════════════════
  // 1. KEYBOARD NAVIGATION
  // ══════════════════════════════════════════════════════
  
  /**
   * Enable keyboard navigation on D3 nodes
   * - Tab to focus nodes
   * - Enter/Space to open profile
   * - Escape to blur
   */
  function initKeyboardNavigation(nodeLayer, fillPanelFn) {
    if (!nodeLayer) return;

    nodeLayer.selectAll("g.node")
      .attr("tabindex", 0)
      .on("keydown", function(event, d) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (fillPanelFn) fillPanelFn(d);
        }
        if (event.key === "Escape") {
          this.blur();
        }
      })
      .on("focus", function(event, d) {
        // Highlight on focus
        d3.select(this).select(".nglow")
          .transition().duration(150)
          .attr("opacity", 0.7);
      })
      .on("blur", function(event, d) {
        // Dim on blur
        d3.select(this).select(".nglow")
          .transition().duration(150)
          .attr("opacity", 0);
      });
  }

  // ══════════════════════════════════════════════════════
  // 2. DYNAMIC TEXT CONTRAST (WCAG 2.1 AA)
  // ══════════════════════════════════════════════════════

  /**
   * Calculate relative luminance of a color
   * Returns value 0-1 for use in contrast calculation
   */
  function getLuminance(hexColor) {
    const hex = hexColor.replace("#", "");
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;

    // sRGB linearization
    const rLinear = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
    const gLinear = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
    const bLinear = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

    // Relative luminance formula
    return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
  }

  /**
   * Get optimal text color (white or dark) for background
   * Returns "#ffffff" or "#131b2e" for WCAG AA compliance
   */
  function getContrastText(bgHexColor) {
    const bgLum = getLuminance(bgHexColor);
    const whiteLum = getLuminance("#ffffff");
    const darkLum = getLuminance("#131b2e");

    const contrastWhite = (Math.max(bgLum, whiteLum) + 0.05) / (Math.min(bgLum, whiteLum) + 0.05);
    const contrastDark = (Math.max(bgLum, darkLum) + 0.05) / (Math.min(bgLum, darkLum) + 0.05);

    // Use white if it has better contrast (>=4.5 for AA Large)
    return contrastWhite >= contrastDark ? "#ffffff" : "#131b2e";
  }

  /**
   * Apply dynamic contrast to company bubbles
   */
  function applyDynamicContrast(bubbleLayer, companies) {
    if (!bubbleLayer) return;

    bubbleLayer.selectAll(".co-label").each(function(d) {
      const co = companies.find(c => c.id === d.id);
      if (!co || !co.color) return;

      // Extract stroke color (guaranteed to be high contrast)
      const textColor = getContrastText(co.color.stroke);
      d3.select(this).attr("fill", textColor);
    });
  }

  // ══════════════════════════════════════════════════════
  // 3. TIME MACHINE SLIDER
  // ══════════════════════════════════════════════════════

  /**
   * Create and manage time machine slider
   * Filters nodes/edges based on started_date
   */
  function initTimeMachineSlider(containerId, allNodes, allEdges, nodeLayer, edgeLayer, crossLayer, orgOverlay) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.warn(`Container #${containerId} not found for time machine`);
      return;
    }

    // Extract all dates from relationships
    const dates = allEdges
      .filter(e => e.started_date)
      .map(e => new Date(e.started_date).getTime())
      .sort((a, b) => a - b);

    if (!dates.length) {
      // No timeline data, hide slider
      container.style.display = "none";
      return;
    }

    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));

    // Build UI
    const sliderHtml = `
      <div id="time-machine" style="
        position:fixed;
        bottom:24px;
        left:50%;
        transform:translateX(-50%);
        z-index:100;
        background:var(--surface-card);
        border:1.5px solid var(--outline-variant);
        border-radius:12px;
        padding:12px 16px;
        display:flex;
        align-items:center;
        gap:12px;
        box-shadow:var(--shadow-ambient);
        max-width:90vw;
        min-width:320px;
      ">
        <span style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-muted);white-space:nowrap">
          Timeline
        </span>
        <input 
          type="range" 
          id="timeline-slider"
          min="${minDate.getFullYear()}"
          max="${maxDate.getFullYear() + 1}"
          value="${maxDate.getFullYear() + 1}"
          style="flex:1; min-width:160px; cursor:pointer"
        />
        <span id="timeline-label" style="
          font-size:12px;
          font-weight:600;
          color:var(--primary);
          min-width:80px;
          text-align:right;
        ">
          All Time
        </span>
        <button id="timeline-reset" style="
          border:none;
          background:var(--surface-mid);
          border-radius:6px;
          padding:4px 8px;
          cursor:pointer;
          font-size:11px;
          font-weight:600;
          color:var(--text-secondary);
          transition:all 150ms;
        " title="Reset to all time">
          <span class="material-symbols-outlined" style="font-size:16px;display:block">restart_alt</span>
        </button>
      </div>
    `;

    container.innerHTML = sliderHtml;

    const slider = document.getElementById("timeline-slider");
    const label = document.getElementById("timeline-label");
    const resetBtn = document.getElementById("timeline-reset");
    const timeMachine = document.getElementById("time-machine");

    slider.addEventListener("input", e => {
      const year = parseInt(e.target.value);
      const filterDate = new Date(year, 0, 1).getTime();

      // Determine visible nodes: those created before filterDate OR have NO created_at
      const visibleNodeIds = new Set(
        allNodes
          .filter(n => !n.created_at || new Date(n.created_at).getTime() <= filterDate)
          .map(n => n.id)
      );

      // Determine visible edges: started_date must be before filterDate
      const visibleEdges = allEdges.filter(e => !e.started_date || new Date(e.started_date).getTime() <= filterDate);

      // Fade nodes
      if (nodeLayer) {
        nodeLayer.selectAll("g.node").transition().duration(250).attr("opacity", d => (visibleNodeIds.has(d.id) ? 1 : 0.1));
      }

      // Fade edges
      if (edgeLayer) {
        edgeLayer.selectAll("path").transition().duration(250).attr("stroke-opacity", d => {
          const isVisible =
            visibleEdges.find(e => e.id === d.id) &&
            visibleNodeIds.has(d.source.id) &&
            visibleNodeIds.has(d.target.id);
          return isVisible ? 0.55 : 0;
        });
      }

      if (crossLayer) {
        crossLayer.selectAll("path").transition().duration(250).attr("stroke-opacity", d => {
          const isVisible =
            visibleEdges.find(e => e.id === d.id) &&
            visibleNodeIds.has(d.source.id) &&
            visibleNodeIds.has(d.target.id);
          return isVisible ? 0.7 : 0;
        });
      }

      // Update label
      if (year >= maxDate.getFullYear() + 1) {
        label.textContent = "All Time";
      } else {
        label.textContent = `Until ${year}`;
      }
    });

    resetBtn.addEventListener("click", () => {
      slider.value = maxDate.getFullYear() + 1;
      slider.dispatchEvent(new Event("input"));
    });

    // Hover effects
    timeMachine.addEventListener("mouseenter", () => {
      timeMachine.style.boxShadow = "0 8px 20px rgba(129,39,207,0.15)";
    });
    timeMachine.addEventListener("mouseleave", () => {
      timeMachine.style.boxShadow = "var(--shadow-ambient)";
    });
  }

  // ══════════════════════════════════════════════════════
  // 4. RUBBER-BAND LINE DELETION
  // ══════════════════════════════════════════════════════

  /**
   * Animate edge deletion with rubber-band snap
   * Path snaps toward center, recoils, then fades
   */
  function rubberBandDelete(edgeElement, duration = 600) {
    return new Promise(resolve => {
      const svg = edgeElement.ownerSVGElement;
      if (!svg) {
        edgeElement.remove();
        resolve();
        return;
      }

      const bbox = edgeElement.getBBox();
      const centerX = bbox.x + bbox.width / 2;
      const centerY = bbox.y + bbox.height / 2;

      // Clone for animation (original gets hidden)
      edgeElement.style.opacity = "0";
      const clone = edgeElement.cloneNode(true);
      clone.style.opacity = "1";
      svg.appendChild(clone);

      // Get current path
      const originalPath = clone.getAttribute("d");
      const parts = originalPath.match(/M[\d.,\s-]+/g) || [];
      if (parts.length < 1) {
        clone.remove();
        resolve();
        return;
      }

      // Extract start and end points
      const startMatch = originalPath.match(/M([\d.-]+),([\d.-]+)/);
      const endMatch = originalPath.match(/[LQ]([\d.-]+),([\d.-]+)(?:\s|$)/);

      if (!startMatch || !endMatch) {
        clone.remove();
        resolve();
        return;
      }

      const x1 = parseFloat(startMatch[1]),
        y1 = parseFloat(startMatch[2]);
      const x2 = parseFloat(endMatch[1]),
        y2 = parseFloat(endMatch[2]);

      // Phase 1: Snap toward center (300ms)
      d3.select(clone)
        .transition()
        .duration(300)
        .ease(d3.easeBackIn)
        .attr("d", `M${centerX},${centerY}L${centerX},${centerY}`)
        .attr("stroke-width", 0.5);

      // Phase 2: Recoil away (200ms)
      d3.select(clone)
        .transition()
        .delay(300)
        .duration(200)
        .ease(d3.easeBackOut)
        .attr(
          "d",
          `M${centerX - (x1 - centerX) * 0.8},${centerY - (y1 - centerY) * 0.8}L${centerX - (x2 - centerX) * 0.8},${centerY - (y2 - centerY) * 0.8}`
        );

      // Phase 3: Fade out (100ms)
      d3.select(clone)
        .transition()
        .delay(500)
        .duration(100)
        .attr("stroke-opacity", 0);

      setTimeout(() => {
        clone.remove();
        edgeElement.remove();
        resolve();
      }, duration + 50);
    });
  }

  // ══════════════════════════════════════════════════════
  // 5. BLOOP ENTRANCE ANIMATION
  // ══════════════════════════════════════════════════════

  /**
   * Animate new node entrance with bloop + bounce
   * Node starts at top, accelerates downward, bounces
   */
  function bloopEntrance(nodeElement, targetY, duration = 1200, targetX = null) {
    return new Promise(resolve => {
      const currentTransform = d3.select(nodeElement).attr("transform") || "translate(0,0)";
      const match = currentTransform.match(/translate\(([\d.-]+),([\d.-]+)\)/);
      const startY = match ? parseFloat(match[2]) : 0;
      const x = targetX !== null ? targetX : match ? parseFloat(match[1]) : 0;

      const startYPos = targetY - 300; // Start high above target

      // Initial setup
      d3.select(nodeElement)
        .attr("transform", `translate(${x},${startYPos})`)
        .attr("opacity", 0.3);

      // Bloop down with ease-in (acceleration)
      d3.select(nodeElement)
        .transition()
        .duration(duration * 0.6)
        .ease(d3.easeQuadIn)
        .attr("transform", `translate(${x},${targetY + 40})`)
        .attr("opacity", 1);

      // Bounce back up
      d3.select(nodeElement)
        .transition()
        .delay(duration * 0.6)
        .duration(duration * 0.25)
        .ease(d3.easeQuadOut)
        .attr("transform", `translate(${x},${targetY - 20})`);

      // Settle
      d3.select(nodeElement)
        .transition()
        .delay(duration * 0.85)
        .duration(duration * 0.15)
        .ease(d3.easeLinear)
        .attr("transform", `translate(${x},${targetY})`)
        .on("end", resolve);
    });
  }

  // ══════════════════════════════════════════════════════
  // 6. PULSE ANIMATION (Generic)
  // ══════════════════════════════════════════════════════

  function pulseNode(nodeElement, cycles = 2, duration = 400) {
    let count = 0;

    function pulse() {
      if (count >= cycles) return;
      count++;

      d3.select(nodeElement)
        .select("circle:first-child")
        .transition()
        .duration(duration / 2)
        .attr("r", function() {
          const tier = d3.select(nodeElement).data()[0]?.tier;
          const TIER_R = { executive: 38, manager: 30, contributor: 24 };
          return TIER_R[tier || "contributor"] + 8;
        })
        .transition()
        .duration(duration / 2)
        .attr("r", function() {
          const tier = d3.select(nodeElement).data()[0]?.tier;
          const TIER_R = { executive: 38, manager: 30, contributor: 24 };
          return TIER_R[tier || "contributor"];
        })
        .on("end", pulse);
    }

    pulse();
  }

  // ── Public API ──
  return {
    initKeyboardNavigation,
    getLuminance,
    getContrastText,
    applyDynamicContrast,
    initTimeMachineSlider,
    rubberBandDelete,
    bloopEntrance,
    pulseNode,
  };
})();
