#!/bin/bash
# A stand-in for `claude`, used only by `npm run screenshot`.
#
# The README's picture should show a session actually running, not an empty pane with a Resume
# button — but the real CLI needs an API key, a network, and would render something different every
# time, none of which belongs in a screenshot script. This prints a fixed, believable Claude Code
# session instead, then waits, so the pane stays live while the picture is taken.
#
# **It draws to the size of the pane, and anchors the prompt box to the bottom of it.** Both
# because of how the picture looked when it did neither: the transcript columns either side fill
# their panes, and a middle column whose content stopped halfway down with its input box floating
# in the dead space read as a session that had failed to load. A real Claude Code session keeps its
# composer on the last row and its rules the width of the terminal, so this does too.
#
# The size is read at draw time and redrawn on SIGWINCH rather than measured once at startup: the
# pty is spawned at a default 80x24 and only resized once the renderer has measured the pane, so
# anything laid out before that is laid out for a terminal that no longer exists. A sleep long
# enough to cover that would be a race; reacting to the resize is not.
#
# Message lines are still kept under ~52 columns, so they read as a narrow column the way they do
# in the app rather than running the full width of a wide window.
#
# Started in chat mode (`--input-format stream-json`) it is not a terminal at all: it hands over to
# fake-claude-chat.mjs, so the one `claudeBin` setting serves both kinds of pane. Otherwise its
# arguments (`--resume <id>`) are ignored on purpose: what is being shown is the terminal, not the
# session plumbing behind it.

case " $* " in
  *" --input-format "*) exec node "$(dirname "$0")/fake-claude-chat.mjs" "$@" ;;
esac

esc=$(printf '\033')
off="${esc}[0m"; bold="${esc}[1m"
pink="${esc}[38;5;174m"; grey="${esc}[38;5;246m"; white="${esc}[38;5;231m"; green="${esc}[38;5;71m"

draw() {
  local rows cols
  read -r rows cols < <(stty size 2>/dev/null || echo '24 80')
  [[ -z "$rows" || "$rows" -lt 8 ]] && rows=24
  [[ -z "$cols" || "$cols" -lt 20 ]] && cols=80

  # The rule the prompt box is drawn with, one space in from each edge like the real one.
  local rule
  printf -v rule '%*s' "$((cols - 2))" ''
  rule="${rule// /─}"

  local body=(
    "${pink}✻${off} ${bold}Claude Code${off} ${grey}v2.1.286${off}"
    "  ${grey}Sonnet 5.5 · $(basename "$PWD")${off}"
    ''
    "${grey}❯${off} the nightly sync times out on big"
    '  accounts. why?'
    ''
    "${white}⏺${off} It loads every account into memory"
    '  before batching, so one large tenant'
    '  exhausts the heap. Streaming instead.'
    ''
    "${green}⏺${off} ${bold}Update(src/jobs/nightlySync.ts)${off}"
    "  ${grey}⎿  Updated with 11 additions, 6 removals${off}"
    ''
    "${green}⏺${off} ${bold}Bash(npm test -- nightlySync)${off}"
    "  ${grey}⎿  Tests: 9 passed, 9 total${off}"
    ''
    "${white}⏺${off} Fixed. The job now reads accounts in"
    '  pages of 500; peak memory stays flat.'
    ''
    "${grey}✻ Worked for 38s${off}"
  )
  local footer=(
    "${grey} ${rule}${off}"
    "${grey} ❯${off}"
    "${grey} ${rule}${off}"
    "${grey}  ⏵⏵ auto mode on${off}"
  )

  # Whatever is left over goes between the conversation and the composer, which is where a real
  # session's empty space is. At least one line, so a very short pane still separates the two.
  local filler=$(( rows - ${#body[@]} - ${#footer[@]} ))
  (( filler < 1 )) && filler=1

  local lines=( "${body[@]}" )
  local i
  for (( i = 0; i < filler; i++ )); do lines+=( '' ); done
  lines+=( "${footer[@]}" )

  # Home and clear, then every line but the last with a newline after it: a newline on the last
  # line would scroll the first one off the top, which is the one naming the program.
  printf '%s[2J%s[H' "$esc" "$esc"
  for (( i = 0; i < ${#lines[@]} - 1; i++ )); do printf '%s\n' "${lines[i]}"; done
  printf '%s' "${lines[${#lines[@]} - 1]}"
}

trap draw WINCH
draw

# Keep the pty open so the pane is a live session rather than an exited one.
while true; do sleep 1; done
