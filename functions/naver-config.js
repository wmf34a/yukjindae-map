export async function onRequestGet(context) {
  const { env } = context;
  const body = `window.__ENV__ = ${JSON.stringify({
    NAVER_MAP_CLIENT_ID: env.NAVER_MAP_CLIENT_ID || "",
  })};`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
