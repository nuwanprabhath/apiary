#!/bin/sh
# The harness copies /etc/ssh/test_host_key and /home/dev/.ssh/authorized_keys in (and may replace
# the host key) before this runs; `docker start` runs it again, which is how swapHostKey restarts sshd.
set -e
chmod 600 /etc/ssh/test_host_key
chown dev:dev /home/dev/.ssh/authorized_keys
chmod 600 /home/dev/.ssh/authorized_keys
exec /usr/sbin/sshd -D -e
