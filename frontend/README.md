# DataGuard AI — frontend

Next.js (App Router, TypeScript) + Tailwind CSS v4 + Recharts.

```bash
npm install
cp .env.example .env.local          # NEXT_PUBLIC_API_URL=http://localhost:4000
npm run dev                         # http://localhost:3000 (needs backend running)
```

## Demo mode (no backend / DB / ML service)

```bash
NEXT_PUBLIC_DEMO_MODE=true npm run build && npm start
```

Data comes from `src/demo/fixtures.json`, which `scripts/export-demo-fixtures.mjs` exports from a
running full stack (real model outputs on synthetic data). Mutations are kept in the browser
(localStorage); the banner's "Reset" button restores the fixtures.

**Vercel:** import the repo, set *Root Directory* = `frontend`, add the env var
`NEXT_PUBLIC_DEMO_MODE=true`. No other configuration is needed.

Regenerate fixtures (with postgres, ml-service and backend running):

```bash
node scripts/export-demo-fixtures.mjs --with-activity   # on a freshly seeded DB
```
