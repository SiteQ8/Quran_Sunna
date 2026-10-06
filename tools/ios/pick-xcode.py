#!/usr/bin/env python3
"""Which Xcode an iOS build should use, and on which of GitHub's macs.

    pick-xcode.py [want]          prints two lines: the Xcode version, the runner
    pick-xcode.py --release-only  prints the newest release Xcode from 27.1 on, or
                                  nothing if GitHub has none yet

`want` is what a run asked for: a version such as 26 or 27.1, or `auto`. Auto
is the newest Xcode from 27.1 on that GitHub carries as a release or release
candidate, the first that builds for iPhone Duo; until there is one, 26, which
App Store Connect takes today.

GitHub keys its mac images to a major Xcode now: 27 lives on the image named
xcode-27, never on macos-26. What that image carries is read from the page
GitHub publishes with each of its releases, the table of Xcodes on it, and a
name is not trusted to say what an Xcode is: Xcode_27.1.app was a link to a
beta. A beta is never picked here, since App Store Connect refuses its builds.

Anything that cannot be read leaves the answer at 26: a build that runs on the
Xcode the store already takes is never worse than one that does not run.
"""

import json
import os
import re
import sys
import urllib.request

FIRST_DUO = (27, 1)
IMAGE = 'xcode-27-arm64'


def fetch(url):
    headers = {'User-Agent': 'sunnati-pick-xcode'}
    token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
    if token and 'api.github.com' in url:
        headers['Authorization'] = 'Bearer ' + token
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as r:
        return r.read().decode('utf-8', 'replace')


def readme_urls():
    """The software page of the newest release of the image, then the one on
    main, which can run ahead of what the machines have but never far."""
    urls = []
    try:
        releases = json.loads(fetch('https://api.github.com/repos/actions/runner-images/releases?per_page=40'))
        for rel in releases:
            if not rel.get('tag_name', '').startswith(IMAGE + '/'):
                continue
            m = re.search(r'blob/(releases/' + re.escape(IMAGE) + r'/[^/]+)/images/macos/' + re.escape(IMAGE) + r'-Readme\.md',
                          rel.get('body') or '')
            if m:
                urls.append('https://raw.githubusercontent.com/actions/runner-images/%s/images/macos/%s-Readme.md'
                            % (m.group(1), IMAGE))
            break
    except Exception as e:  # noqa: BLE001, a page that cannot be read is no answer
        print('releases unreadable: %s' % e, file=sys.stderr)
    urls.append('https://raw.githubusercontent.com/actions/runner-images/main/images/macos/%s-Readme.md' % IMAGE)
    return urls


def release_xcodes(readme):
    """(version, path) of every Xcode on the page that is not a beta."""
    out = []
    for line in readme.splitlines():
        m = re.match(r'\s*\|\s*(\d+\.\d+(?:\.\d+)?)[^|]*\|\s*([0-9A-Za-z]+)\s*\|\s*(/Applications/[^|\s<]+)', line)
        if m and 'beta' not in m.group(3).lower():
            out.append((m.group(1), m.group(3)))
    return out


def as_tuple(v):
    return tuple(int(x) for x in v.split('.'))


def newest_duo_xcode(readme):
    found = [v for v, _ in release_xcodes(readme) if as_tuple(v)[:2] >= FIRST_DUO]
    return max(found, key=as_tuple) if found else ''


def available():
    for url in readme_urls():
        try:
            v = newest_duo_xcode(fetch(url))
        except Exception as e:  # noqa: BLE001
            print('%s unreadable: %s' % (url, e), file=sys.stderr)
            continue
        print('%s: %s' % (url, v or 'no release Xcode from 27.1 on'), file=sys.stderr)
        return v
    return ''


def runner_for(version):
    return 'xcode-27' if version.split('.')[0] == '27' else 'macos-26'


def main(argv):
    if '--release-only' in argv:
        print(available())
        return
    want = (argv[0] if argv else '').strip() or 'auto'
    version = (available() or '26') if want == 'auto' else want
    print(version)
    print(runner_for(version))


if __name__ == '__main__':
    main(sys.argv[1:])
