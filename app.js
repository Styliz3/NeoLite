// --- tiny helpers ---
const $ = (q) => document.querySelector(q);
const chatEl = $("#chat");
const input = $("#input");
const plus = $("#plus");
const plusMenu = $("#plusMenu");
const webA = $("#websearch");
const webB = $("#websearch2");
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
  b.className = `bubble ${role === "ai" ? "ai" : role === "sys" ? "sys" : ""}`;
  b.innerHTML = html;
  row.appendChild(b);
  chatEl.appendChild(row);
  chatEl.parentElement.scrollTop = chatEl.parentElement.scrollHeight;
  return b;
}

function codeEmbed(title = "Coding") {
  const wrap = document.createElement("div");
  wrap.className = "code-embed";
  wrap.innerHTML = `<header><strong>${title}</strong><span class="status">Writing…</span></header><pre><code></code></pre>`;
  return wrap;
}

plus.addEventListener("click", () => {
  plusMenu.classList.toggle("show");
});

webA.addEventListener("change", () => (webB.checked = webA.checked));
webB.addEventListener("change", () => (webA.checked = webB.checked));

cleanBtn.addEventListener("click", () => {
  messages = [];
  chatEl.innerHTML = `<div class="bubble sys">New chat started. Web Search can be toggled with the “+” button near the composer.</div>`;
});

async function send() {
  const content = input.value.trim();
  if (!content) return;
  plusMenu.classList.remove("show");
  addBubble("user", content);
  messages.push({ role: "user", content });

  // AI bubble (stream target)
  const aiNode = addBubble("ai", "");
  const codeWrap = codeEmbed("Coding");
  let inCode = false;
  let codeNode = null;
  aiNode.appendChild(codeWrap);
  codeNode = codeWrap.querySelector("code");

  // start request
  sendBtn.disabled = true; stopBtn.style.display = "inline-block";
  abortCtrl = new AbortController();

  const body = {
    model: modelSel.value,
    reasoning_effort: reasonSel.value,
    web_search: webA.checked,
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

    // Stream (SSE from OpenAI-compatible endpoint)
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Process Server-Sent Events lines
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

          // naive code fence detection to flip status/presentation
          if (delta.includes("```")) {
            inCode = !inCode;
          }
          if (inCode) {
            codeWrap.querySelector(".status").textContent = "Writing…";
            codeNode.textContent += delta;
          } else {
            codeWrap.querySelector(".status").textContent = "Done";
            aiNode.firstChild
          }
          // Also mirror text outside of code block for normal prose
          // (keep it minimal; show above the embed)
          if (!aiNode.dataset.hasText) {
            const p = document.createElement("div");
            p.className = "mbody";
            aiNode.insertBefore(p, codeWrap);
            aiNode.dataset.hasText = "1";
          }
          aiNode.querySelector(".mbody").textContent += delta;
        } catch { /* ignore parse errors */ }
      }
    }
    // Add assistant message to transcript
    const finalText = (aiNode.querySelector(".mbody")?.textContent || "") +
                      "\n" + (codeNode.textContent || "");
    messages.push({ role: "assistant", content: finalText.trim() });
  } catch (e) {
    addBubble("sys", "Generation stopped or failed.");
  } finally {
    sendBtn.disabled = false; stopBtn.style.display = "none"; input.value = "";
    abortCtrl = null;
  }
}

sendBtn.addEventListener("click", send);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault(); send();
  }
});
stopBtn.addEventListener("click", () => abortCtrl?.abort());
