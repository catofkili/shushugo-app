// 搬到阿里云（2026-10-10）之后还留在 Cloudflare 的那一层。后端本体见 ../selfhost/README.md。
//
// 为什么还要留：已发布的 iOS 版本把 *.workers.dev 写死在包里，删掉这个 Worker 它们就断网。
// 等这些旧版本没人用了再整个删掉。
//
// - 平时：原样转发到 UPSTREAM（origin.shushugo.com，直连阿里云、不经 Cloudflare 代理的那个名字）。
//   客户端真实 IP 放在 X-Shushugo-Client-Ip，凭 PROXY_KEY 让服务器那边的 Caddy 信它。
//   ⚠️ 不带的话所有旧客户端在服务器看来都是 Cloudflare 的几个出口 IP，
//   同步推送「每 IP 每分钟 2 次」的限速会让他们互相挤掉。
// - MAINTENANCE=1：一律 503。切换窗口里用它冻结旧库写入（部署时 --var MAINTENANCE:1）。
const json = (status, body, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", ...extra }
});

export default {
  async fetch(request, env) {
    if (env.MAINTENANCE) return json(503, { detail: "服务器正在搬家，几分钟后自动恢复；本机学习不受影响。" }, { "retry-after": "300" });
    const url = new URL(request.url);
    const forwarded = new Headers(request.headers);
    forwarded.set("x-shushugo-client-ip", request.headers.get("cf-connecting-ip") ?? "");
    forwarded.set("x-shushugo-proxy-key", env.PROXY_KEY ?? "");
    return fetch(new URL(url.pathname + url.search, env.UPSTREAM), {
      method: request.method,
      headers: forwarded,
      body: request.body,
      redirect: "manual"
    });
  }
};
