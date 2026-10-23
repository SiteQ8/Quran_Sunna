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

Every language is written to its own page. A folder of ios/store whose
language has no page in the version yet is given one, with the support and
marketing links of the app's own language, and its name.txt and subtitle.txt
go to the app's information in that language, which Apple keeps apart from
the version and takes only while one is being prepared; a language new there
takes the privacy policy link of the app's own language. A page that is there
without the support link, as Apple makes one by itself when a language is
first named in the app's information, is given the links too, before anything
slow is done, since Apple sends no version for review while one of its pages
lacks it. What is new is read
for each language from its own file beside --notes, ios/whatsnew/en-US.txt,
and a language with no file of its own is given --notes, as every language
was before; a page made by this run must have its own.

The pictures of a language are kept beside the ones given, under its code:
ios/screenshots/en-US/6.9-inch beside --shots ios/screenshots/6.9-inch, and
ios/screenshots/en-US/ipad-13 beside --ipad. A language with a folder of its
own takes it, and any other takes the folder given, as every language did
before. The preview films of --previews and the iPhone Duo pictures a build
run took are in the app's own language, so they go to its page alone, and
another language takes films only from a folder of its own, ios/previews/<code>.
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
        raise SystemExit('%s %s failed with %s: %s' % (method, path, e.code, refusal(e.read().decode())))


def refusal(text):
    """What Apple refused, each error and each one under it on a line of its
    own, so that none is cut off; the body as it came when it is not Apple's."""
    try:
        lines = []
        for err in json.loads(text)['errors']:
            lines.append('%s: %s' % (err.get('code'), err.get('detail') or err.get('title')))
            for where, under in sorted(((err.get('meta') or {}).get('associatedErrors') or {}).items()):
                for sub in under:
                    lines.append('  %s %s: %s' % (where, (sub.get('source') or {}).get('pointer') or '',
                                                   sub.get('detail') or sub.get('title')))
        return '\n'.join(lines)
    except (ValueError, KeyError, TypeError, AttributeError):
        return text[:1500]


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


def write_notes(version_id, notes_for):
    for loc in localizations(version_id):
        locale = loc['attributes']['locale']
        log('what is new, %s' % locale)
        api('PATCH', '/v1/appStoreVersionLocalizations/' + loc['id'], {'data': {
            'type': 'appStoreVersionLocalizations', 'id': loc['id'], 'attributes': {'whatsNew': notes_for(locale)}}})


def own_notes(path, notes):
    """What is new for a language: its own file beside the one given,
    ios/whatsnew/en-US.txt, or the one given when it has none."""
    here = os.path.dirname(path) or '.'

    def notes_for(locale):
        mine = os.path.join(here, locale + '.txt')
        return open(mine, encoding='utf-8').read().strip() if os.path.isfile(mine) else notes
    return notes_for


def own(folder, locale):
    """A language's own pictures, kept beside the folder given under its code:
    ios/screenshots/en-US/6.9-inch beside ios/screenshots/6.9-inch. None when it
    has none, and it takes the folder given."""
    if not folder:
        return None
    folder = os.path.normpath(folder)
    mine = os.path.join(os.path.dirname(folder), locale, os.path.basename(folder))
    return mine if os.path.isdir(mine) else None


def own_sets(folder, read):
    """Every language's own pictures beside the folder given, each read as the
    folder given is, so a wrong size stops the run before anything is sent."""
    if not folder:
        return {}
    folder = os.path.normpath(folder)
    root, kind = os.path.dirname(folder), os.path.basename(folder)
    out = {}
    for name in sorted(os.listdir(root or '.')):
        here = os.path.join(root, name, kind)
        if os.path.isdir(here):
            out[name] = read(here)
    return out


def films_for(folder, locale, home):
    """The films of --previews are of the app in its own language, and go to
    its page alone; another language takes films only from ios/previews/<code>,
    so no page opens on a film in a language not its own."""
    mine = os.path.join(folder, locale)
    if os.path.isdir(mine):
        return mine
    return folder if locale == home else None


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


# The name and the subtitle belong to the app's information, not the version:
# thirty characters each, and a language new to the store needs its name.
NAME_FIELDS = (('name.txt', 'name', 30), ('subtitle.txt', 'subtitle', 30))
APP_INFO_EDITABLE = {'PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW', 'DEVELOPER_REJECTED',
                     'REJECTED', 'METADATA_REJECTED'}


def app_info_text(folder, locale):
    here = os.path.join(folder, locale)
    words = {}
    for name, field, limit in NAME_FIELDS:
        path = os.path.join(here, name)
        if not os.path.isfile(path):
            continue
        text = open(path, encoding='utf-8').read().strip()
        if len(text) > limit:
            raise SystemExit('%s is %d characters, and Apple takes %d' % (path, len(text), limit))
        if 'ﷺ' in text:
            raise SystemExit('%s has the sign of the salutation, which Apple refuses: write it out' % path)
        words[field] = text
    return words


