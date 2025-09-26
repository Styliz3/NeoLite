// /functions/api/github.js
const GH = "https://api.github.com";

function json(data, status=200, headers={}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type":"application/json", ...headers }});
}
function redirect(url) { return Response.redirect(url, 302); }

export const onRequest = async ({ request, env }) => {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "me";
  const cookies = Object.fromEntries((request.headers.get("Cookie")||"").split(/;\s*/).filter(Boolean).map(v=>v.split("=")));
  const token = cookies.gh || null;

  // helpers
  const gh = (path, init={}) => fetch(GH+path, {
    ...init,
    headers: {
      "Accept": "application/vnd.github+json",
      ...(init.headers||{}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });

  if (action === "login") {
    const state = crypto.randomUUID();
    const params = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      redirect_uri: `${env.APP_BASE_URL}/api/github?action=callback`,
      scope: "repo",
      state
    });
    return redirect(`https://github.com/login/oauth/authorize?${params}`);
  }

  if (action === "callback") {
    const code = url.searchParams.get("code");
    if (!code) return json({error:"missing code"}, 400);
    // Exchange
    const r = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Accept":"application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${env.APP_BASE_URL}/api/github?action=callback`
      })
    });
    const js = await r.json();
    if (!js.access_token) return json({error:"oauth exchange failed", details:js}, 500);
    // set cookie
    const headers = {
      "Set-Cookie": `gh=${js.access_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`
    };
    return redirect(`${env.APP_BASE_URL}/`, { headers });
  }

  if (action === "logout" && request.method === "POST") {
    return new Response("ok", { status:200, headers: { "Set-Cookie":"gh=; Path=/; Max-Age=0" }});
  }

  if (!token) return json({ error:"unauthenticated" }, 401);

  if (action === "me") {
    const r = await gh("/user");
    return json(await r.json(), r.status);
  }

  if (action === "repos") {
    const r = await gh("/user/repos?per_page=100");
    return json(await r.json(), r.status);
  }

  if (action === "createRepo" && request.method === "POST") {
    const { name } = await request.json();
    const r = await gh("/user/repos", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ name, private:false, auto_init:true })
    });
    return json(await r.json(), r.status);
  }

  if (action === "list") {
    const repo = url.searchParams.get("repo");
    const path = url.searchParams.get("path") || "";
    const r = await gh(`/repos/${repo}/contents/${path}`);
    return json(await r.json(), r.status);
  }

  if (action === "get") {
    const repo = url.searchParams.get("repo");
    const path = url.searchParams.get("path");
    const r = await gh(`/repos/${repo}/contents/${path}`);
    const js = await r.json();
    if (r.status !== 200) return json(js, r.status);
    const content = js.content ? atob(js.content.replace(/\n/g,"")) : "";
    return json({ path, content, sha: js.sha });
  }

  if (action === "put" && request.method === "POST") {
    const repo = url.searchParams.get("repo");
    const { path, content } = await request.json();
    // check existing sha
    let sha = undefined;
    const head = await gh(`/repos/${repo}/contents/${path}`);
    if (head.status === 200) sha = (await head.json()).sha;
    const r = await gh(`/repos/${repo}/contents/${path}`, {
      method:"PUT",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({
        message: `neo.net update ${path}`,
        content: btoa(content),
        sha
      })
    });
    return json(await r.json(), r.status);
  }

  if (action === "del" && request.method === "POST") {
    const repo = url.searchParams.get("repo");
    const { path } = await request.json();
    const head = await gh(`/repos/${repo}/contents/${path}`);
    if (head.status !== 200) return json({error:"not found"}, 404);
    const js = await head.json();
    const r = await gh(`/repos/${repo}/contents/${path}`, {
      method:"DELETE",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ message:`neo.net delete ${path}`, sha: js.sha })
    });
    return json(await r.json(), r.status);
  }

  return json({ error:"unknown action" }, 400);
};
