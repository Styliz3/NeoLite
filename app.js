// --- local in-browser project store ---
const project = new Map(); // path -> text
const $ = (q)=>document.querySelector(q);
const tree=$("#tree"), pathEl=$("#path"), srcEl=$("#source");
const newIndex=$("#newIndex"), createFile=$("#createFile"), deleteFile=$("#deleteFile");
const downloadZip=$("#downloadZip"), launch=$("#launch");
const preview=$("#preview"), consoleEl=$("#console");
const promptEl=$("#prompt"), generate=$("#generate"), planEl=$("#plan"), srcBar=$("#srcBar");
const runPy=$("#runPy"), runJs=$("#runJs");

function setFile(path, content){ project.set(path, content); renderTree(); }
function delFile(path){ project.delete(path); renderTree(); }
function getFile(path){ return project.get(path) ?? ""; }

function renderTree(){
  tree.innerHTML="";
  [...project.keys()].sort().forEach(p=>{
    const row=document.createElement("div"); row.className="item";
    const left=document.createElement("div"); left.textContent=p;
    const right=document.createElement("div"); right.className="small"; right.textContent=p.split(".").pop();
    row.append(left,right);
    row.onclick=()=>{ pathEl.value=p; srcEl.value=getFile(p); };
    tree.append(row);
  });
}

function mdPlan(prompt){
  const base=[
    "Clarify requirements & inputs",
    "Choose stack & file layout",
    "Scaffold UI (pages/components)",
    "Implement core logic / API calls",
    "Wire events & state",
    "Add index.html + preview route",
    "Test, iterate, export ZIP"
  ];
  planEl.textContent="• "+base.join("\n• ");
}

function addSourcePills(text){
  srcBar.innerHTML="";
  const urls=new Set();
  const urlRe=/\bhttps?:\/\/[^\s)]+/g; const mdRe=/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let m; while((m=urlRe.exec(text))) urls.add(m[0]); while((m=mdRe.exec(text))) urls.add(m[2]);
  urls.forEach(u=>{ const a=document.createElement("a"); a.href=u; a.target="_blank"; a.rel="noopener";
    a.className="src-pill"; a.textContent=new URL(u).hostname.replace(/^www\./,""); srcBar.append(a); });
}

// --- File ops UI ---
createFile.onclick = ()=>{ const p=pathEl.value.trim(); if(!p) return alert("Path required"); setFile(p, srcEl.value); };
deleteFile.onclick = ()=>{ const p=pathEl.value.trim(); if(!p) return; if(confirm("Delete file?")){ delFile(p); pathEl.value=""; srcEl.value=""; } };
newIndex.onclick = ()=>{
  if (!project.has("index.html")) {
    setFile("index.html", `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Neo App</title><style>body{font:16px system-ui;margin:40px} .box{padding:16px;border-radius:12px;border:1px solid #e5e7eb}</style></head>
<body><h1>Hello from Neo.net</h1><div class="box">Edit <code>index.html</code>, click “Launch/Preview”</div><script src="script.js"></script></body></html>`);
  }
  if (!project.has("script.js")) setFile("script.js", `console.log("Neo script loaded")`);
  renderTree();
};

