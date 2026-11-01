# The Ubuntu machine for `npm run test:update-deb`: two arm64 .debs of this checkout (V and V+0.0.1,
# both marked as test builds so the packaged app reads APIARY_FAKE_UPDATE*), with V installed by apt.
# Built by tests/update/updateDeb.test.ts.
FROM ubuntu:24.04
LABEL apiary.test-bed=update
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl sudo procps git \
    xvfb xauth dbus-x11 \
    libgtk-3-0 libnss3 libasound2t64 libxss1 libgbm1 libxtst6 libatk-bridge2.0-0 libdrm2 \
    libxkbcommon0 libcups2 libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 libcairo2 \
    build-essential python3 make g++ pkg-config ruby ruby-dev \
 && gem install fpm --no-document \
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

# electron-builder ships no fpm for arm64 Linux; the gem above is used instead.
ENV USE_SYSTEM_FPM=true
RUN npm run build \
 && next=$(node -p "const [a,b,c]=require('./package.json').version.split('.').map(Number); [a,b,c+1].join('.')") \
 && for v in current next; do \
      extra=""; [ "$v" = next ] && extra="-c.extraMetadata.version=$next"; \
      npx electron-builder --config electron-builder.yml --linux deb --arm64 --publish never \
        -c.extraMetadata.apiaryTestBuild=true $extra -c.directories.output=/tmp/debs-$v || exit 1; \
      mkdir -p /debs && cp /tmp/debs-$v/*.deb /debs/apiary-$v.deb && rm -rf /tmp/debs-$v; \
    done \
 && echo "$next" > /debs/next-version \
 && chmod -R a+rX /debs \
 && apt-get update && apt-get install -y /debs/apiary-current.deb && rm -rf /var/lib/apt/lists/* \
 && rm -rf /app/out /app/release

RUN install -m 755 /app/tests/remote/docker/systemd-run-shim.sh /usr/local/bin/systemd-run \
 && install -m 755 /app/tests/update/docker/start-apiary.sh /usr/local/bin/start-apiary
CMD ["sleep", "infinity"]
