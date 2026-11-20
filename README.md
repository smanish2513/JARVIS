# JARVIS

A personal assistant workspace built with Next.js and [eve](https://eve.dev). The current dashboard is a private-use preview; connect the services below before relying on it with personal data.

## Run locally

```bash
npm run dev
```

Open `http://localhost:3000`. Use **Talk to JARVIS** for general questions and agent conversations. The agent uses Vercel AI Gateway; for local model access, link a Vercel project with `npx eve link` or configure an AI Gateway key in `.env.local`.

## Current capabilities

- JARVIS chat with a calm, concise personal-assistant voice.
- A priority inbox preview populated with clearly marked fictional examples.
- A manual expense tracker in INR. It syncs across devices when the private Postgres connection is configured; until then, entries stay in this browser.
- Gmail read-only tools in `agent/tools/search_gmail.ts`. Search returns sender, subject, date, and preview; reading a message decodes its body and limits it to 6,000 characters. Both request only the `gmail.readonly` OAuth scope.
- Hourly email monitoring is off by default. It starts only after Gmail read-only consent, WhatsApp template setup, and your explicit dashboard opt-in; message IDs are deduplicated in Postgres.
- WhatsApp Business Cloud delivers one-way approved-template alerts to your configured number. JARVIS does not expose a public WhatsApp webhook or use WhatsApp as a chat surface.

## Service setup

1. The `jarvis` Vercel project is configured with Vercel Authentication for **all deployments**. Sign in to your Vercel account on each device to access the hosted app. The team currently has one owner; every team member with project access can reach the app and shares the same personal Gmail identity, so keep access limited to people you trust with that data. Revisit the identity model before adding another team member.
2. In Google Cloud, enable the Gmail API, configure the OAuth consent screen, add your Google account as a test user if the app is in Testing, and create a **Web application** OAuth client. Add `https://connect.vercel.com/callback` as an authorized redirect URI. Save a local `.secrets/google-oauth.json` file with top-level `clientId` and `clientSecret` fields; `.secrets/` is git-ignored. Then run `npm exec -- vercel connect create google --name jarvis-gmail --data @.secrets/google-oauth.json` and `npm exec -- vercel connect attach google/jarvis-gmail`. If the CLI reports that the project is not linked or you are signed out, link it and sign in to Vercel first. Open **Talk to JARVIS**, ask it to check Gmail, and grant only the requested `gmail.readonly` scope in Google's consent flow. Google classifies this scope as restricted, so testing may show an unverified-app warning and public production use may require Google's verification.
3. Connect the free Neon Postgres integration through Vercel Marketplace after accepting its terms. Set `DATABASE_URL` for local development; Vercel injects the deployed connection. Expenses are scoped to the single protected workspace owner, and email-alert IDs/preferences have tables ready for the monitoring workflow.
4. For WhatsApp alerts, create a Meta Business app and add WhatsApp Business Cloud. In WhatsApp Manager, create and get approval for a message template with one body placeholder (`{{1}}`). Add `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_RECIPIENT_ID`, `WHATSAPP_ALERT_TEMPLATE_NAME`, and `WHATSAPP_ALERT_TEMPLATE_LANGUAGE` to the Vercel production environment. The language code must exactly match the approved template (for example, `en_US`). JARVIS sends one-way template alerts; it does not place regular phone calls or connect to a personal WhatsApp session.

The hourly monitor stays off until Gmail consent, the database, Meta's approved template, a recipient, and your explicit opt-in are all configured. Those account connections still need setup.

## Data and privacy

- Gmail access is read-only and limited to the tools in `agent/tools/search_gmail.ts`.
- Email content is untrusted input; JARVIS must ignore instructions embedded in messages.
- Expense examples are fictional. Personal expenses stay in the current browser until Postgres is connected, then sync through the private API; they are not bank data.
- No WhatsApp alerts are sent without a configured Meta Business Cloud account, approved template, recipient, and enabled monitor setting.
- Vercel Authentication protects deployments through Vercel team access. The agent maps the current single authorized owner to one stable identity for OAuth grants. Revisit that mapping before adding more users.

## Project structure

- `agent/instructions.md` — JARVIS identity, tone, and permissions.
- `agent/tools/search_gmail.ts` — Gmail search and body decoding through Vercel Connect.
- `agent/channels/` — protected web chat.
- `agent/schedules/mail_monitor.ts` — hourly inbox review when enabled and fully configured.
- `app/` — dashboard, inbox preview, expense tracker, and chat.
- `.env.example` — names of local integration variables; actual secrets belong in `.env.local` or Vercel environment settings.
