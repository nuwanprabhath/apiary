#!/bin/sh
# The container has no systemd. The app's start command is `systemd-run --user --collect apiary
# --background`, and Install and restart starts the new version with `systemd-run --user --collect
# --quiet --setenv=K=V … /bin/sh -c …`; this stands in for `systemd-run` in the test bed's image
# only: it exports each `--setenv`, drops the other options and runs the rest detached, as the
# user's systemd session would.
while [ "$#" -gt 0 ]; do
  case "$1" in
    --user|--collect|--quiet) shift ;;
    --setenv=*) export "${1#--setenv=}"; shift ;;
    *) break ;;
  esac
done
nohup "$@" > /home/dev/app.out 2>&1 < /dev/null &
