#!/bin/sh
# A stand-in for `claude`, used by tests/integration/accountLaunch.test.ts.
#
# It writes the CLAUDE_CONFIG_DIR it was started with (or "<unset>") to the file named by
# APIARY_ENV_OUT, then answers like a one-shot call, so the same script stands in for a terminal, a
# chat and a one-shot run. Reading the environment from inside the process is the point: the
# account's folder reaches `claude` only through the environment of the process that is started.
printf '%s' "${CLAUDE_CONFIG_DIR:-<unset>}" > "${APIARY_ENV_OUT:?APIARY_ENV_OUT names the file to write}"
echo '{"result":"ok"}'
