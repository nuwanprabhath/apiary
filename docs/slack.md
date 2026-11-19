# Talking to Regent from Slack

Apiary can read your messages in a Slack channel and answer there. Apiary's main process polls Slack's
Web API (no Socket Mode, no public address), so every machine can use the same Slack app and its own channel.

## Set it up

1. Go to <https://api.slack.com/apps>, choose **Create New App**, **From a manifest**, pick your workspace and paste
   `resources/slack/regent-manifest.yaml` (the app is called "Regent", its bot `regent`).
2. **Install to Workspace**, then copy the **Bot User OAuth Token** (it starts with `xoxb-`) from **OAuth & Permissions**.
3. Create one channel per machine (for example `#mac` and `#work`) and invite the bot in each: `/invite @regent`.
4. Find your own member id: your Slack profile, the three dots, **Copy member ID** (it looks like `U01ABCDE2F3`).
   Only messages from this id are instructions; everyone else and every bot is ignored.
5. In Apiary: **Settings, Slack**. Paste the token, name this machine's channel (a name or an id), enter your member id,
   switch it on and press Test.

Use the same token on every machine and a different channel on each. The token is kept in the operating system's keychain
(`safeStorage`); a machine with no keychain refuses to save it. It is never shown again, written to `settings.json` or logged.

## What Apiary does

- It checks the channel every 3 s while a task is open or you wrote in the last 5 minutes, otherwise every 10 s, and at
  once when the computer wakes.
- A top-level message starts a task and gets an :eyes: reaction. Replies in its thread belong to the same task.
- A message that waited more than 15 minutes (Apiary was closed) is not carried out until you reply `yes`; `no` drops it.
- With nothing on the machine set up to act on messages, it says so in the thread.

Code: `src/main/slack/` ([CLAUDE.md](../src/main/slack/CLAUDE.md)).
