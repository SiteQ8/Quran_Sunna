#!/usr/bin/env python3
"""Takes a build that reached App Store Connect to the store: the version made
or found, the build attached to it, what is new written, the screenshots of
iPhone Duo placed, and the whole sent for review.

    asc-release.py --version 8.87.60 --build 346 --duo shots/iphone-duo \\
                   --notes ios/whatsnew/ar-SA.txt [--dry-run] [--no-submit]

The key comes from the environment as the iOS workflow holds it: ASC_KEY_ID,
ASC_ISSUER_ID and ASC_KEY_P8 (the .p8 in base64), or ASC_KEY_PATH to the .p8
itself when run by hand. --dry-run reads everything and changes nothing.
--no-submit does all but the last step, and leaves the version ready for a
person to look at and send.

iPhone Duo has one kind of screenshot set, APP_IPHONE_DUO, which takes the
outer display at 1398 by 2034 and the inner at 2853 by 2007, either way up.
Apple's published description of the api does not list it yet; the server
takes it. The six screenshots of the 6.9 inch phone are carried over from the
version on sale when the new one comes without them.
"""

import argparse
import base64
import hashlib
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.request

import jwt

APP = '6814355836'
API = 'https://api.appstoreconnect.apple.com'
EDITABLE = {'PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED',
            'METADATA_REJECTED', 'INVALID_BINARY'}
BUSY = {'WAITING_FOR_REVIEW', 'IN_REVIEW', 'PENDING_DEVELOPER_RELEASE',
        'PROCESSING_FOR_APP_STORE', 'PENDING_APPLE_RELEASE'}
DUO = 'APP_IPHONE_DUO'
DUO_SIZES = {(1398, 2034), (2034, 1398), (2007, 2853), (2853, 2007)}
# the inner display opened first, the book being what the phone is for, and
# the outer display after; at most ten in a set
DUO_ORDER = ['open-8-mushaf-300-inner', 'open-1-home-inner', 'open-7-mushaf-1-inner',
             'open-2-azkar-inner', 'open-4-tasbih-inner', 'open-3-quran-inner',
             'closed-1-home-outer', 'closed-8-mushaf-300-outer', 'closed-2-azkar-outer',
             'closed-3-quran-outer']

DRY = False


def log(*a):
    print(*a, flush=True)


def key():
    if os.environ.get('ASC_KEY_PATH'):
        return open(os.environ['ASC_KEY_PATH']).read()
    return base64.b64decode(os.environ['ASC_KEY_P8']).decode()


def token():
    now = int(time.time())
    return jwt.encode({'iss': os.environ['ASC_ISSUER_ID'], 'iat': now, 'exp': now + 1100,
                       'aud': 'appstoreconnect-v1'}, key(), algorithm='ES256',
                      headers={'kid': os.environ['ASC_KEY_ID'], 'typ': 'JWT'})


def api(method, path, body=None, writes=True):
    """One call to the api; a write in a dry run is shown, not made."""
    if DRY and writes and method != 'GET':
        log('  [dry run] %s %s %s' % (method, path, json.dumps(body, ensure_ascii=False)[:300] if body else ''))
        return {'data': {'id': 'DRY-RUN', 'attributes': {}}}
    url = path if path.startswith('http') else API + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            text = r.read().decode()
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as e:
        raise SystemExit('%s %s failed with %s: %s' % (method, path, e.code, e.read().decode()[:1500]))


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    return struct.unpack('>II', head[16:24])


# ---------------------------------------------------------------- the build

def wait_for_build(version, number, minutes):
    """The build is usable once Apple has processed it, some minutes after upload."""
    deadline = time.time() + minutes * 60
    while True:
        res = api('GET', '/v1/builds?filter[app]=%s&filter[version]=%s&filter[preReleaseVersion.version]=%s&limit=1'
                  % (APP, number, version))
        if res.get('data'):
            b = res['data'][0]
            state = b['attributes'].get('processingState')
            log('build %s (%s): %s' % (number, version, state))
            if state == 'VALID':
                return b['id']
            if state in ('FAILED', 'INVALID'):
                raise SystemExit('Apple could not process build %s: %s' % (number, state))
        else:
            log('build %s (%s) not in App Store Connect yet' % (number, version))
        if time.time() > deadline:
            raise SystemExit('build %s was not ready after %d minutes' % (number, minutes))
        time.sleep(60)


# --------------------------------------------------------------- the version

def versions():
    return api('GET', '/v1/apps/%s/appStoreVersions?filter[platform]=IOS&limit=20' % APP)['data']


