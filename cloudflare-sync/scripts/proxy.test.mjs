import assert from "node:assert/strict";
import proxy from "../proxy/index.js";

const env = { UPSTREAM: "https://origin.shushugo.com", PROXY_KEY: "k" };
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init, body: init.body ? await new Response(init.body).text() : null });
  return new Response("ok");
};

const post = new Request("https://master-nihongo-sync.example.workers.dev/api/sync/push?x=1", {
  method: "POST",
  headers: { "cf-connecting-ip": "1.2.3.4", authorization: "Bearer t", "x-shushugo-proxy-key": "spoofed" },
  body: "payload"
});
assert.equal(await (await proxy.fetch(post, env)).text(), "ok");
assert.equal(calls[0].url, "https://origin.shushugo.com/api/sync/push?x=1");
assert.equal(calls[0].init.method, "POST");
assert.equal(calls[0].body, "payload");
assert.equal(calls[0].init.headers.get("x-shushugo-client-ip"), "1.2.3.4");
assert.equal(calls[0].init.headers.get("x-shushugo-proxy-key"), "k");
assert.equal(calls[0].init.headers.get("x-shushugo-host"), "master-nihongo-sync.example.workers.dev");
assert.equal(calls[0].init.headers.get("authorization"), "Bearer t");

const frozen = await proxy.fetch(new Request("https://x.workers.dev/api/health"), { ...env, MAINTENANCE: "1" });
assert.equal(frozen.status, 503);
assert.equal(calls.length, 1);
console.log("proxy ok");
