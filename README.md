# SGC Feedback Bot

A bot for [SGC](https://social.giorgiovola.casa) that collects user feedback and files it as
tasks in [Orbit](https://github.com/coollabsio/orbit).

## How it works

1. A user sends the bot a direct message on SGC (text and/or images).
2. The bot replies asking for confirmation: *"Vuoi inviare questo feedback? Rispondi si/no"*.
3. If the user answers **si** (or **yes**), the bot creates a task in the configured Orbit
   project column, with the sender, date, text and images, and thanks the user.
   If they answer **no**, the feedback is discarded. Any other answer repeats the question.

Answers are case, accent and punctuation insensitive ("Sì!", "YES" work). Pending feedback and
the last handled message are saved in `state.json`, so the bot survives restarts and catches up
on messages it missed. On the very first run, older DMs are skipped.

## Setup

Requires [Bun](https://bun.sh).

```bash
bun install
cp .env.example .env   # then fill it in
bun run start          # or: bun run dev (watch mode)
```

| Variable | Description |
| --- | --- |
| `SGC_URL` | SGC instance URL (default `https://social.giorgiovola.casa`) |
| `SGC_TOKEN` | SGC bot token (`sgc_…`) |
| `ORBIT_URL` | Orbit instance URL |
| `ORBIT_TOKEN` | Orbit API token (`orb_…`) with `tasks:write` on the target project. A service-account token is recommended. |
| `ORBIT_PROJECT_KEY` | Project key where feedback goes, e.g. `SGC` (default: first visible project) |
| `ORBIT_STATUS_NAME` | Column (status) for new tasks (default `Feedback`) |
| `STATE_FILE` | Where state is stored (default `state.json`) |
