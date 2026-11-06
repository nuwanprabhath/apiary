#!/bin/sh
# Starts the bed's desktop, as `dev`: GNOME's compositor (mutter, as on Ubuntu 26.04) headless, with
# two 1920x1080 virtual monitors side by side and XWayland on :0. Idempotent; prints the monitors.
export XDG_RUNTIME_DIR=/tmp/xdg-dev DISPLAY=:0
if [ ! -S "$XDG_RUNTIME_DIR/wayland-0" ]; then
  mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
  nohup dbus-run-session -- mutter --headless --wayland --wayland-display=wayland-0 \
    --virtual-monitor 1920x1080 --virtual-monitor 1920x1080 >/tmp/mutter.log 2>&1 &
  for _ in $(seq 100); do [ -S "$XDG_RUNTIME_DIR/wayland-0" ] && xdpyinfo >/dev/null 2>&1 && break; sleep 0.1; done
fi
# XWayland's cookie: X11 clients (the app through XWayland, wmctrl, xdotool) need it.
XAUTHORITY=$(find "$XDG_RUNTIME_DIR" -maxdepth 1 -name ".mutter-Xwaylandauth.*" | head -n 1)
export XAUTHORITY
ln -sf "$XAUTHORITY" "$XDG_RUNTIME_DIR/xauth"
xrandr --listmonitors
