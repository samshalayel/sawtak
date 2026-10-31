#!/bin/sh
# First-time setup of the lab copy (docker-compose.lab.yml), run on the server by the lab deploy. Does nothing once
# the lab has its .env. The lab gets the real site's settings and a snapshot of its database (accounts, balances),
# but nothing that reaches the outside world: no payment keys, no mail, no Google sign-in, and its own files on its
# disk instead of the site's S3 bucket.
set -eu

PROD=${PROD:-/var/www/sawt}
LAB=${LAB:-/var/www/sawt-lab}
[ -f "$LAB/.env" ] && { echo "Lab already set up."; exit 0; }
mkdir -p "$LAB/data"

grep -v -E '^(MEDIA_|JAWWAL_|SMTP_|MAIL_FROM|GOOGLE_|EXTRA_PUBLIC_URLS|PUBLIC_URL)' "$PROD/.env" > "$LAB/.env"
echo "PUBLIC_URL=http://localhost:3100" >> "$LAB/.env"

# A consistent snapshot of the live database, made by the site's own container, then cut off from mail and payments
docker exec sawtik-ai-tts-studio node -e '
const { DatabaseSync } = require("node:sqlite");
new DatabaseSync("/app/data/sawtik.db").exec("VACUUM INTO \"/app/data/lab-snapshot.db\"");
const lab = new DatabaseSync("/app/data/lab-snapshot.db");
const set = lab.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
for (const k of ["smtpHost", "smtpUser", "smtpPass", "mailFrom"]) set.run(k, "");
set.run("servicePayments", "0");
set.run("betaRibbon", "1");
lab.close();
'
mv "$PROD/data/lab-snapshot.db" "$LAB/data/sawtik.db"
# The voice fingerprints' reference clips (small) so cloned voices work in the lab too
[ -d "$PROD/data/custom-voices" ] && cp -a "$PROD/data/custom-voices" "$LAB/data/" || true
echo "Lab set up in $LAB"
