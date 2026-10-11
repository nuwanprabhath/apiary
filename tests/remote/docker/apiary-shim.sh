#!/bin/sh
# Stands in for an installed `apiary` binary in the test bed's image only (never in the app): the
# built app under xvfb as `dev`, against the fixture home the harness copied in. Arguments pass through.
cd /app || exit 1
export APIARY_CONFIG_ROOT=/home/dev/fixture APIARY_DB_PATH=/home/dev/fixture/apiary.db \
  APIARY_DEFAULT_THEME=original APIARY_HEADLESS=1 APIARY_GLAB_PATH='' APIARY_CODE_PATH=''
exec xvfb-run -a ./node_modules/.bin/electron . --no-sandbox --disable-gpu --user-data-dir=/home/dev/fixture/userdata "$@"
