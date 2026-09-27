#!/bin/bash
# A stand-in for `glab`, used only by the E2E suite.
#
# The merge-request plugin shells out to GitLab's CLI, and a test must not depend on a real GitLab
# login, a network, or a project that happens to exist. This answers the one command the plugin
# runs — `glab mr list --all --source-branch <branch> --output json` — with a fixed merge request, or
# with an empty list when APIARY_FAKE_GLAB_EMPTY is set, so both halves of the button (open the MR
# / create one) can be driven. APIARY_FAKE_GLAB_MERGED answers with a merged one instead, which is
# the state the real CLI only reports when `--all` is passed.
#
# Using a fake binary rather than stubbing inside the app keeps the spawn, the argument list and
# the JSON parsing in the test's path — which is where the mistakes in this plugin would be.

if [[ "${APIARY_FAKE_GLAB_FAIL:-}" == "1" ]]; then
  echo "glab: not logged in" >&2
  exit 1
fi

# The plugin must ask for every state, not just open ones: `glab mr list` defaults to open-only,
# so without --all a merged MR disappears and the button offers to create a duplicate. Failing
# here rather than answering keeps that regression from passing silently.
if [[ " $* " != *" --all "* ]]; then
  echo "fake-glab: expected --all so merged merge requests are found; got: $*" >&2
  exit 2
fi

if [[ "${APIARY_FAKE_GLAB_EMPTY:-}" == "1" ]]; then
  echo '[]'
  exit 0
fi

if [[ "${APIARY_FAKE_GLAB_MERGED:-}" == "1" ]]; then
  cat <<'JSON'
[{"iid":1268,
  "state":"merged",
  "draft":false,
  "target_branch":"dev/1.0.12",
  "title":"fix(cypress): offline herbarium determination",
  "web_url":"https://gitlab.com/ternandsparrow/paratoo-fdcp/-/merge_requests/1268"}]
JSON
  exit 0
fi

cat <<'JSON'
[{"iid":1255,
  "state":"opened",
  "draft":false,
  "target_branch":"dev/1.0.12",
  "title":"fix(cypress): wait for the app's own filter signal",
  "web_url":"https://gitlab.com/ternandsparrow/paratoo-fdcp/-/merge_requests/1255"}]
JSON
