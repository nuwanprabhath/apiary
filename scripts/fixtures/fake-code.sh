#!/bin/bash
# Stand-in for the `code` CLI, used only by the E2E suite. Records what it was called with so the
# test can assert the exact folder Apiary asked to open, then exits — real VS Code stays closed.
echo "$@" >> "${APIARY_FAKE_CODE_LOG:?APIARY_FAKE_CODE_LOG must be set}"
exit 0
