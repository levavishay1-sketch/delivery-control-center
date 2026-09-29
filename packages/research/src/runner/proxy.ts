import http from "node:http";
import net from "node:net";

/**
 * A local egress proxy (protocol 3.2: every egress attempt is recorded, and
 * egress other than the model's endpoint is blocked).
 *
 * WHAT IT DOES: it records every request that reaches it, and refuses every
 * destination not on the allow list without resolving or contacting it.
 *
 * WHAT IT DOES NOT DO: it only sees programs that honour HTTP_PROXY /
 * HTTPS_PROXY. A program that opens a socket directly never reaches it, is
 * not blocked and is not recorded. Blocking those needs enforcement by the
 * operating system (a firewall rule or a network namespace), which this
 * harness does not configure: that is a system security change. So the
 * proxy is recording plus blocking for cooperating clients, never proof of
 * isolation.
 */

export type EgressEntry = { at: string; method: string; host: string; port: number; decision: "allowed" | "denied" };

export type EgressProxy = { url: string; entries: EgressEntry[]; close: () => Promise<void> };

export async function startEgressProxy(allow: (host: string, port: number) => boolean): Promise<EgressProxy> {
  const entries: EgressEntry[] = [];
  const record = (method: string, host: string, port: number, ok: boolean) => entries.push({ at: new Date().toISOString(), method, host, port, decision: ok ? "allowed" : "denied" });
  const sockets = new Set<net.Socket>();

  const server = http.createServer((req, res) => {
    let target: URL | null;
    try { target = new URL(req.url ?? ""); } catch { target = null; }
    const host = target?.hostname ?? "";
    const port = target ? Number(target.port || 80) : 0;
    const ok = host !== "" && allow(host, port);
    record(req.method ?? "?", host, port, ok);
    if (!ok || !target) { res.writeHead(403, { "content-type": "text/plain" }); res.end("denied by the pilot egress policy\n"); return; }
    const upstream = http.request({ host, port, method: req.method, path: target.pathname + target.search, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });

  server.on("connect", (req, socket: net.Socket, head) => {
    const [host = "", portText = "443"] = (req.url ?? "").split(":");
    const port = Number(portText);
    const ok = host !== "" && allow(host, port);
    record("CONNECT", host, port, ok);
    if (!ok) { socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
    const upstream = net.connect(port, host, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });

  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    entries,
    close: () => new Promise<void>((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }),
  };
}
