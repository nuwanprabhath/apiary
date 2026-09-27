#!/bin/bash
# Stand-in for `glab api projects/<enc>/merge_requests/<iid>`, used only by the E2E suite.
if [[ "${APIARY_FAKE_GLAB_FAIL:-}" == "1" ]]; then
  echo "glab: not logged in" >&2
  exit 1
fi
# A spec can change the answer mid-test by writing a state into this file — how "the MR was merged
# while the app was open" is reproduced. Without it, every MR is merged.
if [[ -n "${APIARY_FAKE_GLAB_STATE_FILE:-}" && -s "${APIARY_FAKE_GLAB_STATE_FILE}" ]]; then
  echo "{\"state\":\"$(cat "${APIARY_FAKE_GLAB_STATE_FILE}")\"}"
  exit 0
fi
echo '{"state":"merged"}'
