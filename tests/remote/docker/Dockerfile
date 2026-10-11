# The work machine in the remote-access test bed: sshd, git, Node 22 and the built app (Linux native
# modules), run headless under xvfb. Built by tests/remote/harness.ts.
FROM ubuntu:24.04
LABEL apiary.test-bed=remote
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server git ca-certificates curl xz-utils sudo \
    xvfb xauth dbus-x11 \
    libgtk-3-0 libnss3 libasound2t64 libxss1 libgbm1 libxtst6 libatk-bridge2.0-0 libdrm2 \
    libxkbcommon0 libcups2 libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 libcairo2 \
    build-essential python3 make g++ pkg-config \
 && rm -rf /var/lib/apt/lists/*

# Tailscale, for tests/remote/tailnet.test.ts only: nothing starts tailscaled unless that suite does.
RUN curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg -o /usr/share/keyrings/tailscale-archive-keyring.gpg \
 && curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.tailscale-keyring.list -o /etc/apt/sources.list.d/tailscale.list \
 && apt-get update && apt-get install -y --no-install-recommends tailscale \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# `dev` has no password; only a key (see the sshd config below) gets in. The ubuntu base image ships
# a user at uid 1000, which is removed so `dev` can have it.
RUN (userdel -r ubuntu || true) && useradd -m -s /bin/bash -u 1000 dev && passwd -d dev \
 && mkdir -p /home/dev/.ssh /run/sshd && chmod 700 /home/dev/.ssh && chown dev:dev /home/dev/.ssh

COPY tests/remote/docker/sshd_config /etc/ssh/sshd_config.d/00-apiary-test.conf

# Dependencies first, so a source change does not redo `npm ci`.
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/fix-node-pty-permissions.mjs scripts/
RUN npm ci && node node_modules/electron/install.js
COPY . .
RUN npm run build && chown -R dev:dev /app

RUN chmod +x /app/tests/remote/docker/entrypoint.sh
# What the app's "start Apiary over SSH" command finds on a machine with a user systemd (the bed has none).
RUN install -m 755 /app/tests/remote/docker/apiary-shim.sh /usr/local/bin/apiary \
 && install -m 755 /app/tests/remote/docker/systemd-run-shim.sh /usr/local/bin/systemd-run
EXPOSE 22
ENTRYPOINT ["/app/tests/remote/docker/entrypoint.sh"]
