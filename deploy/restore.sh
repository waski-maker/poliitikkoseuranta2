#!/usr/bin/env sh
# Restores a backup made by deploy/backup.sh or by the application (*.dump.enc).
#   DATABASE_URL=... BACKUP_ENCRYPTION_KEY=... ./deploy/restore.sh <file> --confirm
# Application backups (AES-256-GCM, "PSB1" header) are decrypted with Node:
#   node deploy/decrypt-backup.mjs <file.dump.enc> <file.dump>
set -eu
FILE=${1:?Anna varmuuskopiotiedosto}
[ "${2:-}" = "--confirm" ] || { echo "Palautus korvaa tietokannan sisällön. Lisää --confirm."; exit 1; }
: "${DATABASE_URL:?DATABASE_URL puuttuu}"
TMP=$(mktemp)
case "$FILE" in
  manual-*.enc|*/manual-*.enc) openssl enc -d -aes-256-cbc -pbkdf2 -in "$FILE" -out "$TMP" -pass env:BACKUP_ENCRYPTION_KEY ;;
  *.enc) node "$(dirname "$0")/decrypt-backup.mjs" "$FILE" "$TMP" ;;
  *) cp "$FILE" "$TMP" ;;
esac
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
end \$\$; create extension if not exists vector; create extension if not exists pg_trgm; create extension if not exists pgcrypto; create schema if not exists auth;"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$DATABASE_URL" "$TMP"
rm -f "$TMP"
echo "Palautettu: $FILE"