def languages_in(folder):
    """The languages the folder has words for, by the code Apple gives them."""
    return sorted(n for n in os.listdir(folder) if os.path.isdir(os.path.join(folder, n))
                  and any(os.path.isfile(os.path.join(folder, n, f))
                          for f, _, _ in TEXT_FIELDS + NAME_FIELDS))


_HOME = []


def home_locale():
    """The app's own language on the store, Arabic: the films and the iPhone
    Duo pictures are of the app in it."""
    if not _HOME:
        _HOME.append(api('GET', '/v1/apps/%s' % APP)['data']['attributes'].get('primaryLocale') or 'ar-SA')
    return _HOME[0]


def add_languages(version_id, folder):
    """A language with its own words in the repository and no page in this
    version is given one, with the support and marketing links of the app's
    own language; its words, what is new and its pictures follow."""
    reading = on_sale()['id'] if version_id == 'DRY-RUN' else version_id
    have = {loc['attributes']['locale']: loc for loc in localizations(reading)}
    home = have.get(home_locale()) or next(iter(have.values()), None)
    links = {k: home['attributes'][k] for k in ('supportUrl', 'marketingUrl')
             if home and home['attributes'].get(k)}
    for locale in languages_in(folder):
        if locale in have:
            continue
        log('a page in %s is made for this version' % locale)
        api('POST', '/v1/appStoreVersionLocalizations', {'data': {
            'type': 'appStoreVersionLocalizations', 'attributes': dict(links, locale=locale),
            'relationships': {'appStoreVersion': {'data': {'type': 'appStoreVersions', 'id': version_id}}}}})


LINKS = ('supportUrl', 'marketingUrl')


def give_links(version_id):
    """Every page of the version with the support link, without which Apple
    sends nothing for review, and the marketing link where the app has one. A
    page Apple made by itself, when its language was first named in the app's
    information, comes without them, and add_languages finds it there and
    leaves it; it takes them from the app's own language in this version, or
    else from the version on sale, its own language there first. A page still
    without a support link stops the run here, before the pictures."""
    sale = on_sale()
    reading = sale['id'] if version_id == 'DRY-RUN' and sale else version_id
    pages = localizations(reading)
    if not pages:
        return
    home = home_locale()
    mine = {loc['attributes']['locale']: loc['attributes'] for loc in pages}
    sold = {} if not sale or sale['id'] == reading else {
        loc['attributes']['locale']: loc['attributes'] for loc in localizations(sale['id'])}
    bare = []
    for loc in pages:
        at = loc['attributes']
        give = {}
        for k in LINKS:
            if at.get(k):
                continue
            for there in (mine.get(home), sold.get(at['locale']), sold.get(home)):
                if there and there.get(k):
                    give[k] = there[k]
                    break
        if give:
            log('the links of %s: %s' % (at['locale'], ', '.join('%s %s' % kv for kv in sorted(give.items()))))
            api('PATCH', '/v1/appStoreVersionLocalizations/' + loc['id'], {'data': {
                'type': 'appStoreVersionLocalizations', 'id': loc['id'], 'attributes': give}})
        if not (at.get('supportUrl') or give.get('supportUrl')):
            bare.append(at['locale'])
    if bare:
        raise SystemExit('no support link was found for %s, and Apple sends no version for review without one'
                         % ', '.join(sorted(bare)))


def app_info_to_edit():
    for info in api('GET', '/v1/apps/%s/appInfos' % APP)['data']:
        at = info['attributes']
        if (at.get('state') or at.get('appStoreState')) in APP_INFO_EDITABLE:
            return info['id']
    return None


