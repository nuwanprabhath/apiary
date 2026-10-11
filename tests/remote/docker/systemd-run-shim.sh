#!/bin/sh
# The container has no systemd. The app's start command is `systemd-run --user --collect apiary
# --background`; this stands in for `systemd-run` in the test bed's image only: it drops the options
# it was given and runs the rest detached, as the user's systemd session would.
while [ "$#" -gt 0 ]; do
  case "$1" in
    --user|--collect) shift ;;
    *) break ;;
  esac
done
nohup "$@" > /home/dev/app.out 2>&1 < /dev/null &