// --- Web preview (HTML/JS) ---
function refreshPreview(){
  const html = project.get("index.html");
  if(!html){ preview.src="about:blank"; return; }
  const files = Object.fromEntries(project);
  // Rewrite <script src="..."> to inline blobs for local files
  let patched = html.replace(/<script\s+src=["']([^"']+)["']\s*><\/script>/g,(m,src)=>{
    const code = files[src]; if(!code) return m;
    const blobURL = URL.createObjectURL(new Blob([code],{type:"text/javascript"}));
    return `<script src="${blobURL}"></script>`;
  });
  // Inline relative stylesheets
  patched = patched.replace(/<link\s+rel=["']stylesheet["']\s+href=["']([^"']+)["'][^>]*>/g,(m,href)=>{
    const css = files[href]; if(!css) return m;
    return `<style>${css}</style>`;
  });
  const blob = new Blob([patched],{type:"text/html"});
  preview.src = URL.createObjectURL(blob);
}
launch.onclick = refreshPreview;

// --- Console helpers ---
function logToConsole(s){ consoleEl.textContent += s + "\n"; }
function clearConsole(){ consoleEl.textContent=""; }

// --- Run JS (sandbox) ---
runJs.onclick = ()=>{
  clearConsole();
  const js = project.get("script.js");
  if(!js) return logToConsole("script.js not found");
  // run inside a sandboxed iframe so console logs are captured
  const iframe = document.createElement("iframe");
  iframe.style.display="none"; document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  win.console.log = (...args)=>logToConsole(args.map(String).join(" "));
  win.console.error = (...args)=>logToConsole("ERROR: "+args.map(String).join(" "));
  try { win.eval(js); logToConsole("script.js executed"); } catch(e){ logToConsole("ERROR: "+e.message); }
  setTimeout(()=>iframe.remove(), 0);
};

// --- Run Python (Pyodide) ---
let pyodidePromise = null;
async function ensurePyodide(){
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = new Promise(async (resolve)=>{
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js";
    s.onload = async ()=>{
      const py = await loadPyodide(); resolve(py);
    };
    document.head.appendChild(s);
  });
  return pyodidePromise;
}
runPy.onclick = async ()=>{
  clearConsole();
  const code = project.get("main.py");
  if(!code) return logToConsole("main.py not found");
  logToConsole("Loading Pyodide… (first time only)");
  const py = await ensurePyodide();
  py.setStdout({batched:(s)=>logToConsole(s.trim())});
  py.setStderr({batched:(s)=>logToConsole("ERR: "+s.trim())});
  try { await py.runPythonAsync(code); logToConsole("main.py finished"); }
  catch(e){ logToConsole("ERR: "+e); }
};

// --- ZIP download ---
downloadZip.onclick = async ()=>{
  if (project.size === 0) return alert("No files to export");
  const zip = new JSZip();
  for (const [p,txt] of project) zip.file(p, txt);
  const blob = await zip.generateAsync({type:"blob"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "neo-project.zip";
  a.click();
};

// --- AI generation (optional; needs your /functions/api/chat.js to be deployed) ---
generate.onclick = async ()=>{
  const prompt = promptEl.value.trim(); if(!prompt) return;
  mdPlan(prompt);
  let res;
  try {
    res = await fetch("/api/chat",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        model:"openai/gpt-oss-120b",
        messages:[{role:"user",content:`Create a minimal project for:\n${prompt}\nReturn a list of files with paths and contents in this format:\n---\npath: relative/path.ext\n\`\`\`<lang>\n<content>\n\`\`\`\n---\nUse index.html for web preview.`}],
        stream:false, web_search:true, temperature:1, top_p:1
      })
    });
  } catch { alert("Generator requires /functions/api/chat.js (or add files manually)."); return; }
  if (!res.ok) { alert("Generator failed: "+res.status); return; }
  const j = await res.json();
  const content = j.choices?.[0]?.message?.content || "";
  addSourcePills(content);

  const parts = content.split("\n---").map(s=>s.trim()).filter(Boolean);
  let created = 0;
  for(const part of parts){
    const m = part.match(/path:\s*(.+)\n```(?:[a-z0-9+_.-]*)?\n([\s\S]*?)\n```/i);
    if(!m) continue;
    const p = m[1].trim();
    const body = m[2];
    setFile(p, body); created++;
  }
  alert(`Added ${created} files`);
  refreshPreview();
};

function mdPlan(p){ // tiny helper here too
  const base = [
    "Clarify requirements & inputs",
    "Choose stack & layout",
    "Scaffold files & routes",
    "Implement core logic",
    "Hook events/state",
    "Preview & refine",
    "Export ZIP / Deploy"
  ];
  planEl.textContent = "• " + base.join("\n• ");
}

// Seed a starter file so preview works right away
if (!project.has("index.html")) {
  setFile("index.html", `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Neo Starter</title>
<style>body{font:16px system-ui;margin:40px} .box{padding:16px;border-radius:12px;border:1px solid #e5e7eb}</style>
</head><body><h1>Neo.net Test Mode</h1><div class="box">Edit files, click “Launch / Preview”, or “Run main.py”.</div><script src="script.js"></script></body></html>`);
  setFile("script.js", `console.log("Hello from Neo Test Mode");`);
}
