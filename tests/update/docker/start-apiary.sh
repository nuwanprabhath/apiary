#!/bin/sh
# Starts the installed Apiary as `dev` the way a desktop session would (under `systemd-run --user`,
# the test bed's shim), on a display that outlives it, so the version it relaunches into can draw.
# The test exports APIARY_FAKE_UPDATE, APIARY_FAKE_UPDATE_MODE and APIARY_FAKE_UPDATE_FILE first.
export DISPLAY=:99
pgrep -x Xvfb > /dev/null || { Xvfb :99 -screen 0 1400x900x24 > /dev/null 2>&1 & }
i=0
while [ ! -e /tmp/.X11-unix/X99 ] && [ "$i" -lt 50 ]; do i=$((i+1)); sleep 0.1; done
exec systemd-run --user --collect /opt/Apiary/apiary --no-sandbox --disable-gpu \
  --remote-debugging-port=9222 --user-data-dir=/home/dev/ud
