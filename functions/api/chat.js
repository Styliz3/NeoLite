// Path must be: /functions/api/chat.js  (repo root)
// Exposes POST /api/chat
export const onRequestPost = async ({ request, env }) => {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) return new Response("GROQ_API_KEY is missing", { status: 500 });

  const {
    model,
    messages,
    temperature = 1,
    top_p = 1,
    stream = true,
    reasoning_effort = "medium",
    web_search = false
  } = await request.json();

  const tools = web_search ? [{ type: "browser_search" }] : [];

  const payload = {
    model,
    messages,
    temperature,
    top_p,
    max_completion_tokens: 8192,
    stream,
    reasoning_effort,
    stop: null,
    tools
  };

  const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    }
  });
};
