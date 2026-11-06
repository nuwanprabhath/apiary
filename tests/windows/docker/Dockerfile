# Window placement on the maintainer's desktop, Ubuntu 26.04 (tests/windows): GNOME's compositor,
# mutter, run headless as a Wayland session with two virtual monitors and XWayland; wmctrl and
# xdotool to move and measure windows; Node 22 and the built app. Built by tests/windows/windows.test.ts.
FROM ubuntu:26.04
LABEL apiary.test-bed=windows
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates curl xz-utils \
    mutter xwayland dbus dbus-user-session gsettings-desktop-schemas x11-xserver-utils x11-utils wmctrl xdotool \
    libgtk-3-0t64 libnss3 libasound2t64 libxss1 libgbm1 libxtst6 libatk-bridge2.0-0t64 libdrm2 \
    libxkbcommon0 libcups2t64 libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 libcairo2 \
    build-essential python3 make g++ pkg-config \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

RUN (userdel -r ubuntu || true) && useradd -m -s /bin/bash -u 1000 dev

WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/fix-node-pty-permissions.mjs scripts/
RUN npm ci && node node_modules/electron/install.js
COPY . .
RUN npm run build && chown -R dev:dev /app
RUN install -m 755 /app/tests/windows/docker/desktop.sh /usr/local/bin/desktop
CMD ["sleep", "infinity"]
