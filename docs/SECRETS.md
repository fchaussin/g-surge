# Secrets and where each one lives

Four secrets, three homes, and the rule that decides which: **a secret lives
where the thing that reads it runs.** Nothing here is ever committed;
`.env.example` carries the shape, `.env` the values, and `.env` is ignored.

| Secret | Read by | Lives in |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | `wrangler`, at deploy time | GitHub repository secrets, and `.env` for deploying by hand |
| `CLOUDFLARE_ACCOUNT_ID` | `wrangler`, when the token sees several accounts | same |
| `SESSION_SECRET` | the Worker, on every sign-in | Cloudflare, by `wrangler secret put` |
| `GOOGLE_CLIENT_SECRET` | the Worker, when it exchanges an authorization code | Cloudflare, by `wrangler secret put` |

**Why the Worker's secrets are not GitHub secrets.** They are read at request
time, not at deploy time, and `wrangler deploy` does not push them — they
survive every deployment. Putting them in GitHub would add a place that holds
them without anything reading it there.

**`GOOGLE_CLIENT_ID` is not a secret.** It travels in the authorization URL,
in plain sight of every player. It belongs in `server/wrangler.jsonc`, under
`vars`, in both environments — wrangler does not inherit `vars` into
`env.staging`, so it is written twice.

## Creating the Google OAuth client

Console: <https://console.cloud.google.com/auth/clients/create> — project
`g-surge`, application type **Web application**.

Authorised redirect URIs, one per environment, exactly as the Worker builds
them (`${url.origin}/auth/google/callback`):

```
https://gsurge-api.w23.fr/auth/google/callback
https://g-surge-api-staging.fchaussin.workers.dev/auth/google/callback
```

No authorised JavaScript origins: the flow is a server-side redirect, the
browser never calls Google directly.

The console shows the client secret **once**. Copy it before closing the
dialog; if it is lost, add a new secret on the same client and remove the old
one — the client id does not change, so nothing else needs updating.

**Rotate a secret that has been seen anywhere it should not be** — a chat, a
terminal recording, a screenshot. A client can hold several secrets at once,
so the rotation is: create the new one, put it on both environments, delete
the old one. No downtime.

## Setting them, from this repository

The Cloudflare ones, once per environment. `wrangler` prompts for the value
and it never reaches the shell history:

```
docker compose run --rm tools npx wrangler -c server/wrangler.jsonc secret put SESSION_SECRET
docker compose run --rm tools npx wrangler -c server/wrangler.jsonc secret put GOOGLE_CLIENT_SECRET
docker compose run --rm tools npx wrangler -c server/wrangler.jsonc secret put SESSION_SECRET --env staging
docker compose run --rm tools npx wrangler -c server/wrangler.jsonc secret put GOOGLE_CLIENT_SECRET --env staging
```

`SESSION_SECRET` signs the `state` of the sign-in flow and the cookie that
binds a return to the browser that started it. Anything long and random —
`openssl rand -base64 48`. **Under 32 characters the Worker refuses to offer
sign-in at all**, `/health` lists no providers and the menu shows no button:
a short secret is a forgeable `state`, and a forgeable `state` sends a
player's session wherever the forger asks.

The two environments may hold different values; nothing compares them.

## The GitHub secrets

`Settings → Secrets and variables → Actions`, repository secrets:

- `CLOUDFLARE_API_TOKEN` — the same token as `.env`, template *Edit
  Cloudflare Workers*, scoped to the account and the `w23.fr` zone, plus
  `D1:Edit`.
- `CLOUDFLARE_ACCOUNT_ID` — only if the token sees several accounts.

They exist for one job, `deploy-server` in `.github/workflows/ci.yml`, which
applies the pending D1 migrations and then deploys the Worker, after every
push to `main` that passed both checks. That order is the job's reason to
exist as one job: a Worker that lands before its migration reads a table that
does not exist yet. `D1:Edit` on the token is what the migration step needs.

Without the secrets the job skips itself, green, and the Worker stays on
whatever was deployed by hand — which is how a `src/sim/` change once left
the Worker on an old core digest while the client moved on, and every ranked
run got a 409 after a full run.

The staging environment has no job: it is deployed by hand from this
repository, `npm run server:migrate:staging` then `npm run server:deploy:staging`,
with the token in `.env`.
