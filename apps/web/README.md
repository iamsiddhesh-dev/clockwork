# Clockwork web app

The Next.js 16 front end for Clockwork. Setup, architecture and deployment are in the [root README](../../README.md).

```bash
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev
```

Every page renders on the server and reads the agent API with the workspace id from the `cw_account` cookie. `src/lib/api.ts` is the only place that calls the API.