def on_sale():
    for v in versions():
        if v['attributes']['appStoreState'] == 'READY_FOR_SALE':
            return v
    return None


def version_to_send(version):
    """The version a person would fill in: one already open is reused and
    renamed, and a new one is made only when there is none."""
    for v in versions():
        state = v['attributes']['appStoreState']
        if state in BUSY:
            raise SystemExit('version %s is %s; nothing is sent over it'
                             % (v['attributes']['versionString'], state))
        if state in EDITABLE:
            if v['attributes']['versionString'] != version:
                log('renaming open version %s to %s' % (v['attributes']['versionString'], version))
                api('PATCH', '/v1/appStoreVersions/' + v['id'], {'data': {
                    'type': 'appStoreVersions', 'id': v['id'], 'attributes': {'versionString': version}}})
            else:
                log('version %s is open, %s' % (version, state))
            return v['id']
    log('making version %s' % version)
    made = api('POST', '/v1/appStoreVersions', {'data': {
        'type': 'appStoreVersions',
        'attributes': {'platform': 'IOS', 'versionString': version, 'releaseType': 'AFTER_APPROVAL'},
        'relationships': {'app': {'data': {'type': 'apps', 'id': APP}}}}})
    return made['data']['id']


def attach(version_id, build_id):
    log('attaching the build')
    api('PATCH', '/v1/appStoreVersions/%s/relationships/build' % version_id,
        {'data': {'type': 'builds', 'id': build_id}})


def localizations(version_id):
    if version_id == 'DRY-RUN':
        return []
    return api('GET', '/v1/appStoreVersions/%s/appStoreVersionLocalizations?limit=50' % version_id)['data']


def write_notes(version_id, notes):
    for loc in localizations(version_id):
        log('what is new, %s' % loc['attributes']['locale'])
        api('PATCH', '/v1/appStoreVersionLocalizations/' + loc['id'], {'data': {
            'type': 'appStoreVersionLocalizations', 'id': loc['id'], 'attributes': {'whatsNew': notes}}})


# ------------------------------------------------------------- screenshots

def sets_of(loc_id):
    res = api('GET', '/v1/appStoreVersionLocalizations/%s/appScreenshotSets?limit=50&include=appScreenshots' % loc_id)
    shots = {s['id']: s for s in res.get('included', []) if s['type'] == 'appScreenshots'}
    out = {}
    for s in res['data']:
        ids = [x['id'] for x in s.get('relationships', {}).get('appScreenshots', {}).get('data', [])]
        out[s['attributes']['screenshotDisplayType']] = (s['id'], [shots[i] for i in ids if i in shots])
    return out


def new_set(loc_id, kind):
    made = api('POST', '/v1/appScreenshotSets', {'data': {
        'type': 'appScreenshotSets', 'attributes': {'screenshotDisplayType': kind},
        'relationships': {'appStoreVersionLocalization': {'data': {
            'type': 'appStoreVersionLocalizations', 'id': loc_id}}}}})
    return made['data']['id']


def upload(set_id, name, data):
    """Reserve, send the parts where Apple says, then say it is all there and
    wait until Apple has looked at the picture."""
    log('  uploading %s (%d bytes)' % (name, len(data)))
    made = api('POST', '/v1/appScreenshots', {'data': {
        'type': 'appScreenshots', 'attributes': {'fileName': name, 'fileSize': len(data)},
        'relationships': {'appScreenshotSet': {'data': {'type': 'appScreenshotSets', 'id': set_id}}}}})
    if DRY:
        return
    shot = made['data']
    for op in shot['attributes']['uploadOperations']:
        part = data[op['offset']:op['offset'] + op['length']]
        req = urllib.request.Request(op['url'], data=part, method=op['method'],
                                     headers={h['name']: h['value'] for h in op.get('requestHeaders', [])})
        with urllib.request.urlopen(req, timeout=300) as r:
            r.read()
    api('PATCH', '/v1/appScreenshots/' + shot['id'], {'data': {
        'type': 'appScreenshots', 'id': shot['id'],
        'attributes': {'uploaded': True, 'sourceFileChecksum': hashlib.md5(data).hexdigest()}}})
    for _ in range(60):
        state = api('GET', '/v1/appScreenshots/' + shot['id'])['data']['attributes'].get('assetDeliveryState') or {}
        if state.get('state') == 'COMPLETE':
            return
        if state.get('state') == 'FAILED':
            raise SystemExit('Apple refused %s: %s' % (name, json.dumps(state.get('errors'), ensure_ascii=False)))
        time.sleep(5)
    raise SystemExit('%s was not accepted in five minutes' % name)


