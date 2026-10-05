#!/usr/bin/env sh
# Manual encrypted database backup without the application (e.g. on a server
# where the app does not start). Requires pg_dump and openssl.
#   DATABASE_URL=... BACKUP_ENCRYPTION_KEY=... ./deploy/backup.sh [output-dir]
set -eu
OUT=${1:-./backups}
mkdir -p "$OUT"
STAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
FILE="$OUT/manual-$STAMP.dump"
: "${DATABASE_URL:?DATABASE_URL puuttuu}"
pg_dump --format=custom --no-owner --no-privileges \
  --schema=core --schema=core_meta --schema='m[0-9][0-9][0-9][0-9]_*' \
  --file "$FILE" "$DATABASE_URL"
if [ -n "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  # OpenSSL variant (AES-256-CBC + PBKDF2). The app's own backups use AES-256-GCM; see docs/BACKUP.md.
  openssl enc -aes-256-cbc -pbkdf2 -salt -in "$FILE" -out "$FILE.enc" -pass env:BACKUP_ENCRYPTION_KEY
  rm "$FILE"
  FILE="$FILE.enc"
fi
echo "Varmuuskopio: $FILE"
