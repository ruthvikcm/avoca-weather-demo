#!/bin/zsh
# Cron entrypoint: poll monitor events + refresh NWS ground truth.
# Installed as: */15 * * * * /Users/ruthvikmukkamala/avoca-weather-demo/poll.sh
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
cd /Users/ruthvikmukkamala/avoca-weather-demo || exit 1
export PARALLEL_API_KEY=$(grep '^PARALLEL_API_KEY=' /Users/ruthvikmukkamala/devrev-demo/.env | cut -d= -f2-)
{
  npx tsx scripts/check-events.ts
  npx tsx scripts/nws-ground-truth.ts
} >> data/poll.log 2>&1
