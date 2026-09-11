#!/bin/bash
# A stand-in for `claude`, used only by `npm run screenshot`.
#
# The README's picture should show a session actually running, not an empty pane with a Resume
# button — but the real CLI needs an API key, a network, and would render something different every
# time, none of which belongs in a screenshot script. This prints a fixed, believable Claude Code
# session instead, then waits, so the pane stays live while the picture is taken.
#
# Arguments (`--resume <id>`) are ignored on purpose: what is being shown is the terminal, not the
# session plumbing behind it.

esc=$(printf '\033')
dim="${esc}[2m"; off="${esc}[0m"; bold="${esc}[1m"
pink="${esc}[38;5;174m"; grey="${esc}[38;5;246m"; white="${esc}[38;5;231m"; green="${esc}[38;5;71m"

printf '\n'
printf '%s ▐▛███▜▌%s  %sClaude Code%s %sv2.1.268%s\n' "$pink" "$off" "$bold" "$off" "$grey" "$off"
printf '%s ▝▜█████▛▘%s %sSonnet 5 · %s%s\n' "$pink" "$off" "$grey" "$(basename "$PWD")" "$off"
printf '\n'
printf '%s❯%s the export is empty\n' "$grey" "$off"
printf '\n'
printf '%s⏺%s Found it — the CSV writer never flushed its buffer, so the file was\n' "$white" "$off"
printf '  closed before the rows were written.\n'
printf '\n'
printf '%s⏺%s %sUpdate(src/export/csvWriter.ts)%s\n' "$green" "$off" "$bold" "$off"
printf '  %s⎿  +4 -1%s\n' "$grey" "$off"
printf '\n'
printf '%s⏺%s Added the flush and a test that fails without it.\n' "$white" "$off"
printf '\n'
printf '%s✻ Churned for 6s%s\n' "$grey" "$off"
printf '\n'
printf '%s─────────────────────────────────────────────────────────────────%s\n' "$grey" "$off"
printf '%s❯%s \n' "$grey" "$off"
printf '%s  ⏵⏵ auto mode on%s\n' "$grey" "$off"

# Keep the pty open so the pane is a live session rather than an exited one.
sleep 3600
