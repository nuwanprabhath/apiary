# Ubuntu with systemd as PID 1 and a lingering user, so `systemd-run --user` timers can be tested
# (tests/integration/scheduledSystemd.test.ts). Labelled so cleanup prunes only this bed's images.
FROM ubuntu:24.04
LABEL apiary.test-bed=systemd
ARG TZ=UTC
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends systemd systemd-sysv dbus dbus-user-session procps tzdata \
  && rm -rf /var/lib/apt/lists/* \
  && ln -sf "/usr/share/zoneinfo/$TZ" /etc/localtime \
  && useradd -m -u 1001 tester \
  && mkdir -p /var/lib/systemd/linger && touch /var/lib/systemd/linger/tester
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
