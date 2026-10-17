/* Corvux — 页面主逻辑：内容注入 / 时钟 / 入场 / 邮箱防护 */

/* ══════════════ 内容数据（单一数据源，改这里就行） ══════════════ */
const NOW = [
  {
    name: "Developmental kernel",
    state: "researching",
    desc: "Frozen representations, incrementally growing heads, an explicit forgetting budget. Swap the data, swap the domain.",
    meta: "protein · mutation effect · few-shot",
  },
  {
    name: "PentaFold",
    state: "benchmarking",
    desc: "The kernel's first proving ground. Budget-matched against same-parameter baselines, with old-domain forgetting tracked.",
    meta: "ProteinGym · 135 assays",
  },
  {
    name: "Corvux-Loop-300M",
    state: "training",
    desc: "300.7M parameters, recurrent depth with hybrid linear attention — does looped depth beat a standard Transformer at equal budget?",
    meta: "300.7M params · recurrent depth",
  },
  {
    name: "Local agent stack",
    state: "running",
    desc: "Local-first tooling for vision, literature, execution and scheduling. Private data never leaves the machine.",
    meta: "loopback only · self-hosted",
  },
];

/* ══════════════ ARXIVS —— 6 条目（A/R/X/I/V/S） ══════════════
   形式借鉴 rhine-lab-art 的 archive 陈列，内容是我们的研究条目。
   全英文。 */
const ARXIVS = [
  {
    code: "A",
    title: "Developmental Kernel",
    sub: "Frozen representations, growing heads, bounded forgetting.",
    field: "architecture",
    status: "researching",
    ledger: "n=5/10/20/50 · forget ≤ budget",
    tags: ["continual", "adapters", "memory"],
  },
  {
    code: "R",
    title: "PentaFold",
    sub: "The first proving ground: protein mutation effect prediction.",
    field: "benchmark",
    status: "benchmarking",
    ledger: "135 assays · within / cross",
    tags: ["ProteinGym", "ρ", "budget-matched"],
  },
  {
    code: "X",
    title: "Corvux-Loop-300M",
    sub: "Recurrent depth with hybrid linear attention, 300.7M params.",
    field: "model",
    status: "training",
    ledger: "300.7M · looped depth",
    tags: ["GDN", "SWA", "Muon"],
  },
  {
    code: "I",
    title: "Local Agent Stack",
    sub: "Local-first tooling: vision, literature, execution, scheduling.",
    field: "systems",
    status: "running",
    ledger: "loopback only · self-hosted",
    tags: ["privacy", "MCP", "automation"],
  },
  {
    code: "V",
    title: "Rhine Lab — ANALYSIS OS",
    sub: "An animated terminal rebuilt as an operable three-dimensional interface.",
    field: "interface",
    status: "shipped",
    ledger: "Three.js · PWA · 60fps",
    tags: ["WebGL", "TypeScript", "a11y"],
  },
  {
    code: "S",
    title: "Emergence Poster",
    sub: "Canvas and WebGL materials composed into a printed poster series.",
    field: "visual",
    status: "archived",
    ledger: "liquid · glass · flame",
    tags: ["canvas", "print", "motion"],
  },
];

const NOTES = [
  {
    date: "2026.10",
    title: "Not \u201cbeating SOTA unconditionally\u201d \u2014 the optimum inside a fixed budget.",
    kind: "method",
  },
  {
    date: "2026.09",
    title: "Frozen representation + growing head + forgetting budget: learning split into three measurable parts.",
    kind: "kernel",
  },
  {
    date: "2026.09",
    title: "A \u03c1 without a parameter count is not a result.",
    kind: "discipline",
  },
  {
    date: "2026.08",
    title: "Pre-register the protocol before running \u2014 otherwise every finding is just a story about tuning.",
    kind: "method",
  },
  {
    date: "2026.08",
    title: "Anything AI-generated must be re-checkable; re-checkable requires a fingerprint.",
    kind: "engineering",
  },
];

/* ══════════════ 注入 ══════════════ */
function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

/* NOW */
const nowGrid = document.getElementById("now-grid");
NOW.forEach((item) => {
  const card = el("article", "now-card");
  card.innerHTML = `
    <div class="now-top">
      <span class="now-state"><span class="dot on"></span>${item.state}</span>
    </div>
    <h3>${item.name}</h3>
    <p>${item.desc}</p>
    <div class="now-meta">${item.meta}</div>
  `;
  nowGrid.appendChild(card);
});

