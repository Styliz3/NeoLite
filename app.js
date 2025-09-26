// Helpers
const $ = (q) => document.querySelector(q);
const chatEl = $("#chat");
const input = $("#input");
const plus = $("#plus");
const plusMenu = $("#plusMenu");
const webToggle = $("#webToggle");
const webBadge = $("#webBadge");
const modelSel = $("#model");
const reasonSel = $("#reason"); // now controls local planner intensity only
const sendBtn = $("#send");
const stopBtn = $("#stop");
const cleanBtn = $("#clean");

let abortCtrl = null;
let messages = [];

// Minimal Markdown → HTML (headings, bold, italics, lists, inline code, links)
function md(html) {
  let t = html.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  t = t.replace(/^### (.*)$/gm, "<h3>$1</h3>")
       .replace(/^## (.*)$/gm, "<h2>$1</h2>")
       .replace(/^# (.*)$/gm, "<h1>$1</h1>");
  t = t.replace(/^\s*[-*] (.*)$/gm, "<li>$1</li>").replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
       .replace(/\*(.+?)\*/g, "<em>$1</em>")
       .replace(/`([^`]+?)`/g, "<code>$1</code>");
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, `<a href="$2" target="_blank" rel="noopener">$1</a>`);
  t = t.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, "<br/>")}</p>`).join("");
  return t;
}

function addBubble(role, nodeOrHTML) {
  const row = document.createElement("div");
  row.className = `row ${role}`;
  const b = document.createElement("div");
  b.className = `bubble ${role === "sys" ? "sys" : ""}`;
  if (typeof nodeOrHTML === "string") b.innerHTML = nodeOrHTML; else b.appendChild(nodeOrHTML);
  row.appendChild(b);
  chatEl.appendChild(row);
  chatEl.parentElement.scrollTop = chatEl.parentElement.scrollHeight;
  return b;
}

function mkSourcesBar() {
  const s = document.createElement("div");
  s.className = "sources";
  return s;
}

function codeEmbed(title = "Coding") {
  const wrap = document.createElement("div");
  wrap.className = "code-embed";
  wrap.innerHTML = `<header><strong>${title}</strong><span class="status">Writing…</span></header><pre class="block"><code></code></pre>`;
  return wrap;
}

function thinkPanel() {
  const d = document.createElement("details");
  d.className = "think";
  d.innerHTML = `<summary>Reasoning (advanced)</summary><pre><code>planning…</code></pre>`;
  return d;
}

function setWebBadge() {
  webBadge.textContent = `Web Search: ${webToggle.checked ? "On" : "Off"}`;
}
setWebBadge();

// UI
plus.addEventListener("click", () => plusMenu.classList.toggle("show"));
document.addEventListener("click", (e) => {
  if (!plus.contains(e.target) && !plusMenu.contains(e.target)) plusMenu.classList.remove("show");
});
webToggle.addEventListener("change", setWebBadge);

cleanBtn.addEventListener("click", () => {
  messages = [];
  chatEl.innerHTML = `<div class="bubble sys">New chat. Use the <b>+</b> to enable Web Search.</div>`;
});

// ---------- Local “Advanced Thinking” (client-only planner) ----------
function localPlan(text, level = "medium") {
  // naive verb-first decomposition, tuned for coding tasks
  const maxSteps = level === "high" ? 8 : level === "low" ? 4 : 6;
  // normalize
  const sents = text
    .replace(/[\r\n]+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .slice(0, 5);

  const verbs = ["design","plan","create","build","code","implement","write","refactor","debug","test","document","optimize","deploy","style","render","stream","fetch","parse","validate"];
  const steps = [];
  for (const s of sents) {
    // pull inline actions
    const parts = s.split(/,\s*|;\s*| and /i);
    for (let p of parts) {
      p = p.trim();
      const v = verbs.find(vb => new RegExp(`\\b${vb}(?:ing|ed)?\\b`, "i").test(p));
      if (v) steps.push(p.replace(/^\d+\.\s*/,""));
    }
  }
  // backfill generic flow if empty
  if (!steps.length) {
    steps.push("Clarify requirements and inputs",
               "Sketch data structures and API shape",
               "Implement core logic in small functions",
               "Add minimal UI and wire up events",
               "Test with examples and edge cases",
               "Polish, document, and ship");
  }
  return steps.slice(0, maxSteps);
}

// --------------------------------------------------------------------

async function send() {
  const content = input.value.trim();
  if (!content) return;

  // user bubble
  const u = document.createElement("div");
  u.className = "msg";
  u.innerHTML = md(content);
  addBubble("user", u);
  messages.push({ role: "user", content });

  // AI bubble (sources + optional think + text; code added lazily)
  const aiNode = document.createElement("div");
  const sourcesBar = mkSourcesBar();
  const msgDiv = document.createElement("div");
  msgDiv.className = "msg";
  aiNode.appendChild(sourcesBar);

  // Always show our local planner (no Groq reasoning)
  const plan = localPlan(content, reasonSel.value);
  const think = thinkPanel();
  think.querySelector("code").textContent = ["- " + plan.join("\n- ")].join("\n");
  aiNode.appendChild(think);

  aiNode.appendChild(msgDiv);
  addBubble("ai", aiNode);

  let inCode = false;
  let codeWrap = null;
  let codeNode = null;
  const foundLinks = new Set();

  // request
  sendBtn.disabled = true; stopBtn.style.display = "inline-block";
  abortCtrl = new AbortController();

  const body = {
    model: modelSel.value,
    // no reasoning_effort at all
    // web search still available
    web_search: webToggle.checked,
    messages,
    temperature: 1,
    top_p: 1,
    stream: true
  };

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      signal: abortCtrl.signal
    });

    if (!res.ok || !res.body) {
      let tip;
      if (res.status === 404) {
        tip = "Server function not found (404). You must deploy a Git-based Pages project with /functions/api/chat.js at repo root.";
      } else if (res.status === 429) {
        tip = "Too many requests (429) to the upstream API. Slow down or check Groq rate limits.";
      } else {
        tip = `Request failed: ${res.status}`;
      }
      addBubble("sys", tip);
      throw new Error(tip);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const pushLinksFrom = (text) => {
      const urlRegex = /\bhttps?:\/\/[^\s)]+/g;
      const mdRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
      let m;
      while ((m = urlRegex.exec(text))) {
        const url = m[0];
        if (foundLinks.has(url)) continue;
        foundLinks.add(url);
        const a = document.createElement("a");
        a.href = url; a.target = "_blank"; a.rel = "noopener";
        a.className = "src-pill";
        a.textContent = new URL(url).hostname.replace(/^www\./, "");
        sourcesBar.appendChild(a);
      }
      while ((m = mdRegex.exec(text))) {
        const url = m[2];
        if (foundLinks.has(url)) continue;
        foundLinks.add(url);
        const a = document.createElement("a");
        a.href = url; a.target = "_blank"; a.rel = "noopener";
        a.className = "src-pill";
        a.textContent = m[1].slice(0, 28);
        sourcesBar.appendChild(a);
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      for (;;) {
        const idx = buffer.indexOf("\n\n");
        if (idx < 0) break;
        const raw = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 2);
        if (!raw.startsWith("data:")) continue;
        const data = raw.slice(5).trim();
        if (data === "[DONE]") break;

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || "";
          if (!delta) continue;

          // source bubbles
          pushLinksFrom(delta);

          // code fences
          if (delta.includes("```")) {
            if (!inCode) {
              inCode = true;
              codeWrap = codeEmbed("Coding");
              aiNode.appendChild(codeWrap);
              codeNode = codeWrap.querySelector("code");
              const stripped = delta.replace(/```[a-z0-9+_.-]*/i, "");
              if (stripped.trim()) msgDiv.innerHTML += md(stripped);
            } else {
              inCode = false;
              codeWrap.querySelector(".status").textContent = "Done";
              const stripped = delta.replace(/```/g, "");
              if (stripped.trim()) msgDiv.innerHTML += md(stripped);
            }
            continue;
          }

          if (inCode) {
            codeWrap.querySelector(".status").textContent = "Writing…";
            codeNode.textContent += delta;
          } else {
            msgDiv.innerHTML += md(delta);
          }
        } catch {}
      }
    }

    const finalText =
      msgDiv.textContent + (codeNode ? ("\n" + codeNode.textContent) : "");
    messages.push({ role: "assistant", content: finalText.trim() });
  } catch (e) {
    // already surfaced via sys bubble
  } finally {
    sendBtn.disabled = false; stopBtn.style.display = "none"; input.value = "";
    abortCtrl = null;
  }
}

sendBtn.addEventListener("click", send);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
stopBtn.addEventListener("click", () => abortCtrl?.abort());
