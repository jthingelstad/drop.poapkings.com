import { fileURLToPath } from "node:url";
import { createAdminServer } from "./server.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const host = process.env.DROP_ADMIN_HOST ?? "127.0.0.1";
const port = Number(process.env.DROP_ADMIN_PORT ?? 8780);
const allowedLogin =
  process.env.DROP_ADMIN_ALLOWED_LOGIN ?? "jthingelstad@github";
const devBypassIdentity = process.env.DROP_ADMIN_DEV_BYPASS_IDENTITY === "1";

if (host !== "127.0.0.1" && host !== "::1")
  throw new Error("Drop Control Room must bind to loopback");
if (devBypassIdentity && process.env.NODE_ENV === "production")
  throw new Error("Identity bypass is forbidden in production");

createAdminServer({
  repoRoot,
  staticRoot: fileURLToPath(
    new URL("../../../apps/admin/dist", import.meta.url),
  ),
  allowedLogin,
  devBypassIdentity,
}).listen(port, host, () => {
  process.stdout.write(
    `Drop Control Room listening on http://${host}:${port}\n`,
  );
});