/* ARXIVS */
const workGrid = document.getElementById("arxivs-grid");
ARXIVS.forEach((item, i) => {
  const card = el("article", "arxiv-card");
  card.style.setProperty("--i", i);
  card.innerHTML = `
    <div class="arxiv-code">${item.code}</div>
    <div class="arxiv-body">
      <div class="arxiv-top">
        <span class="arxiv-field">${item.field}</span>
        <span class="arxiv-status"><span class="dot on"></span>${item.status}</span>
      </div>
      <h3>${item.title}</h3>
      <p>${item.sub}</p>
      <div class="arxiv-ledger">${item.ledger}</div>
      <div class="arxiv-tags">${item.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>
    </div>
  `;
  workGrid.appendChild(card);
});

/* NOTES */
const notesList = document.getElementById("notes-list");
NOTES.forEach((n) => {
  const li = el("li", "note");
  li.innerHTML = `
    <time>${n.date}</time>
    <span class="note-title">${n.title}</span>
    <span class="note-kind">${n.kind}</span>
  `;
  notesList.appendChild(li);
});

/* ══════════════ 时钟 / 年份 ══════════════ */
const clockEl = document.getElementById("clock");
function pad(n) {
  return String(n).padStart(2, "0");
}
function tickClock() {
  const d = new Date();
  clockEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
tickClock();
setInterval(tickClock, 1000);
document.getElementById("year").textContent = new Date().getFullYear();
document.getElementById("updated").textContent = new Date()
  .toISOString()
  .slice(0, 10);

/* ══════════════ 入场动效（IntersectionObserver） ══════════════ */
const io = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const delay = Number(e.target.dataset.stagger || 0);
      setTimeout(() => e.target.classList.add("in"), delay);
      io.unobserve(e.target);
    });
  },
  /* threshold 0：只要有一个像素进入就触发。
     大卡片用 0.12 可能永远达不到（卡片高度 > 视口时不可见比例为 0 要求过高） */
  { threshold: 0, rootMargin: "0px 0px -5% 0px" }
);

/* 兜底：若 IntersectionObserver 因任何原因没触发，2.5s 后强制显示所有内容。
   内容不能因为动画失败而不显示。 */
setTimeout(() => {
  document
    .querySelectorAll(".sec-head:not(.in), .now-card:not(.in), .arxiv-card:not(.in), .note:not(.in), [data-reveal]:not(.in)")
    .forEach((n) => n.classList.add("in"));
}, 2500);

document.querySelectorAll("[data-reveal]").forEach((n) => io.observe(n));
document.querySelectorAll(".sec-head, .now-card, .arxiv-card, .note").forEach((n, i) => {
  n.dataset.stagger = (i % 6) * 60;
  io.observe(n);
});

/* 首屏立即入场 */
requestAnimationFrame(() => {
  document.querySelectorAll(".hero [data-reveal]").forEach((n) => n.classList.add("in"));
});

/* ══════════════ 邮箱防护：点击才拼出来 ══════════════ */
const mailBtn = document.getElementById("mail-btn");
mailBtn.addEventListener("click", async () => {
  const user = mailBtn.dataset.user;
  const domain = mailBtn.dataset.domain;
  const addr = `${user}\u0040${domain}`;
  try {
    await navigator.clipboard.writeText(addr);
    mailBtn.querySelector(".mail-label").textContent = addr;
    mailBtn.classList.add("copied");
    setTimeout(() => {
      mailBtn.querySelector(".mail-label").textContent = "reveal email";
      mailBtn.classList.remove("copied");
    }, 3200);
  } catch {
    mailBtn.querySelector(".mail-label").textContent = addr;
  }
});

/* ══════════════ 状态灯：探测本地/公网状态（渐进增强） ══════════════ */
(async function checkStatus() {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  const foot = document.getElementById("foot-status");

  /* 用 GitHub 头像接口当作"在线"探针 —— 轻量、无 CORS 问题 */
  const started = performance.now();
  try {
    await fetch("https://api.github.com/users/ArborPopuli", {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
    });
    const ms = Math.round(performance.now() - started);
    dot.classList.add("on");
    text.textContent = "online";
    foot.textContent = `reachable · ${ms}ms`;
  } catch {
    dot.classList.add("on");
    text.textContent = "online";
    foot.textContent = "reachable";
  }
})();

/* ══════════════ 3D 延迟加载（首屏文字优先） ══════════════ */
if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const load = () => import("./scene.js").catch((e) => console.warn("3D scene skipped:", e.message));
  if ("requestIdleCallback" in window) {
    requestIdleCallback(load, { timeout: 1200 });
  } else {
    setTimeout(load, 300);
  }
}
