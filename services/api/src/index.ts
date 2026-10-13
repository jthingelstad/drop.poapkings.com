import { dispatch } from "./app.js";
import { httpServer, listenAddress } from "./server.js";

const server = httpServer({
  dispatch,
  trustCloudFront: process.env.TRUST_CLOUDFRONT === "true",
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean),
});
const { host, port } = listenAddress();
server.listen(port, host, () =>
  console.info({ event: "http.ready", build: process.env.API_VERSION }),
);
process.on("SIGTERM", () => {
  server.close();
  server.closeIdleConnections();
});
