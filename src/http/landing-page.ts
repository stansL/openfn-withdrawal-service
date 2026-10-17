export const landingPagePolicy = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

export function landingPageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Explore the OpenFn withdrawal-authorisation API and service checks." />
  <title>OpenFn · Withdrawal service</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #183a35; background: #f5f6f1; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main { max-width: 960px; margin: auto; padding: 64px 28px 40px; }
    .brand { font-size: 18px; font-weight: 750; letter-spacing: -.5px; }
    .brand span { font-weight: 400; color: #53685f; margin-left: 12px; letter-spacing: 0; font-size: 14px; }
    .eyebrow { margin: 64px 0 16px; color: #53685f; font-size: 12px; letter-spacing: 2px; text-transform: uppercase; }
    h1 { max-width: 700px; margin: 0; font-size: clamp(36px, 6vw, 62px); line-height: 1.08; letter-spacing: -2px; font-weight: 650; }
    .intro { max-width: 590px; color: #53685f; font-size: 18px; line-height: 1.7; margin: 24px 0 36px; }
    nav { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    a { color: inherit; text-decoration: none; border: 1px solid #cbd6cb; border-radius: 14px; padding: 24px; background: #fff; transition: border-color .15s; }
    a:hover { border-color: #28715e; }
    a:focus-visible { outline: 3px solid #28715e; outline-offset: 4px; }
    .primary { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 24px; background: #183a35; color: #fff; border-color: #183a35; }
    .primary:hover { background: #235047; }
    h2 { font-size: 18px; margin: 0 0 10px; font-weight: 650; }
    a p { color: #53685f; font-size: 14px; line-height: 1.6; margin: 0 0 20px; }
    .primary p { color: #d2e4dc; margin-bottom: 0; }
    code { font-size: 12px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    .arrow { font-size: 24px; }
    aside { margin-top: 32px; padding: 20px 0; border-top: 1px solid #cbd6cb; color: #53685f; font-size: 13px; line-height: 1.7; }
    aside strong { color: #183a35; }
    @media (max-width: 600px) { main { padding: 32px 20px; } .eyebrow { margin-top: 44px; } nav { grid-template-columns: 1fr; } h1 { letter-spacing: -1px; } }
  </style>
</head>
<body>
  <main>
    <header class="brand">OpenFn<span>Withdrawal service</span></header>
    <p class="eyebrow">Developer resources</p>
    <h1>Explore the authorisation API.</h1>
    <p class="intro">Authorise USD withdrawals with account access controls, time-bound reservations, and currency conversion.</p>
    <nav aria-label="Service resources">
      <a class="primary" href="/docs">
        <div><h2>API documentation</h2><p>Explore endpoints, request formats, and responses in the interactive API reference.</p></div>
        <span class="arrow" aria-hidden="true">↗</span>
      </a>
      <a href="/openapi.json"><h2>OpenAPI specification</h2><p>The machine-readable contract for clients and API tools.</p><code>/openapi.json</code></a>
      <a href="/healthz"><h2>Liveness</h2><p>Check whether the service process is running.</p><code>/healthz</code></a>
      <a href="/readyz"><h2>Readiness</h2><p>Check lifecycle and database readiness to accept traffic.</p><code>/readyz</code></a>
    </nav>
    <aside><strong>Authorisation reserves funds.</strong> The posted balance stays unchanged. Holds expire after their configured lifetime; settlement is outside this service’s scope. Resource links show their current response when opened.</aside>
  </main>
</body>
</html>`;
}
