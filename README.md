# AdsManager

Rewarded advertising with a Hono API, D1 storage, R2 media uploads and an administration panel.

## Development

```sh
npm install
npm run db:migrate:local
npm run dev
npm run typecheck
```

The administration API requires Cloudflare Access. Supply your own database and storage bindings in a local Wrangler configuration.

The reward endpoint issues single-use tokens. Verify a token on the server before granting a reward; a browser `postMessage` alone is insufficient.
