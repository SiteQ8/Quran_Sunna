#!/usr/bin/env python3
"""Takes a build that reached App Store Connect to the store: the version made
or found, the build attached to it, what is new written, the screenshots of
iPhone Duo placed, the preview films placed, and the whole sent for review.

    asc-release.py --version 8.87.60 --build 346 --duo shots/iphone-duo \\
                   --notes ios/whatsnew/ar-SA.txt --previews ios/previews \\
                   [--dry-run] [--no-submit]

    asc-release.py --previews-only --version 8.87.63 --previews ios/previews

The key comes from the environment as the iOS workflow holds it: ASC_KEY_ID,
ASC_ISSUER_ID and ASC_KEY_P8 (the .p8 in base64), or ASC_KEY_PATH to the .p8
itself when run by hand. --dry-run reads everything and changes nothing.
--no-submit does all but the last step, and leaves the version ready for a
person to look at and send.

iPhone Duo has one kind of screenshot set, APP_IPHONE_DUO, which takes the
outer display at 1398 by 2034 and the inner at 2853 by 2007, either way up.
Apple's published description of the api does not list it yet; the server
takes it. A build from an Xcode that does not know iPhone Duo comes with no
screenshots of it, and then the set is left as it is. The six screenshots of
the 6.9 inch phone are carried over from the version on sale when the new one
comes without them.

The previews are films in a folder for each kind of phone, ios/previews/
iphone-67 for the 6.9 inch phone at 886 by 1920, with the still the store
shows before one plays beside it in a .poster file, as 00:00:18:24. A film
already there with the same bytes is left; one that changed replaces the set.
--previews-only places them in the version being prepared, or in a new one
when there is none, with the phone's screenshots carried over so it does not
stand empty, and changes nothing else: no build, no notes, no review. They go
to the store with the next version sent.

The 6.9 inch screenshots are carried over only when none are given. --shots
names a folder of them, 1320 by 2868 in the order of their names, and they
replace the set in every language of the version; with --shots-only that is
all that is done, in the version being prepared. A version Apple has not
started looking at, WAITING_FOR_REVIEW, takes nothing; --withdraw takes it
back from review first, places the screenshots, and sends it again, so it
waits its turn once more. One Apple is already looking at cannot be taken
back, and is left.

    asc-release.py --status
    asc-release.py --shots-only --shots ios/screenshots/6.9-inch --version 8.87.67 [--withdraw]

--text names the folder of the page's own words, ios/store, a folder for each
language with description.txt, keywords.txt and promotional.txt in it, and
they are written into the version sent, beside what is new. Each is measured
against what Apple takes before anything is sent.
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


# The words of the page itself, kept in the repository a folder for each
# language, ios/store/ar-SA: description.txt, keywords.txt and promotional.txt,
# whichever are there. Apple takes four thousand characters of description, a
# hundred of keywords and a hundred and seventy of promotional text, and a
# file longer than that stops the run before anything is sent.
TEXT_FIELDS = (('description.txt', 'description', 4000),
               ('keywords.txt', 'keywords', 100),
               ('promotional.txt', 'promotionalText', 170))


def store_text(folder, locale):
    """What the folder says for a language, as the attributes Apple names."""
    here = os.path.join(folder, locale)
    words = {}
    for name, field, limit in TEXT_FIELDS:
        path = os.path.join(here, name)
        if not os.path.isfile(path):
            continue
        text = open(path, encoding='utf-8').read().strip()
        if field == 'keywords':
            text = ','.join(k.strip() for k in text.replace('\n', ',').split(',') if k.strip())
        if len(text) > limit:
            raise SystemExit('%s is %d characters, and Apple takes %d' % (path, len(text), limit))
        # Apple refused the page once for the sign of the salutation; it is
        # written out in words there
        if 'ﷺ' in text:
            raise SystemExit('%s has the sign of the salutation, which Apple refuses: write it out' % path)
        words[field] = text
    return words


def write_text(version_id, folder):
    for loc in localizations(version_id):
        locale = loc['attributes']['locale']
        words = store_text(folder, locale)
        if not words:
            continue
        log('the page, %s: %s' % (locale, ', '.join(sorted(words))))
        api('PATCH', '/v1/appStoreVersionLocalizations/' + loc['id'], {'data': {
            'type': 'appStoreVersionLocalizations', 'id': loc['id'], 'attributes': words}})


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
        # a build from an Xcode before 27.1 is not for iPhone Duo and has no
        # pictures of it; what the version holds already is left as it is
        log('no iPhone Duo screenshots in %s, so that set is left as it is' % folder)
        return
    if DUO in sets:
        log('replacing the iPhone Duo screenshots')
        api('DELETE', '/v1/appScreenshotSets/' + sets[DUO][0])
    log('iPhone Duo: %s' % ', '.join(os.path.basename(f) for f in files))
    set_id = new_set(loc_id, DUO)
    for path in files:
        with open(path, 'rb') as f:
            upload(set_id, os.path.basename(path), f.read())


# ---------------------------------------------------------------- previews

# the folder each kind of phone's films are kept in, and Apple's name for it;
# the 6.9 inch phone's set is called 67, as its screenshots are
PREVIEW_KINDS = {'iphone-67': 'IPHONE_67'}


def preview_sets_of(loc_id):
    res = api('GET', '/v1/appStoreVersionLocalizations/%s/appPreviewSets?limit=50&include=appPreviews' % loc_id)
    films = {s['id']: s for s in res.get('included', []) if s['type'] == 'appPreviews'}
    out = {}
    for s in res.get('data', []):
        ids = [x['id'] for x in s.get('relationships', {}).get('appPreviews', {}).get('data', [])]
        out[s['attributes']['previewType']] = (s['id'], [films[i] for i in ids if i in films])
    return out


def films_in(folder):
    """Up to three films for each kind of phone, in the order of their names."""
    out = {}
    for sub, kind in PREVIEW_KINDS.items():
        here = os.path.join(folder, sub)
        if os.path.isdir(here):
            names = sorted(n for n in os.listdir(here) if n.endswith('.mp4'))[:3]
            if names:
                out[kind] = [os.path.join(here, n) for n in names]
    return out


def poster_of(path):
    side = path[:-4] + '.poster'
    return open(side).read().strip() if os.path.exists(side) else None


def upload_film(set_id, path):
    """As a screenshot goes up, then a wait while Apple makes the film ready,
    which takes minutes rather than seconds."""
    with open(path, 'rb') as f:
        data = f.read()
    name = os.path.basename(path)
    poster = poster_of(path)
    log('  uploading %s (%d bytes)%s' % (name, len(data), ', its still at ' + poster if poster else ''))
    attrs = {'fileName': name, 'fileSize': len(data), 'mimeType': 'video/mp4'}
    if poster:
        attrs['previewFrameTimeCode'] = poster
    made = api('POST', '/v1/appPreviews', {'data': {
        'type': 'appPreviews', 'attributes': attrs,
        'relationships': {'appPreviewSet': {'data': {'type': 'appPreviewSets', 'id': set_id}}}}})
    if DRY:
        return
    film = made['data']
    for op in film['attributes']['uploadOperations']:
        part = data[op['offset']:op['offset'] + op['length']]
        req = urllib.request.Request(op['url'], data=part, method=op['method'],
                                     headers={h['name']: h['value'] for h in op.get('requestHeaders', [])})
        with urllib.request.urlopen(req, timeout=300) as r:
            r.read()
    api('PATCH', '/v1/appPreviews/' + film['id'], {'data': {
        'type': 'appPreviews', 'id': film['id'],
        'attributes': {'uploaded': True, 'sourceFileChecksum': hashlib.md5(data).hexdigest()}}})
    for _ in range(90):
        state = api('GET', '/v1/appPreviews/' + film['id'])['data']['attributes'].get('assetDeliveryState') or {}
        if state.get('state') == 'COMPLETE':
            log('  %s is in place' % name)
            return
        if state.get('state') == 'FAILED':
            raise SystemExit('Apple refused %s: %s' % (name, json.dumps(state.get('errors'), ensure_ascii=False)))
        time.sleep(10)
    log('  %s went up and Apple is still making it ready; App Store Connect shows it when done' % name)


def place_previews(loc_id, folder):
    films = films_in(folder)
    if not films:
        log('no preview films in %s' % folder)
        return
    have = preview_sets_of(loc_id)
    for kind, paths in films.items():
        sums = []
        for p in paths:
            with open(p, 'rb') as f:
                sums.append(hashlib.md5(f.read()).hexdigest())
        there = have.get(kind)
        if there and [f['attributes'].get('sourceFileChecksum') for f in there[1]] == sums:
            # the same films; only the still is set again if it moved
            for f, p in zip(there[1], paths):
                poster = poster_of(p)
                if poster and f['attributes'].get('previewFrameTimeCode') != poster:
                    log('  the still of %s moves to %s' % (os.path.basename(p), poster))
                    api('PATCH', '/v1/appPreviews/' + f['id'], {'data': {
                        'type': 'appPreviews', 'id': f['id'], 'attributes': {'previewFrameTimeCode': poster}}})
            log('the %s previews are there already' % kind)
            continue
        if there:
            log('replacing the %s previews' % kind)
            api('DELETE', '/v1/appPreviewSets/' + there[0])
        log('%s: %s' % (kind, ', '.join(os.path.basename(p) for p in paths)))
        set_id = api('POST', '/v1/appPreviewSets', {'data': {
            'type': 'appPreviewSets', 'attributes': {'previewType': kind},
            'relationships': {'appStoreVersionLocalization': {'data': {
                'type': 'appStoreVersionLocalizations', 'id': loc_id}}}}})['data']['id']
        for p in paths:
            upload_film(set_id, p)


def version_to_prepare(version):
    """The version being prepared, as it is, or a new one when there is none.
    Nothing is placed over a version Apple is looking at."""
    for v in versions():
        state = v['attributes']['appStoreState']
        if state in BUSY:
            raise SystemExit('version %s is %s; it cannot take anything until Apple is done'
                             % (v['attributes']['versionString'], state))
        if state in EDITABLE:
            log('version %s is being prepared, %s' % (v['attributes']['versionString'], state))
            return v['id']
    log('making version %s to hold them' % version)
    made = api('POST', '/v1/appStoreVersions', {'data': {
        'type': 'appStoreVersions',
        'attributes': {'platform': 'IOS', 'versionString': version, 'releaseType': 'AFTER_APPROVAL'},
        'relationships': {'app': {'data': {'type': 'apps', 'id': APP}}}}})
    return made['data']['id']


# ------------------------------------------------- the phone's screenshots

PHONE = 'APP_IPHONE_67'
PHONE_SIZES = {(1320, 2868), (2868, 1320), (1290, 2796), (2796, 1290)}


def phone_shots(folder):
    files = []
    for name in sorted(os.listdir(folder)):
        path = os.path.join(folder, name)
        if name.endswith('.png'):
            size = png_size(path)
            if size not in PHONE_SIZES:
                raise SystemExit('%s is %s, not a size the 6.9 inch set takes' % (name, size))
            files.append(path)
    if not files:
        raise SystemExit('no screenshots in %s' % folder)
    return files[:10]


def place_phone_shots(loc_id, sets, files):
    if PHONE in sets:
        log('replacing the 6.9 inch screenshots (%d were there)' % len(sets[PHONE][1]))
        api('DELETE', '/v1/appScreenshotSets/' + sets[PHONE][0])
    log('6.9 inch: %s' % ', '.join(os.path.basename(f) for f in files))
    set_id = new_set(loc_id, PHONE)
    for path in files:
        with open(path, 'rb') as f:
            upload(set_id, os.path.basename(path), f.read())


def status():
    """What is where, read and nothing changed."""
    vs = versions()
    for v in vs:
        at = v['attributes']
        log('version %s: %s (made %s)' % (at['versionString'], at['appStoreState'], (at.get('createdDate') or '')[:10]))
    for sub in api('GET', '/v1/reviewSubmissions?filter[app]=%s&filter[platform]=IOS&limit=5' % APP)['data']:
        at = sub['attributes']
        log('review submission %s: %s (sent %s)' % (sub['id'][:8], at.get('state'), (at.get('submittedDate') or '')[:16]))
    for v in vs[:2]:
        for loc in localizations(v['id']):
            sets = sets_of(loc['id'])
            films = preview_sets_of(loc['id'])
            log('  %s %s: %s; previews %s' % (
                v['attributes']['versionString'], loc['attributes']['locale'],
                ', '.join('%s %d' % (k, len(x[1])) for k, x in sorted(sets.items())) or 'no screenshots',
                ', '.join('%s %d' % (k, len(x[1])) for k, x in sorted(films.items())) or 'none'))


def withdraw():
    """The version waiting its turn, taken back from review so it can take
    screenshots; its id, to send it again after. Nothing is taken back from
    Apple once it has begun to look."""
    for v in versions():
        state = v['attributes']['appStoreState']
        if state == 'IN_REVIEW':
            raise SystemExit('version %s is in review now; it cannot be taken back, and the screenshots wait for the next one'
                             % v['attributes']['versionString'])
        if state != 'WAITING_FOR_REVIEW':
            continue
        subs = api('GET', '/v1/reviewSubmissions?filter[app]=%s&filter[platform]=IOS&filter[state]=WAITING_FOR_REVIEW'
                   % APP)['data']
        if not subs:
            raise SystemExit('version %s waits for review, but no submission was found to take back'
                             % v['attributes']['versionString'])
        log('taking version %s back from review' % v['attributes']['versionString'])
        api('PATCH', '/v1/reviewSubmissions/' + subs[0]['id'], {'data': {
            'type': 'reviewSubmissions', 'id': subs[0]['id'], 'attributes': {'canceled': True}}})
        if DRY:
            return v['id']
        for _ in range(60):
            now = api('GET', '/v1/appStoreVersions/' + v['id'])['data']['attributes']['appStoreState']
            if now in EDITABLE:
                log('version %s is %s, and can take screenshots' % (v['attributes']['versionString'], now))
                return v['id']
            time.sleep(10)
        raise SystemExit('the version did not come back from review in ten minutes')
    return None


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
    p.add_argument('--version')
    p.add_argument('--status', action='store_true', help='read the versions, the review and the sets, change nothing')
    p.add_argument('--shots', help='a folder of 6.9 inch screenshots to replace the set with, in the order of their names')
    p.add_argument('--shots-only', action='store_true', help='place --shots in the version being prepared and nothing else')
    p.add_argument('--withdraw', action='store_true',
                   help='with --shots-only: take a version waiting for review back, place the screenshots, send it again')
    p.add_argument('--build')
    p.add_argument('--duo')
    p.add_argument('--notes')
    p.add_argument('--text', help='the words of the page, a folder for each language: ios/store')
    p.add_argument('--previews', help='the folder of preview films, ios/previews')
    p.add_argument('--previews-only', action='store_true',
                   help='place the previews in the version being prepared and nothing else')
    p.add_argument('--wait', type=int, default=45, help='minutes to wait for Apple to process the build')
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--no-submit', action='store_true')
    a = p.parse_args()
    DRY = a.dry_run

    if a.status:
        status()
        return
    if not a.version:
        p.error('--version is needed')

    if a.shots_only:
        if not a.shots:
            p.error('--shots-only needs --shots')
        files = phone_shots(a.shots)
        taken_back = withdraw() if a.withdraw else None
        version_id = taken_back or version_to_prepare(a.version)
        reading = on_sale()['id'] if version_id == 'DRY-RUN' else version_id
        locs = localizations(reading)
        if not locs:
            raise SystemExit('the version has no languages yet to place the screenshots in')
        for loc in locs:
            place_phone_shots(loc['id'], sets_of(loc['id']), files)
        if taken_back and not DRY:
            send(taken_back)
            log('the screenshots are placed, and the version is waiting for review again')
            return
        log('the screenshots are placed; nothing was sent')
        return

    if a.previews_only:
        if not a.previews:
            p.error('--previews-only needs --previews')
        version_id = version_to_prepare(a.version)
        reading = on_sale()['id'] if version_id == 'DRY-RUN' else version_id
        locs = localizations(reading)
        if not locs:
            raise SystemExit('the version has no languages yet to place the films in')
        for loc in locs:
            carry_phone_shots(loc['id'], loc['attributes']['locale'], sets_of(loc['id']))
            place_previews(loc['id'], a.previews)
        log('the previews are placed; nothing was sent')
        return

    # a build run hands over the iPhone Duo pictures it took; a send of a
    # version already prepared has none, and leaves that set as it is
    if not (a.build and a.notes):
        p.error('--build and --notes are needed to send a build')
    notes = open(a.notes, encoding='utf-8').read().strip()
    if a.text:
        # read and measured before anything is sent, so a word too many stops it here
        for locale in sorted(os.listdir(a.text)):
            if os.path.isdir(os.path.join(a.text, locale)):
                store_text(a.text, locale)

    build_id = wait_for_build(a.version, a.build, a.wait)
    version_id = version_to_send(a.version)
    attach(version_id, build_id)
    write_notes(version_id, notes)
    if a.text:
        write_text(version_id, a.text)
    # a dry run that would make the version reads the one on sale instead
    reading = on_sale()['id'] if version_id == 'DRY-RUN' else version_id
    for loc in localizations(reading):
        locale = loc['attributes']['locale']
        sets = sets_of(loc['id'])
        if a.shots:
            place_phone_shots(loc['id'], sets, phone_shots(a.shots))
        else:
            carry_phone_shots(loc['id'], locale, sets)
        if a.duo:
            place_duo(loc['id'], sets_of(loc['id']), a.duo)
        if a.previews:
            place_previews(loc['id'], a.previews)
    if a.no_submit or DRY:
        log('left ready to send, not sent')
        return
    send(version_id)


if __name__ == '__main__':
    main()
