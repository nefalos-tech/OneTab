import http from "node:http";

const upstreamPort = Number(process.env.B4_UPSTREAM_PORT);
const listenPort = Number(process.env.B4_PROXY_PORT);
const server = http.createServer((request, response) => {
  const path = request.url?.startsWith("/rest/v1") ? request.url.slice("/rest/v1".length) || "/" : request.url;
  const upstream = http.request({
    hostname: "127.0.0.1", port: upstreamPort, path, method: request.method,
    headers: { ...request.headers, host: `127.0.0.1:${upstreamPort}` },
  }, incoming => {
    response.writeHead(incoming.statusCode ?? 502, incoming.headers);
    incoming.pipe(response);
  });
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.pipe(upstream);
});
server.listen(listenPort, "127.0.0.1");
