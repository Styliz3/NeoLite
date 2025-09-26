// Helpers
const $ = (q) => document.querySelector(q);
const chatEl = $("#chat");
const input = $("#input");
const plus = $("#plus");
const plusMenu = $("#plusMenu");
const webToggle = $("#webToggle");
const webBadge = $("#webBadge");
const modelSel = $("#model");
const reasonSel = $("#reason");
const sendBtn = $("#send");
const stopBtn = $("#stop");
const cleanBtn = $("#clean");

let abortCtrl = null;
let messages = [];

function addBubble(role, html) {
  const row = document.createElement("div");
  row.className = `row ${role}`;
  const b = document.createElement("div");
  b.className = `bubble ${role === "sys" ? "sys" : ""}`;
  b.innerHTML = html;
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
  wrap.innerHTML = `<header><strong>${title}</strong><span class="status">Writing…</span></header><pre><code></code></pre>`;
  return wrap;
}

function setWebBadge() { webBadge.textContent = `Web Search: ${webToggle.checked ? "On" : "Off"}`; }
setWebBadge();

// UI
plus.addEventListener("click", () => {
  plusMenu.classList.toggle("show");
});
document.addEventListener("click", (e) => {
  if (!plus.contains(e.target) && !plusMenu.contains(e.target)) plusMenu.classList.remove("show");
});
webToggle.addEventListener("change", setWebBadge);

cleanBtn.addEventListener("click", () => {
  messages = [];
  chatEl.innerHTML = `<div class="bubble sys">New chat. Use the <b>+</b> to enable Web Search.</div>`;
});

async function send() {
  const content = input.value.trim();
  if (!content) return;

  addBubble("user", `<div class="msg"></div>`).querySelector(".msg").textContent = content;
  messages.push({ role: "user", content });

  // Create AI bubble (text area + sources bar, code added lazily)
  const aiNode = addBubble("ai", "");
  const msgDiv = document.createElement("div");
  msgDiv.className = "msg";
  const sourcesBar = mkSourcesBar();
  aiNode.appendChild(sourcesBar);
  aiNode.appendChild(msgDiv);

  let inCode = false;
  let codeWrap = null;
  let codeNode = null;
  const foundLinks = new Set();

  // request
  sendBtn.disabled = true; stopBtn.style.display = "inline-block";
  abortCtrl = new AbortController();

  const body = {
    model: modelSel.value,
    reasoning_effort: reasonSel.value,
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
      const tip = res.status === 404
        ? "Server function not found (404). Ensure the file exists at /functions/api/chat.js and redeploy."
        : `Request failed: ${res.status}`;
      addBubble("sys", tip);
      throw new Error(tip);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const pushLinksFrom = (text) => {
      // Capture bare URLs and markdown [title](url)
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

          // Links to pills
          pushLinksFrom(delta);

          // Lazy code block handling
          if (delta.includes("```")) {
            // Start or end
            const opening = /```([a-z0-9+-_.]*)?/i;
            if (!inCode) {
              inCode = true;
              codeWrap = codeEmbed("Coding");
              aiNode.appendChild(codeWrap);
              codeNode = codeWrap.querySelector("code");
              // strip the opening fence from visible prose
              const stripped = delta.replace(opening, "");
              if (stripped.trim()) msgDiv.textContent += stripped;
            } else {
              inCode = false;
              codeWrap.querySelector(".status").textContent = "Done";
              // strip the closing fence
              const stripped = delta.replace(/```/g, "");
              if (stripped.trim()) msgDiv.textContent += stripped;
            }
            continue;
          }

          if (inCode) {
            codeWrap.querySelector(".status").textContent = "Writing…";
            codeNode.textContent += delta;
          } else {
            msgDiv.textContent += delta;
          }
        } catch {
          // ignore parse errors for partial lines
        }
      }
    }

    const finalText = msgDiv.textContent + (codeNode ? ("\n" + codeNode.textContent) : "");
    messages.push({ role: "assistant", content: finalText.trim() });
  } catch (e) {
    // already surfaced a system bubble above if needed
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