def carry_phone_shots(loc_id, locale, sets):
    """A new version may come without the phone's screenshots; those on sale
    are carried over, picture by picture, in their order."""
    have = sets.get('APP_IPHONE_67', (None, []))
    if have[1]:
        log('the 6.9 inch screenshots are there (%d)' % len(have[1]))
        return
    live = on_sale()
    if not live:
        raise SystemExit('no screenshots for the 6.9 inch phone, and no version on sale to take them from')
    source = None
    for loc in localizations(live['id']):
        if loc['attributes']['locale'] == locale:
            source = sets_of(loc['id']).get('APP_IPHONE_67')
    if not source or not source[1]:
        raise SystemExit('the version on sale has no 6.9 inch screenshots for %s' % locale)
    log('carrying %d screenshots of the 6.9 inch phone over from %s'
        % (len(source[1]), live['attributes']['versionString']))
    set_id = have[0] or new_set(loc_id, 'APP_IPHONE_67')
    for shot in source[1]:
        a = shot['attributes']
        asset = a['imageAsset']
        url = asset['templateUrl'].replace('{w}', str(asset['width'])).replace('{h}', str(asset['height'])).replace('{f}', 'png')
        with urllib.request.urlopen(url, timeout=120) as r:
            upload(set_id, a['fileName'], r.read())


def place_duo(loc_id, sets, folder):
    files = []
    for stem in DUO_ORDER:
        path = os.path.join(folder, stem + '.png')
        if os.path.exists(path):
            size = png_size(path)
            if size in DUO_SIZES:
                files.append(path)
            else:
                log('  %s is %s, not a size iPhone Duo takes' % (stem, size))
    files = files[:10]
    if not files:
        raise SystemExit('no iPhone Duo screenshots in %s' % folder)
    if DUO in sets:
        log('replacing the iPhone Duo screenshots')
        api('DELETE', '/v1/appScreenshotSets/' + sets[DUO][0])
    log('iPhone Duo: %s' % ', '.join(os.path.basename(f) for f in files))
    set_id = new_set(loc_id, DUO)
    for path in files:
        with open(path, 'rb') as f:
            upload(set_id, os.path.basename(path), f.read())


# ------------------------------------------------------------------ review

def send(version_id):
    open_ones = api('GET', '/v1/reviewSubmissions?filter[app]=%s&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW'
                    % APP)['data']
    if open_ones:
        sub = open_ones[0]['id']
        log('using the review submission already open')
    else:
        sub = api('POST', '/v1/reviewSubmissions', {'data': {
            'type': 'reviewSubmissions', 'attributes': {'platform': 'IOS'},
            'relationships': {'app': {'data': {'type': 'apps', 'id': APP}}}}})['data']['id']
    items = [] if sub == 'DRY-RUN' else api('GET', '/v1/reviewSubmissions/%s/items' % sub)['data']
    if not items:
        api('POST', '/v1/reviewSubmissionItems', {'data': {
            'type': 'reviewSubmissionItems',
            'relationships': {'reviewSubmission': {'data': {'type': 'reviewSubmissions', 'id': sub}},
                              'appStoreVersion': {'data': {'type': 'appStoreVersions', 'id': version_id}}}}})
    api('PATCH', '/v1/reviewSubmissions/' + sub, {'data': {
        'type': 'reviewSubmissions', 'id': sub, 'attributes': {'submitted': True}}})
    log('sent for review')


def main():
    global DRY
    p = argparse.ArgumentParser()
    p.add_argument('--version', required=True)
    p.add_argument('--build', required=True)
    p.add_argument('--duo', required=True)
    p.add_argument('--notes', required=True)
    p.add_argument('--wait', type=int, default=45, help='minutes to wait for Apple to process the build')
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--no-submit', action='store_true')
    a = p.parse_args()
    DRY = a.dry_run
    notes = open(a.notes, encoding='utf-8').read().strip()

    build_id = wait_for_build(a.version, a.build, a.wait)
    version_id = version_to_send(a.version)
    attach(version_id, build_id)
    write_notes(version_id, notes)
    # a dry run that would make the version reads the one on sale instead
    reading = on_sale()['id'] if version_id == 'DRY-RUN' else version_id
    for loc in localizations(reading):
        locale = loc['attributes']['locale']
        sets = sets_of(loc['id'])
        carry_phone_shots(loc['id'], locale, sets)
        place_duo(loc['id'], sets_of(loc['id']), a.duo)
    if a.no_submit or DRY:
        log('left ready to send, not sent')
        return
    send(version_id)


if __name__ == '__main__':
    main()
