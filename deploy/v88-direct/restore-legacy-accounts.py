#!/usr/bin/env python3
"""Restore absent legacy accounts only; never reset passwords or replace members."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('--apply', action='store_true')
args = parser.parse_args()
system = Path('/var/lib/docker/volumes/v88-public_v88_data/_data/system')
container = 'qiantie-unified-mysql'
config = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
env = dict(item.split('=', 1) for item in config['Config']['Env'] if '=' in item)
password = env['MYSQL_ROOT_PASSWORD']

def mysql(sql):
    result = subprocess.run(['docker', 'exec', '-i', '-e', 'MYSQL_PWD=' + password,
                             container, 'mysql', '-uroot', '-N', '-B', 'qiantie_v88'],
                            input=sql, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('Database operation failed; sensitive diagnostics suppressed')
    return result.stdout

def literal(value):
    return "CONVERT(X'" + str(value).encode().hex() + "' USING utf8mb4)"

def timestamp(value):
    return datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(
        datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S.%f')

records = json.loads((system / 'accounts.json').read_text())
assert isinstance(records, list) and records
seen = set()
for record in records:
    name = record['username']
    assert re.fullmatch(r'[A-Za-z0-9_-]{1,32}', name) and name not in seen
    seen.add(name)
    assert re.fullmatch(r'scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}', record['passwordHash'])
    assert isinstance(record['active'], bool) and isinstance(record['isOwner'], bool)
    timestamp(record['createdAt'])
    timestamp(record['updatedAt'])

existing = set(mysql('SELECT username FROM accounts;').splitlines())
missing = [record for record in records if record['username'] not in existing]
print(json.dumps({'legacy': len(records), 'existing': len(existing), 'missing': len(missing),
                  'existingRecordsPreserved': True}))
if not args.apply:
    raise SystemExit(0)

os.umask(0o077)
backup = Path('/opt/qiantie/backups/auth') / ('all-users-' + datetime.datetime.now(
    datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True, exist_ok=False)
with (backup / 'accounts-sessions-before.sql').open('wb') as output:
    result = subprocess.run(['docker', 'exec', '-e', 'MYSQL_PWD=' + password, container,
                             'mysqldump', '-uroot', '--single-transaction', '--no-tablespaces',
                             'qiantie_v88', 'accounts', 'auth_sessions'], stdout=output,
                            stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('Backup failed; no database changes made')
with tarfile.open(backup / 'legacy-system-before.tar.gz', 'w:gz') as archive:
    archive.add(system, arcname='system')
(backup / 'inserted-usernames.json').write_text(json.dumps([r['username'] for r in missing]))

statements = ['START TRANSACTION;']
for record in missing:
    values = [literal(record['username']), literal(record['passwordHash']), literal('scrypt'),
              str(int(record['isOwner'])), str(int(record['active'])),
              literal(timestamp(record['createdAt'])), literal(timestamp(record['updatedAt']))]
    statements.append('INSERT INTO accounts (username,password_hash,password_algorithm,is_owner,'
                      'active,created_at,updated_at) VALUES (' + ','.join(values) + ');')
statements.append('COMMIT;')
mysql('\n'.join(statements))
for record in missing:
    verified = mysql('SELECT COUNT(*) FROM accounts WHERE username=' + literal(record['username'])
                     + ' AND BINARY password_hash=BINARY ' + literal(record['passwordHash'])
                     + " AND password_algorithm='scrypt';").strip()
    assert verified == '1', 'Restored hash verification failed'
print(json.dumps({'restored': len(missing), 'total': int(mysql('SELECT COUNT(*) FROM accounts;')),
                  'originalHashesVerified': True, 'backup': str(backup)}))