def write_names(folder):
    """The name and the subtitle of each language that has them in the
    repository, written where they differ and made where the language is new;
    a language without them keeps what the store has."""
    wanted = {}
    for locale in languages_in(folder):
        words = app_info_text(folder, locale)
        if words:
            wanted[locale] = words
    if not wanted:
        return
    info = app_info_to_edit()
    if not info:
        log('no app information is being prepared, so the names and subtitles wait for the next version')
        return
    there = {x['attributes']['locale']: x for x in
             api('GET', '/v1/appInfos/%s/appInfoLocalizations?limit=50' % info)['data']}
    home = there.get(home_locale()) or next(iter(there.values()), None)
    policy = {k: home['attributes'][k] for k in ('privacyPolicyUrl', 'privacyChoicesUrl')
              if home and home['attributes'].get(k)}
    for locale, words in sorted(wanted.items()):
        mine = there.get(locale)
        if mine:
            change = {k: v for k, v in words.items() if mine['attributes'].get(k) != v}
            if not change:
                log('the name in %s is as it was' % locale)
                continue
            log('the name in %s: %s' % (locale, ', '.join('%s %s' % kv for kv in sorted(change.items()))))
            api('PATCH', '/v1/appInfoLocalizations/' + mine['id'], {'data': {
                'type': 'appInfoLocalizations', 'id': mine['id'], 'attributes': change}})
            continue
        if 'name' not in words:
            raise SystemExit('%s is new to the store and has no name.txt' % os.path.join(folder, locale))
        log('the name in %s, new: %s | %s' % (locale, words['name'], words.get('subtitle', '')))
        api('POST', '/v1/appInfoLocalizations', {'data': {
            'type': 'appInfoLocalizations', 'attributes': dict(policy, locale=locale, **words),
            'relationships': {'appInfo': {'data': {'type': 'appInfos', 'id': info}}}}})


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
    # Apple's queue for pictures is sometimes slow: a Russian home screen sat
    # unread for five minutes on 22 October and the whole send stopped there,
    # with three languages done and six to go. Fifteen minutes, then.
    for _ in range(180):
        state = api('GET', '/v1/appScreenshots/' + shot['id'])['data']['attributes'].get('assetDeliveryState') or {}
        if state.get('state') == 'COMPLETE':
            return
        if state.get('state') == 'FAILED':
            raise SystemExit('Apple refused %s: %s' % (name, json.dumps(state.get('errors'), ensure_ascii=False)))
        time.sleep(5)
    raise SystemExit('%s was not accepted in fifteen minutes' % name)


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
    """The set replaced whole, unless it holds these very pictures already."""
    sums = []
    for path in files:
        with open(path, 'rb') as f:
            sums.append(hashlib.md5(f.read()).hexdigest())
    if PHONE in sets:
        if [s['attributes'].get('sourceFileChecksum') for s in sets[PHONE][1]] == sums:
            log('the 6.9 inch screenshots are there already (%d)' % len(sums))
            return
        log('replacing the 6.9 inch screenshots (%d were there)' % len(sets[PHONE][1]))
        api('DELETE', '/v1/appScreenshotSets/' + sets[PHONE][0])
    log('6.9 inch from %s: %s' % (os.path.dirname(files[0]), ', '.join(os.path.basename(f) for f in files)))
    set_id = new_set(loc_id, PHONE)
    for path in files:
        with open(path, 'rb') as f:
            upload(set_id, os.path.basename(path), f.read())


# ------------------------------------------------------- the iPad's screenshots

# The 13 inch iPad is the one size Apple asks for once an app runs on iPad, and
# it shrinks the set for every smaller iPad. On its side or upright.
IPAD = 'APP_IPAD_PRO_3GEN_129'
IPAD_SIZES = {(2064, 2752), (2752, 2064), (2048, 2732), (2732, 2048)}


def ipad_shots(folder):
    files = []
    for name in sorted(os.listdir(folder)):
        path = os.path.join(folder, name)
        if name.endswith('.png'):
            size = png_size(path)
            if size not in IPAD_SIZES:
                raise SystemExit('%s is %s, not a size the 13 inch iPad set takes' % (name, size))
            files.append(path)
    if not files:
        raise SystemExit('no iPad screenshots in %s' % folder)
    return files[:10]


