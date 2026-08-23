import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

function escaped(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface PublishedSharePageInput {
  title: string;
  description: string;
  canonical: string;
  image: string;
  imageAlt: string;
  challenge: string;
  cta: string;
  pitch: string;
  profile: string;
  playerName: string;
  scriptSrc: string;
  bodyData: Record<string, string>;
}

export function renderPublishedSharePage(
  input: PublishedSharePageInput,
): string {
  const bodyData = Object.entries(input.bodyData)
    .map(([name, value]) => ` data-${name}="${escaped(value)}"`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escaped(input.title)}</title>
  <meta name="description" content="${escaped(input.description)}">
  <meta name="robots" content="noindex,nofollow">
  <link rel="canonical" href="${escaped(input.canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Elixir Drop">
  <meta property="og:title" content="${escaped(input.title)}">
  <meta property="og:description" content="${escaped(input.description)}">
  <meta property="og:url" content="${escaped(input.canonical)}">
  <meta property="og:image" content="${escaped(input.image)}">
  <meta property="og:image:alt" content="${escaped(input.imageAlt)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:type" content="image/png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escaped(input.title)}">
  <meta name="twitter:description" content="${escaped(input.description)}">
  <meta name="twitter:image" content="${escaped(input.image)}">
  <meta name="twitter:image:alt" content="${escaped(input.imageAlt)}">
  <style>
    @font-face{font-family:"Clash Royale";src:url("/assets/fonts/Clash_Regular.otf") format("opentype");font-weight:400;font-style:normal;font-display:swap}
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#120a30;color:#fff}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 80% 8%,#4a257c 0,transparent 32%),linear-gradient(180deg,#180d38,#0e0922);display:grid;place-items:center;padding:24px}
    main{width:min(100%,760px)}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;font-family:"Clash Royale",system-ui,sans-serif;letter-spacing:.03em}.free{font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-size:.78rem;color:#c6afe9;letter-spacing:0}
    .card{display:block;width:100%;border-radius:24px;border:1px solid #6a459d;box-shadow:0 24px 70px #090513;overflow:hidden;background:#1b1237}.card img{display:block;width:100%;height:auto}
    .pitch{margin:24px auto 16px;max-width:620px;text-align:center;color:#d6c7ec;line-height:1.55}.cta{display:block;width:100%;padding:18px 24px;border-radius:16px;background:#ffd55c;color:#201238;text-decoration:none;text-align:center;font-family:"Clash Royale",system-ui,sans-serif;font-size:1.15rem;box-shadow:0 7px 0 #a56d13}.player{display:flex;align-items:center;justify-content:space-between;margin-top:20px;padding:16px 18px;border:1px solid #4d356d;border-radius:16px;color:#fff;text-decoration:none;background:#1b1237}.player strong{font-family:"Clash Royale",system-ui,sans-serif}.player span:last-child{color:#d1b5ff}.fan{text-align:center;color:#907ba9;font-size:.75rem;margin:24px 0 0}
    @media(max-width:520px){body{padding:16px}header{font-size:.88rem}.free{font-size:.7rem}.card{border-radius:16px}.pitch{font-size:.94rem}}
  </style>
</head>
<body${bodyData}>
  <main>
    <header><span>ELIXIR DROP</span><span class="free">Free · no account needed</span></header>
    <a class="card" href="${escaped(input.challenge)}"><img src="${escaped(input.image)}" width="1200" height="630" alt="${escaped(input.imageAlt)}"></a>
    <p class="pitch">${escaped(input.pitch)}</p>
    <a class="cta" href="${escaped(input.challenge)}">${escaped(input.cta)}</a>
    <a class="player" href="${escaped(input.profile)}"><strong>${escaped(input.playerName)}</strong><span>View profile →</span></a>
    <p class="fan">Fan content, not affiliated with Supercell.</p>
  </main>
  <script src="${escaped(input.scriptSrc)}" defer></script>
</body>
</html>`;
}

export function publishedPageResponse(
  body: string,
  head = false,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "content-security-policy":
        "default-src 'none'; img-src 'self'; font-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "x-robots-tag": "noindex, nofollow",
    },
    body: head ? "" : body,
  };
}
