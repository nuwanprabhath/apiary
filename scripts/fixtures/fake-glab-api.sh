#!/bin/bash
# Stand-in for `glab api projects/<enc>/merge_requests/<iid>`, used only by the E2E suite.
if [[ "${APIARY_FAKE_GLAB_FAIL:-}" == "1" ]]; then
  echo "glab: not logged in" >&2
  exit 1
fi
echo '{"state":"merged"}'
