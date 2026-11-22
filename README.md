# Eclipso Outreach Agent

An AI research-and-drafting agent I built for my agency, Eclipso Digital, to find small US businesses that need a better website or booking flow, check them properly, and draft a short, honest introduction email for a human to approve.

## The problem

Cold outreach to local businesses usually fails in two ways: the list is bad (wrong business, dead email, someone already contacted), or the message is generic. Doing the research by hand takes 10-15 minutes per business.

## What it does

1. **Discovery.** Pulls local businesses from public data sources: OpenStreetMap, the City of Chicago business-license data, the CMS NPI registry (clinics), and web search.
2. **Site research.** Reads each business's public website (HTTPS only, robots.txt respected, bounded time and size) and records evidence such as "website is under construction" or "booking is phone-only".
3. **Qualification.** Checks the business identity matches, it is in the US, it has a published contact, and there is a real opportunity. Anything uncertain is held, not guessed.
4. **History check.** Before anything is drafted, checks previous outreach history (Supabase) so nobody gets contacted twice or after opting out.
5. **AI draft.** Writes a short email with Cloudflare Workers AI, citing only the evidence it found. Every draft is saved as *needs review*.
6. **Human approval.** Nothing sends automatically. A draft only goes out after it is approved, and the approval is tied to that exact draft and evidence, so an edited or stale draft cannot be sent.

Guard rails throughout: daily AI-call budget reserved before inference, idempotent run IDs so retries never create duplicate drafts or sends, explicit "held" states instead of silent failures, and bounce/delivery recovery.

## Stack

JavaScript (Node 22+ / Cloudflare Workers), Cloudflare D1 + Workers AI + cron triggers, Supabase (Postgres + edge function), Gmail API.

## Run the tests

```
node --experimental-sqlite --test test/*.test.mjs
```

118 tests run against an in-memory SQLite stand-in for D1 with a stubbed AI binding. All data in tests is synthetic.

## Notes

- Credentials, live database IDs and real lead data are not in this repository. `wrangler.example.toml` is a template.
- Parts of the discovery and site-profiling code are JavaScript ports of [Harvey](https://github.com/ethanplusai/harvey) (MIT). See `THIRD_PARTY_NOTICES.md`.
- This public copy is a showcase of the production project; deployment scripts and private tooling are left out.

Built by Alyan Aamir, Eclipso Digital.
