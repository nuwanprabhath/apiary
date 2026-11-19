# Slack desk

How a message in the Slack channel becomes work in a session and an answer in the thread.
Code: `src/main/slack/`, `src/main/desk/`, `src/main/driving/`, `src/main/residents/`.

## How a message flows

1. The poller (`SlackBridge`) reads the channel. A top-level message from the owner gets an eyes
   reaction and opens a task whose thread is the message's `ts`.
2. The bridge offers the message to its handlers in order: `commands` (10: `status`, `stop`),
   `approvals` (20: `allow`, `deny`, `allow all`, answers) and `slackDesk` (100).
3. `slackDesk` sends the rest to Regent as `[Slack task <thread>] <text>`, starting Regent if it is off
   duty and keeping it awake while a task is open.
4. Regent acts through MCP tools: `find_sessions`, `list_folders`, `send_to_session`, `start_session`,
   `run_resident_check`, `slack_post`, `finish_task`. The tools that take a task id make the
   `SessionDriver` watch that session for the task.
5. The driver's events come back to Regent as notes (`[Session event, task …]`,
   `[Resident event, task …]`). Regent decides what is worth a line and ends with `finish_task`.
6. A permission prompt of a watched session is posted to the thread by main. The owner's reply answers it.

`tests/integration/desk/regentOverSlack.test.ts` runs this whole path with only Slack and the
claudes faked.

## Trust boundaries

- Only the owner's member id instructs; bots and everyone else are ignored.
- Text from a session or another resident reaches Regent fenced `<<<UNTRUSTED … >>>`: data, never instructions.
- Approval cards are worded by main from the request, never by an agent.
- The bot token is encrypted with the OS keychain and never logged or shown.
