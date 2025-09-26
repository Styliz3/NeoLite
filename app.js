const $ = (q)=>document.querySelector(q);
const landing=$("#landing"), builder=$("#builder");
const connect=$("#connect"), logout=$("#logout"), gitBadge=$("#gitBadge");
const repoList=$("#repoList"), newRepo=$("#newRepo");
const tree=$("#tree"), pathEl=$("#path"), srcEl=$("#source");
const createFile=$("#createFile"), deleteFile=$("#deleteFile"), saveAll=$("#saveAll");
const promptEl=$("#prompt"), generate=$("#generate"), planEl=$("#plan");
const srcBar=$("#srcBar"), preview=$("#preview");

let gh = { token:null, user:null, repo:null, defaultBranch:"main", pending: new Map() };

function show(el, yes){ el.classList.toggle("hidden", !yes); }
function mdPlan(prompt){
  // tiny deterministic planner to guide coding steps
  const base = [
    "Clarify requirements & constraints",
    "Choose stack & directory structure",
    "Scaffold pages/components",
    "Implement core logic & API calls",
    "Wire UI events and state",
    "Add preview route and static index",
    "Commit & deploy"
  ];
  const lines = ["• " + base.join("\n• ")];
  planEl.textContent = lines.join("\n");
}

// --- OAuth ---
async function getMe(){
  const r = await fetch("/api/github?action=me"); 
  if(!r.ok) return null;
  return r.json();
}
async function login(){ window.location.href="/api/github?action=login"; }
async function logoutFn(){ await fetch("/api/github?action=logout",{method:"POST"}); location.reload(); }

// --- Repo & files ---
async function listRepos(){
  const r = await fetch("/api/github?action=repos");
  const js = await r.json();
  repoList.innerHTML = "";
  js.forEach(x=>{
    const o=document.createElement("option");
    o.value = x.full_name; o.textContent = x.full_name;
    repoList.appendChild(o);
  });
  if (js[0]) { repoList.value = js[0].full_name; gh.repo = js[0].full_name; loadTree(); }
}
async function createNewRepo(){
  const name = prompt("New repo name (will be public):","neo-app");
  if(!name) return;
  await fetch("/api/github?action=createRepo",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});
  await listRepos();
}
repoList.addEventListener("change", ()=>{ gh.repo=repoList.value; loadTree(); });

async function loadTree(){
  tree.innerHTML="";
  const r = await fetch(`/api/github?action=list&repo=${encodeURIComponent(gh.repo)}&path=`);
  const js = await r.json();
  renderTree(js);
  // set preview to the Cloudflare site if you deploy this repo; placeholder otherwise:
  preview.src = "about:blank";
}
function renderTree(items){
  tree.innerHTML="";
  items.forEach(it=>{
    const row=document.createElement("div"); row.className="item";
    const left=document.createElement("div"); left.textContent=it.path;
    const right=document.createElement("div"); right.className="small"; right.textContent=it.type;
    row.append(left,right);
    row.onclick = ()=> openFile(it.path);
    tree.append(row);
  });
}
async function openFile(p){
  const r = await fetch(`/api/github?action=get&repo=${encodeURIComponent(gh.repo)}&path=${encodeURIComponent(p)}`);
  const js = await r.json();
  pathEl.value = p; srcEl.value = js.content || "";
}
async function saveFile(){
  const p = pathEl.value.trim(); if(!p) return alert("Path required");
  const content = srcEl.value;
  await fetch(`/api/github?action=put&repo=${encodeURIComponent(gh.repo)}`,{
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({path:p, content})
  });
  await loadTree();
}
async function removeFile(){
  const p = pathEl.value.trim(); if(!p) return;
  if(!confirm("Delete file?")) return;
  await fetch(`/api/github?action=del&repo=${encodeURIComponent(gh.repo)}`,{
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({path:p})
  });
  pathEl.value=""; srcEl.value="";
  await loadTree();
}
createFile.onclick = saveFile;
deleteFile.onclick = removeFile;

// Commit all “pending” changes (we commit per save; this can remain a no-op or trigger preview refresh)
saveAll.onclick = ()=>{ alert("Committed! (Each save already commits). Your Cloudflare Pages build will pick it up."); };

// --- AI assist (optional) ---
function addSourcePills(text){
  srcBar.innerHTML="";
  const urls = new Set();
  const urlRe = /\bhttps?:\/\/[^\s)]+/g;
  const mdRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let m; while((m=urlRe.exec(text))) urls.add(m[0]);
  while((m=mdRe.exec(text))) urls.add(m[2]);
  urls.forEach(u=>{
    const a=document.createElement("a"); a.href=u; a.target="_blank"; a.rel="noopener"; a.className="src-pill";
    a.textContent=new URL(u).hostname.replace(/^www\./,"");
    srcBar.append(a);
  });
}
generate.onclick = async ()=>{
  const prompt = promptEl.value.trim();
  if(!prompt) return;
  mdPlan(prompt);
  const r = await fetch("/api/chat",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      model:"openai/gpt-oss-120b",
      messages:[{role:"user",content:`Generate minimal files for this app:\n${prompt}\nReturn a list of files with paths and their contents as fenced blocks like:\n---\npath: index.html\n\`\`\`html\n...\n\`\`\`\n---`}],
      stream:false, web_search:true, temperature:1, top_p:1
    })
  });
  if(!r.ok){ alert("Generator error "+r.status); return; }
  const j = await r.json();
  const content = j.choices?.[0]?.message?.content || "";
  addSourcePills(content);

  // Very simple parser: split on "---\npath: ..."
  const parts = content.split("\n---").map(s=>s.trim()).filter(Boolean);
  let created = 0;
  for(const part of parts){
    const m = part.match(/path:\s*(.+)\n```([\s\S]*?)\n```/);
    if(!m) continue;
    const p = m[1].trim();
    const body = m[2];
    pathEl.value = p; srcEl.value = body;
    await saveFile(); created++;
  }
  alert(`Created/updated ${created} files`);
  await loadTree();
};

// --- boot ---
connect.onclick = login;
logout.onclick = logoutFn;
(async ()=>{
  const me = await getMe();
  if(me && me.login){
    gh.user = me; show(logout,true);
    gitBadge.textContent = `Git: ${me.login}`;
    show(landing,false); show(builder,true);
    await listRepos();
  } else {
    show(landing,true); show(builder,false);
  }
})();