def place_ipad_shots(loc_id, sets, files):
    """The set replaced whole, unless it holds these very pictures already: a
    version prepared and then sent places them once, not twice."""
    sums = []
    for path in files:
        with open(path, 'rb') as f:
            sums.append(hashlib.md5(f.read()).hexdigest())
    if IPAD in sets:
        there = [s['attributes'].get('sourceFileChecksum') for s in sets[IPAD][1]]
        if there == sums:
            log('the 13 inch iPad screenshots are there already (%d)' % len(sums))
            return
        log('replacing the 13 inch iPad screenshots (%d were there)' % len(sets[IPAD][1]))
        api('DELETE', '/v1/appScreenshotSets/' + sets[IPAD][0])
    log('13 inch iPad from %s: %s' % (os.path.dirname(files[0]), ', '.join(os.path.basename(f) for f in files)))
    set_id = new_set(loc_id, IPAD)
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
    p.add_argument('--ipad', help='a folder of 13 inch iPad screenshots to replace that set with: ios/screenshots/ipad-13')
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
    p.add_argument('--replace', action='store_true',
                   help='a version waiting for review is taken back first, and this build sent in its place')
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
        pads = ipad_shots(a.ipad) if a.ipad else []
        # each language's own, read before anything is taken back or placed
        mine, my_pads = own_sets(a.shots, phone_shots), own_sets(a.ipad, ipad_shots)
        taken_back = withdraw() if a.withdraw else None
        version_id = taken_back or version_to_prepare(a.version)
        reading = on_sale()['id'] if version_id == 'DRY-RUN' else version_id
        locs = localizations(reading)
        if not locs:
            raise SystemExit('the version has no languages yet to place the screenshots in')
        for loc in locs:
            locale = loc['attributes']['locale']
            log('the pictures of %s' % locale)
            place_phone_shots(loc['id'], sets_of(loc['id']), mine.get(locale, files))
            if pads:
                place_ipad_shots(loc['id'], sets_of(loc['id']), my_pads.get(locale, pads))
        for locale in sorted(set(mine) - {loc['attributes']['locale'] for loc in locs}):
            log('%s has pictures in the repository and no page in this version yet; a version sent with --text makes it'
                % locale)
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
        home = home_locale()
        for loc in locs:
            locale = loc['attributes']['locale']
            films = films_for(a.previews, locale, home)
            if not films:
                log('%s has no films of its own, and those of %s are not put on its page' % (locale, home))
                continue
            carry_phone_shots(loc['id'], locale, sets_of(loc['id']))
            place_previews(loc['id'], films)
        log('the previews are placed; nothing was sent')
        return

    # a build run hands over the iPhone Duo pictures it took; a send of a
    # version already prepared has none, and leaves that set as it is
    if not (a.build and a.notes):
        p.error('--build and --notes are needed to send a build')
    notes = open(a.notes, encoding='utf-8').read().strip()
    pads = ipad_shots(a.ipad) if a.ipad else []
    notes_for = own_notes(a.notes, notes)
    # each language's own pictures, read and measured here with the rest
    mine = own_sets(a.shots, phone_shots) if a.shots else {}
    my_pads = own_sets(a.ipad, ipad_shots)
    if a.text:
        # read and measured before anything is sent, so a word too many stops it here
        for locale in sorted(os.listdir(a.text)):
            if os.path.isdir(os.path.join(a.text, locale)):
                store_text(a.text, locale)
                app_info_text(a.text, locale)
                # a page this run may make needs what is new in its own words
                given = os.path.splitext(os.path.basename(a.notes))[0]
                if locale != given and not os.path.isfile(os.path.join(os.path.dirname(a.notes), locale + '.txt')):
                    raise SystemExit('%s has no %s.txt beside %s, and its page would be given the words of another language'
                                     % (os.path.join(a.text, locale), locale, a.notes))
                if len(notes_for(locale)) > 4000:
                    raise SystemExit('what is new in %s is longer than the four thousand Apple takes' % locale)

    build_id = wait_for_build(a.version, a.build, a.wait)
    # the build is there before anything is taken back, so a version is never
    # pulled from review for a build Apple has not finished with
    if a.replace and not DRY:
        withdraw()
    version_id = version_to_send(a.version)
    attach(version_id, build_id)
    if a.text:
        # the names first, so a name Apple refuses stops the run before the rest
        write_names(a.text)
        add_languages(version_id, a.text)
    # every page with its links before the pictures, so a page Apple would
    # refuse stops the run in a minute and not after them
    give_links(version_id)
    write_notes(version_id, notes_for)
    if a.text:
        write_text(version_id, a.text)
    # a dry run that would make the version reads the one on sale instead
    reading = on_sale()['id'] if version_id == 'DRY-RUN' else version_id
    home = home_locale()
    placed = set()
    for loc in localizations(reading):
        locale = loc['attributes']['locale']
        placed.add(locale)
        log('the pictures of %s' % locale)
        sets = sets_of(loc['id'])
        if a.shots:
            place_phone_shots(loc['id'], sets, mine.get(locale) or phone_shots(a.shots))
        else:
            carry_phone_shots(loc['id'], locale, sets)
        # the pictures a build run took are of the app in its own language
        if a.duo and locale == home:
            place_duo(loc['id'], sets_of(loc['id']), a.duo)
        if pads:
            place_ipad_shots(loc['id'], sets_of(loc['id']), my_pads.get(locale, pads))
        films = films_for(a.previews, locale, home) if a.previews else None
        if films:
            place_previews(loc['id'], films)
    if DRY:
        for locale in sorted((set(mine) | set(my_pads)) - placed):
            log('  [dry run] %s: its page would take %d phone and %d iPad pictures of its own'
                % (locale, len(mine.get(locale, [])), len(my_pads.get(locale, []))))
    if a.no_submit or DRY:
        log('left ready to send, not sent')
        return
    send(version_id)


if __name__ == '__main__':
    main()
