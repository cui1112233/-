#!/usr/bin/env python3
"""Recover missing publish classification through the normal metadata API.

Uses only each member's existing text model grant. Never logs credentials or
novel text. Saves private metadata backups before optimistic API updates.
"""
import argparse
import datetime
import hashlib
import hmac
import json
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.request

STYLES = '古风虐文 古风甜文 古风通用 年代虐文 年代甜文 年代通用 现代虐文 现代甜文 现代悬疑 现代通用 男频都市 现代女主 玄幻 历史 爆款BGM 家庭奇葩 家庭伤感 职场打脸'.split()


def classification(text):
    text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text.strip())
    value = json.loads(text)
    gender = {'男': '男频', '女': '女频', '男频': '男频', '女频': '女频'}.get(value.get('gender'))
    if not gender or value.get('style') not in STYLES:
        raise ValueError('Invalid classification; no metadata was changed')
    return dict(value, gender=gender)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('user')
    parser.add_argument('batch')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    container = json.loads(subprocess.check_output(['docker', 'inspect', 'v88-public-go-api-1']))[0]
    env = dict(x.split('=', 1) for x in container['Config']['Env'] if '=' in x)
    ip = next(iter(container['NetworkSettings']['Networks'].values()))['IPAddress']

    def api(path, method='GET', data=None):
        issued = str(int(time.time()))
        signature = hmac.new(env['QIANTIE_BRIDGE_SECRET'].encode(), (args.user + issued + 'false' + method + path).encode(), hashlib.sha256).hexdigest()
        headers = {'Content-Type': 'application/json', 'X-Qiantie-Username': args.user,
                   'X-Qiantie-Issued-At': issued, 'X-Qiantie-Is-Owner': 'false', 'X-Qiantie-Signature': signature}
        request = urllib.request.Request('http://' + ip + ':3000' + path, headers=headers, method=method,
                                         data=json.dumps(data).encode() if data is not None else None)
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response)

    # Header spellings match the running bridge, not public browser auth.
    root = Path('/var/lib/docker/volumes/v88-public_v88_data/_data')
    config = json.loads((root / 'users' / args.user / 'api-config.json').read_text())
    model = next(m for m in config['modelCatalog'] if m['id'] == 'custom-a-gemini-3-7-flash' and m['kind'] == 'text')
    base = '/api/batch-factory/v12/batches/' + args.batch
    loaded = api(base)
    batch = loaded.get('batch', loaded)
    backup = Path('/opt/qiantie/backups/automation') / ('classification-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    if args.apply:
        backup.mkdir(mode=0o700)
    for book in batch['books']:
        metadata = book.get('sourceMetadata', {})
        if metadata.get('gender') in ('男频', '女频') and metadata.get('style') in STYLES:
            print(book['id'], 'already classified', flush=True)
            continue
        if not args.apply:
            print(book['id'], 'classification needed', flush=True)
            continue
        endpoint = model.get('endpoint') or model.get('baseUrl') or model.get('baseURL')
        endpoint = endpoint.rstrip('/')
        if not endpoint.endswith('/chat/completions'):
            endpoint += '/chat/completions'
        messages = [{'role': 'system', 'content': '你是网文发布分类助手。仅基于小说内容判断，不得编造。只返回 JSON：{"gender":"男频或女频","style":"风格名","tags":["标签"],"reason":"不超过40字的依据"}。style 必须严格选择其一：' + '、'.join(STYLES)},
                    {'role': 'user', 'content': '书名：' + book['title'] + '\n原始书城：' + str(metadata.get('platformName', book.get('platform', ''))) + '\n小说正文：\n' + book['sourceText'][:12000]}]
        request = urllib.request.Request(endpoint, method='POST', headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + model['credential']},
                                         data=json.dumps({'model': model['modelId'], 'messages': messages, 'max_tokens': 2000, 'temperature': 0.1, 'stream': False}).encode())
        with urllib.request.urlopen(request, timeout=180) as response:
            result = classification(json.load(response)['choices'][0]['message']['content'])
        # Refresh optimistic revision; director production may have advanced.
        latest = api(base)
        current = next(b for b in latest.get('batch', latest)['books'] if b['id'] == book['id'])
        metadata = current.get('sourceMetadata', {})
        saved = backup / (book['id'] + '.json')
        saved.touch(mode=0o600, exist_ok=False)
        saved.write_text(json.dumps(metadata, ensure_ascii=False))
        gender = metadata.get('gender') if metadata.get('gender') in ('男频', '女频') else result['gender']
        updated = dict(metadata, gender=gender, style=result['style'], tags='、'.join(result.get('tags', [])) if isinstance(result.get('tags'), list) else str(result.get('tags', '')),
                       classifyStatus='classified', classifyReason=result.get('reason', ''), classifyModel=model['modelId'],
                       classifyAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), styleStatus='classified', styleError='')
        api(base + '/books/' + book['id'] + '/metadata', 'PUT', {'metadata': updated, 'expectedRevision': current['revision']})
        print(book['id'], gender, result['style'], 'saved', flush=True)


if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as error:
        raise SystemExit('Remote request failed: HTTP ' + str(error.code))
