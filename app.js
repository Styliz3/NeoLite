// Local project store
const project = new Map(); // path -> text
const $ = (q)=>document.querySelector(q);

// UI elements
const promptEl=$("#prompt"), starGo=$("#starGo"), generate=$("#generate"), downloadZip=$("#downloadZip");
const tree=$("#tree"), pathEl=$("#path"), srcEl=$("#source");
const createFile=$("#createFile"), deleteFile=$("#deleteFile"), newIndex=$("#newIndex");
const launch=$("#launch"), preview=$("#preview");
const consoleEl=$("#console"), runPy=$("#runPy"), runJs=$("#runJs");
const planEl=$("#plan"), srcBar=$("#srcBar");
const toast=$("#toast");

// --- helpers ---
function toastMsg(msg){ toast.textContent=msg; toast.classList.add("show"); setTimeout(()=>toast.classList.remove("show"), 3000); }
function setFile(path, content){ project.set(path, content); renderTree(); }
function delFile(path){ project.delete(path); renderTree(); }
function getFile(path){ return project.get(path) ?? ""; }
function renderTree(){
  tree.innerHTML="";
  [...project.keys()].sort().forEach(p=>{
    const row=document.createElement("div"); row.className="item";
    const left=document.createElement("div"); left.textContent=p;
    const right=document.createElement("div"); right.className="small"; right.textContent=p.split(".").pop();
    row.append(left,right); row.onclick=()=>{ pathEl.value=p; srcEl.value=getFile(p); };
    tree.append(row);
  });
}
function mdPlan(){ // readable plan
  const base=[
    "Clarify requirements & inputs",
    "Choose stack & layout",
    "Scaffold files & minimal styles",
    "Implement core logic / state",
    "Wire UI events & preview",
    "Test, iterate, refine",
    "Export ZIP / (later) connect Git"
  ];
  planEl.textContent="• "+base.join("\n• ");
}
function addSourcePills(text){
  srcBar.innerHTML="";
  const urls=new Set();
  const urlRe=/\bhttps?:\/\/[^\s)]+/g, mdRe=/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let m; while((m=urlRe.exec(text))) urls.add(m[0]); while((m=mdRe.exec(text))) urls.add(m[2]);
  urls.forEach(u=>{ const a=document.createElement("a"); a.href=u; a.target="_blank"; a.rel="noopener"; a.className="src-pill"; a.textContent=new URL(u).hostname.replace(/^www\./,""); srcBar.append(a); });
}

// --- File ops ---
createFile.onclick = ()=>{ const p=pathEl.value.trim(); if(!p) return toastMsg("Path required"); setFile(p, srcEl.value); toastMsg("Saved"); };
deleteFile.onclick = ()=>{ const p=pathEl.value.trim(); if(!p) return; if(confirm("Delete file?")){ delFile(p); pathEl.value=""; srcEl.value=""; toastMsg("Deleted"); } };
newIndex.onclick = ()=>{
  if (!project.has("index.html")) {
    setFile("index.html", `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Neo App</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<script defer src="script.js"></script>
<style>body{font:16px system-ui;margin:40px} .box{padding:16px;border-radius:12px;border:1px solid #e5e7eb}</style>
</head><body>
<h1>Hello from Neo.net</h1>
<div class="box">Edit <code>index.html</code> and <code>script.js</code>, then “Launch / Preview”.</div>
</body></html>`);
  }
  if (!project.has("script.js")) setFile("script.js", `console.log("Neo script loaded")`);
  toastMsg("Scaffold created");
};

