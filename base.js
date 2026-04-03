/* ═══════════════════════════════════════════
   THE HUMAN NETWORK — base.js
   Shared utilities: theme, toast, nav, api
═══════════════════════════════════════════ */

// ── Theme ────────────────────────────────
window.HN = window.HN || {};

HN.initTheme = function() {
  const stored = localStorage.getItem("hn-theme");
  const dark   = window.matchMedia("(prefers-color-scheme: dark)").matches;
  HN.applyTheme(stored || (dark ? "dark" : "light"));
};

HN.applyTheme = function(t) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("hn-theme", t);
  const icon = document.getElementById("theme-icon");
  if (icon) icon.textContent = t === "dark" ? "light_mode" : "dark_mode";
};

HN.toggleTheme = function() {
  const cur = document.documentElement.getAttribute("data-theme") || "light";
  HN.applyTheme(cur === "dark" ? "light" : "dark");
};

// ── Toast ────────────────────────────────
HN.toast = function(msg, ms = 2800) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), ms);
};

// ── API helpers ──────────────────────────
HN.api = {
  async get(url) {
    const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async post(url, data) {
    const r = await fetch(url, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data) });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || `HTTP ${r.status}`); }
    return r.json();
  },
  async put(url, data) {
    const r = await fetch(url, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data) });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || `HTTP ${r.status}`); }
    return r.json();
  },
  async del(url) {
    const r = await fetch(url, { method:"DELETE" });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || `HTTP ${r.status}`); }
    return r.json();
  },
};

// ── Debounce ─────────────────────────────
HN.debounce = function(fn, ms) {
  let t; return function(...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
};

// ── Initials ─────────────────────────────
HN.initials = function(name = "") {
  return name.split(" ").slice(0,2).map(w=>w[0]||"").join("").toUpperCase();
};

// ── Nav active state + theme btn ─────────
document.addEventListener("DOMContentLoaded", () => {
  HN.initTheme();
  const themeBtn = document.getElementById("theme-btn");
  if (themeBtn) themeBtn.addEventListener("click", HN.toggleTheme);

  // Smooth nav transitions
  document.querySelectorAll(".nav-links a").forEach(a => {
    a.addEventListener("click", e => {
      const href = a.getAttribute("href");
      if (href && href !== "#" && !href.startsWith("http")) {
        e.preventDefault();
        document.body.style.opacity = "0";
        document.body.style.transition = "opacity 0.15s ease";
        setTimeout(() => { window.location.href = href; }, 150);
      }
    });
  });
});
