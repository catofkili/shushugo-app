import { createServer } from "node:http";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { openDatabase, createBindings } from "./adapters.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const defaults = {
  APP_BUNDLE_ID: "com.shushugo.app",
  APPLE_SIGN_IN_CLIENT_ID: "com.shushugo.app",
  WECHAT_OFFER_ID: "1450657377",
  WECHAT_PAY_ENV: "1",
  WECHAT_PAY_PRICES: JSON.stringify({ shushugo_pro_monthly: 1000, shushugo_pro_quarterly: 2400, shushugo_pro_yearly: 6800, shushugo_pro_lifetime: 29800 }),
  LAUNCH_GIFT_CLAIM_UNTIL: "",
  REQUIRE_AUTH_HARDENING: "1"
};

export const parseEnv = (text) => Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)$/);
  return match ? [[match[1], match[2]]] : [];
}));

export const createRuntime = async ({ dataDir = process.env.SHUSHUGO_DATA_DIR ?? "/var/lib/shushugo", envFile = process.env.SHUSHUGO_CREDENTIAL_FILE ?? "/etc/shushugo/worker.env", bundlePath = process.env.SHUSHUGO_WORKER_BUNDLE ?? path.join(here, "dist/index.js") } = {}) => {
  const fileEnv = await readFile(envFile, "utf8").then(parseEnv).catch((error) => error.code === "ENOENT" ? {} : Promise.reject(error));
  const env = { ...defaults, ...fileEnv };
  if (env.APP_STORE_PRIVATE_KEY) env.APP_STORE_PRIVATE_KEY = env.APP_STORE_PRIVATE_KEY.replaceAll("\\n", "\n");
  const db = openDatabase(path.join(dataDir, "worker.sqlite"), path.join(root, "migrations"));
  const bindings = createBindings(db, path.join(dataDir, "r2"));
  const worker = (await import(pathToFileURL(bundlePath).href)).default;
  return { db, env: { ...env, ...bindings }, worker };
};

export const setClientIpHeader = (request, remoteAddress) => {
  if (request.headers.has("cf-connecting-ip")) return;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((item) => item.trim()).filter(Boolean).at(-1);
  const remote = remoteAddress?.replace(/^::ffff:/, "") ?? "unknown";
  request.headers.set("cf-connecting-ip", forwarded || remote);
};

const hopByHop = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host"]);

export const dispatch = async (worker, request, env) => {
  const pending = [];
  const context = { waitUntil: (promise) => pending.push(Promise.resolve(promise)) };
  let response;
  let failure;
  try { response = await worker.fetch(request, env, context); }
  catch (error) { failure = error; }
  for (let index = 0; index < pending.length; index += 1) {
    const [result] = await Promise.allSettled([pending[index]]);
    if (result.status === "rejected") console.error("[selfhost] waitUntil task failed:", result.reason?.message ?? result.reason);
  }
  if (failure) throw failure;
  return response;
};

const serve = async () => {
  const runtime = await createRuntime();
  const server = createServer({ maxHeaderSize: 32 * 1024 }, async (incoming, outgoing) => {
    const controller = new AbortController();
    incoming.on("aborted", () => controller.abort());
    outgoing.on("close", () => { if (!outgoing.writableFinished) controller.abort(); });
    try {
      const headers = new Headers();
      for (const [name, raw] of Object.entries(incoming.headers)) {
        if (hopByHop.has(name.toLowerCase()) || raw === undefined) continue;
        headers.set(name, Array.isArray(raw) ? raw.join(", ") : raw);
      }
      const host = incoming.headers.host ?? "127.0.0.1:8787";
      const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0].trim();
      const protocol = forwardedProto === "https" ? "https" : "http";
      const requestUrl = new URL(incoming.url ?? "/", `${protocol}://${host}`);
      const requestInit = {
        method: incoming.method,
        headers,
        signal: controller.signal
      };
      if (incoming.method !== "GET" && incoming.method !== "HEAD") {
        requestInit.body = Readable.toWeb(incoming);
        requestInit.duplex = "half";
      }
      const request = new Request(requestUrl, requestInit);
      setClientIpHeader(request, incoming.socket.remoteAddress);
      const response = await dispatch(runtime.worker, request, runtime.env);
      const responseHeaders = {};
      for (const [name, value] of response.headers) responseHeaders[name] = value;
      outgoing.writeHead(response.status, responseHeaders);
      if (response.body && incoming.method !== "HEAD") {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!outgoing.write(value)) await new Promise((resolve) => outgoing.once("drain", resolve));
        }
      }
      outgoing.end();
      if (!incoming.readableEnded) incoming.resume();
    } catch (error) {
      console.error("[selfhost] request bridge failed:", error?.message ?? error);
      if (!outgoing.headersSent) outgoing.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      outgoing.end(JSON.stringify({ detail: "Invalid request" }));
      if (!incoming.readableEnded) incoming.resume();
    }
  });

  const stop = () => server.close(() => {
    runtime.db.close();
    process.exit(0);
  });
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  server.listen(8787, "127.0.0.1", () => console.log("ShuShuGo Worker listening on 127.0.0.1:8787"));
};

const runScheduled = async () => {
  const runtime = await createRuntime();
  try {
    const pending = [];
    await runtime.worker.scheduled({ cron: "17 3 * * *", scheduledTime: Date.now() }, runtime.env, { waitUntil: (promise) => pending.push(Promise.resolve(promise)) });
    for (const promise of pending) await promise;
    console.log("ShuShuGo scheduled Worker completed (03:17 UTC)");
  } finally {
    runtime.db.close();
  }
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes("--scheduled")) await runScheduled();
  else await serve();
}
