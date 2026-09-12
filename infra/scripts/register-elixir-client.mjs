#!/usr/bin/env node
// Register Elixir Drop as a public OAuth client with Elixir (dynamic client
// registration, no authentication: elixir.poapkings.com/docs/protocol).
// Prints the client_id; set it as the ElixirOAuthClientId stack parameter
// (ELIXIR_OAUTH_CLIENT_ID in the fixed host's .env, then `npm run
// deploy:api`). A registration lives 365 days from its last use.
//
//   node infra/scripts/register-elixir-client.mjs https://drop.poapkings.com

const elixir = (
  process.env.ELIXIR_MCP_BASE_URL ?? "https://elixir.poapkings.com"
).replace(/\/$/, "");
const origins = process.argv.slice(2);
if (origins.length === 0) {
  console.error("usage: register-elixir-client.mjs <origin> [<origin> ...]");
  process.exit(2);
}
const response = await fetch(`${elixir}/oauth/register`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({
    client_name: "Elixir Drop",
    redirect_uris: origins.map(
      (o) => `${o.replace(/\/$/, "")}/api/auth/elixir/callback`,
    ),
  }),
});
const body = await response.json();
if (response.status !== 201) {
  console.error(
    `registration failed: ${response.status} ${JSON.stringify(body)}`,
  );
  process.exit(1);
}
console.log(JSON.stringify(body, null, 2));
