#!/usr/bin/env python3
"""Project original team model grants into the active Go config store."""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess


def project(catalog, scopes):
    return [m for m in catalog if m.get('kind') in scopes]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('users', nargs='+')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--legacy-reader-projection', action='store_true')
    parser.add_argument('--automation-text-model', default='')
    args = parser.parse_args()
    root = Path('/var/lib/docker/volumes/v88-public_v88_data/_data')
    profiles = {p['username']: p for p in json.loads((root / 'system/member-profiles.json').read_text())}
    container = 'qiantie-unified-mysql'
    cfg = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
    env = dict(x.split('=', 1) for x in cfg['Config']['Env'] if '=' in x)

    def sql(query):
        result = subprocess.run(['docker', 'exec', '-i', '-e', 'MYSQL_PWD=' + env['MYSQL_ROOT_PASSWORD'],
                                 container, 'mysql', '--default-character-set=utf8mb4', '--raw', '-uroot', '-N', '-B', 'qiantie_v88'],
                                input=query, text=True, capture_output=True)
        if result.returncode:
            raise RuntimeError('Database operation failed; private diagnostics suppressed')
        return result.stdout

    def literal(value):
        return "CONVERT(X'" + value.encode().hex() + "' USING utf8mb4)"

    changes = []
    for user in args.users:
        profile = profiles[user]
        manager = profile['boundTo']
        assert manager and profile['apiEnabled'] and profile['role'] == 'member'
        catalog = json.loads((root / 'users' / manager / 'api-config.json').read_text())['modelCatalog']
        expected = project(catalog, profile['apiScopes'])
        assert expected, 'No originally granted models'
        rows = sql('SELECT config_json FROM batch_factory_v11_shuihuo_configs WHERE owner_username=' + literal(user)).splitlines()
        current = json.loads(rows[0]) if rows else {}
        existing = current.get('modelCatalog')
        assert not existing or existing == expected, 'Conflicting current model catalog; refusing replacement'
        current['modelCatalog'] = expected
        legacy_path = root / 'users' / user / 'api-config.json'
        legacy = json.loads(legacy_path.read_text())
        assert not legacy.get('modelCatalog') or legacy['modelCatalog'] == expected, 'Conflicting legacy catalog'
        changes.append((user, current, legacy_path, legacy))
        print(json.dumps({'user': user, 'manager': manager, 'models': len(expected), 'apply': args.apply}))
    if not args.apply:
        return
    backup = Path('/opt/qiantie/backups/automation') / ('models-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(mode=0o700, parents=True, exist_ok=False)
    with (backup / 'configs-before.sql').open('xb') as output:
        result = subprocess.run(['docker', 'exec', '-e', 'MYSQL_PWD=' + env['MYSQL_ROOT_PASSWORD'], container,
                                 'mysqldump', '-uroot', '--single-transaction', '--no-tablespaces',
                                 'qiantie_v88', 'batch_factory_v11_shuihuo_configs'], stdout=output, stderr=subprocess.PIPE)
        assert result.returncode == 0, 'Backup failed'
    statements = ['START TRANSACTION;']
    for user, config, legacy_path, legacy in changes:
        statements.append('INSERT INTO batch_factory_v11_shuihuo_configs(owner_username,config_json,revision,created_at,updated_at) VALUES(' +
                          literal(user) + ',' + literal(json.dumps(config, ensure_ascii=False)) + ',1,NOW(6),NOW(6)) ON DUPLICATE KEY UPDATE config_json=VALUES(config_json),revision=revision+1,updated_at=NOW(6);')
    statements.append('COMMIT;')
    sql('\n'.join(statements))
    if args.automation_text_model:
        with (backup / 'workshop-configs-before.sql').open('xb') as output:
            result = subprocess.run(['docker', 'exec', '-e', 'MYSQL_PWD=' + env['MYSQL_ROOT_PASSWORD'], container,
                                     'mysqldump', '-uroot', '--single-transaction', '--no-tablespaces',
                                     'qiantie_v88', 'novel_fetch_workshop_configs'], stdout=output, stderr=subprocess.PIPE)
            assert result.returncode == 0, 'Workshop config backup failed'
        for user, config, _, _ in changes:
            assert any(m.get('id') == args.automation_text_model and m.get('kind') == 'text' for m in config['modelCatalog'])
            # The deployed automation provider resolves from this store rather
            # than the book settings. Keep original snake_case fields intact.
            sql('UPDATE novel_fetch_workshop_configs SET settings_json=JSON_SET(settings_json,' +
                "'$.textModelId'," + literal(args.automation_text_model) + ",'$.modelCatalog',CAST(" +
                literal(json.dumps(config['modelCatalog'], ensure_ascii=False)) +
                ' AS JSON)),updated_at=NOW(6) WHERE owner_username=' + literal(user))
    if args.legacy_reader_projection:
        # Current Go dynamic-provider fallback reads this legacy file directly,
        # bypassing the original Node readConfig team-owner resolution.
        for user, config, legacy_path, legacy in changes:
            original = legacy_path.read_bytes()
            (backup / (user + '-api-config-before.json')).write_bytes(original)
            os.chmod(backup / (user + '-api-config-before.json'), 0o600)
            legacy['modelCatalog'] = config['modelCatalog']
            temporary = legacy_path.with_name('api-config.team-projection-tmp')
            with temporary.open('x') as output:
                os.chmod(temporary, 0o600)
                json.dump(legacy, output, ensure_ascii=False, indent=2)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, legacy_path)
    print('Original team model projections restored; private backup:', backup)


if __name__ == '__main__':
    main()