// --- Preview ---
function refreshPreview(){
  const html = project.get("index.html");
  if(!html){ preview.src="about:blank"; toastMsg("index.html not found"); return; }
  const files = Object.fromEntries(project);

  // inline relative scripts & styles for same-path files
  let patched = html.replace(/<script\s+src=["']([^"']+)["']\s*><\/script>/g,(m,src)=>{
    const code = files[src]; if(!code) return m;
    const blobURL = URL.createObjectURL(new Blob([code],{type:"text/javascript"}));
    return `<script src="${blobURL}"></script>`;
  }).replace(/<link\s+rel=["']stylesheet["']\s+href=["']([^"']+)["'][^>]*>/g,(m,href)=>{
    const css = files[href]; if(!css) return m;
    return `<style>${css}</style>`;
  });

  const blob = new Blob([patched],{type:"text/html"});
  preview.src = URL.createObjectURL(blob);
  toastMsg("Preview refreshed");
}
launch.onclick = refreshPreview;

// --- Console ---
function logToConsole(s){ consoleEl.textContent += s + "\n"; }
function clearConsole(){ consoleEl.textContent=""; }

// JS sandbox
runJs.onclick = ()=>{
  clearConsole();
  const js = project.get("script.js");
  if(!js) return logToConsole("script.js not found");
  const iframe = document.createElement("iframe");
  iframe.style.display="none"; document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  win.console.log = (...a)=>logToConsole(a.map(String).join(" "));
  win.console.error = (...a)=>logToConsole("ERROR: "+a.map(String).join(" "));
  try { win.eval(js); logToConsole("script.js executed"); } catch(e){ logToConsole("ERROR: "+e.message); }
  setTimeout(()=>iframe.remove(), 0);
};

// Python via Pyodide (lazy)
let pyodidePromise=null;
async function ensurePyodide(){
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = new Promise((resolve)=>{
    const s=document.createElement("script");
    s.src="https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js";
    s.onload=async()=>resolve(await loadPyodide());
    document.head.appendChild(s);
  });
  return pyodidePromise;
}
runPy.onclick = async ()=>{
  clearConsole();
  const code = project.get("main.py");
  if(!code) return logToConsole("main.py not found");
  logToConsole("Loading Pyodide…");
  const py = await ensurePyodide();
  py.setStdout({batched:(s)=>logToConsole(s.trim())});
  py.setStderr({batched:(s)=>logToConsole("ERR: "+s.trim())});
  try { await py.runPythonAsync(code); logToConsole("main.py finished"); }
  catch(e){ logToConsole("ERR: "+e); }
};

// ZIP
downloadZip.onclick = async ()=>{
  if (project.size === 0) return toastMsg("No files to export");
  const zip = new JSZip();
  for (const [p,txt] of project) zip.file(p, txt);
  const blob = await zip.generateAsync({type:"blob"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "neo-project.zip";
  a.click();
  toastMsg("ZIP ready");
};

// --- Local “generator” with graceful backend fallback ---
async function tryBackendGenerate(prompt){
  try{
    const r = await fetch("/api/chat",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        model:"openai/gpt-oss-120b",
        messages:[{role:"user",content:`Create a minimal project for:\n${prompt}\nReturn a list of files with paths and contents in this format:\n---\npath: path.ext\n\`\`\`\n<content>\n\`\`\`\n---\nUse index.html for web preview.`}],
        stream:false, web_search:true, temperature:1, top_p:1
      })
    });
    if (!r.ok) throw new Error("HTTP "+r.status);
    const j = await r.json();
    return j.choices?.[0]?.message?.content || "";
  }catch(e){
    throw e; // let caller decide fallback
  }
}
function localScaffold(prompt){
  // very small deterministic scaffold
  const title = "Neo App";
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<style>body{font:16px system-ui;margin:40px} .box{padding:16px;border-radius:12px;border:1px solid #e5e7eb}</style>
</head><body>
<h1>${title}</h1>
<p class="box">Prompt: ${prompt.replace(/</g,"&lt;")}</p>
<button id="add">Add item</button>
<ul id="list"></ul>
<script src="script.js"></script>
</body></html>`;
  const js = `const list=document.getElementById("list");
document.getElementById("add").onclick = ()=>{ const li=document.createElement("li"); li.textContent="Item "+(list.children.length+1); list.appendChild(li); };`;
  return [
    { path:"index.html", content:html },
    { path:"script.js", content:js }
  ];
}
function parseAndApply(content){
  // parse “--- path: … ``` … ```” blocks
  const parts = content.split("\n---").map(s=>s.trim()).filter(Boolean);
  let created=0;
  for(const part of parts){
    const m = part.match(/path:\s*(.+)\n```(?:[a-z0-9+_.-]*)?\n([\s\S]*?)\n```/i);
    if(!m) continue;
    const p = m[1].trim(), body = m[2];
    setFile(p, body); created++;
  }
  return created;
}
function addSourcePillsFrom(text){ addSourcePills(text); }

// Generate button (& star button)
async function onGenerate(){
  const prompt = promptEl.value.trim();
  if(!prompt){ toastMsg("Write your idea first"); return; }
  mdPlan();
  // Try backend; if 400/404/429 or any failure, fall back locally
  try{
    const text = await tryBackendGenerate(prompt);
    addSourcePillsFrom(text);
    const n = parseAndApply(text);
    toastMsg(n ? `Created ${n} files` : "No files parsed; using local scaffold");
    if (!n) localScaffold(prompt).forEach(f=>setFile(f.path,f.content));
  }catch{
    // graceful fallback
    const files = localScaffold(prompt);
    files.forEach(f=>setFile(f.path, f.content));
    toastMsg("Backend unavailable (400/404/429). Used local scaffold.");
  }
  refreshPreview();
}
starGo.onclick = onGenerate;
generate.onclick = onGenerate;

// Seed starter
if (!project.has("index.html")) {
  setFile("index.html", `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Neo Starter</title>
<style>body{font:16px system-ui;margin:40px} .box{padding:16px;border-radius:12px;border:1px solid #e5e7eb}</style>
</head><body><h1>Neo.net Test Mode</h1><div class="box">Use the ⭐ or Generate. Then edit files and Preview.</div><script src="script.js"></script></body></html>`);
  setFile("script.js", `console.log("Hello from Neo Test Mode");`);
}
