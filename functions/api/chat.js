// /functions/api/chat.js  (must exist to avoid 404)
export const onRequestPost = async ({ request, env }) => {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) return new Response("GROQ_API_KEY is missing", { status: 500 });

  const body = await request.json();

  const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
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
