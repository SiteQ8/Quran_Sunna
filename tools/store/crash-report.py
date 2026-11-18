#!/usr/bin/env python3
"""What the phones report: the crashes and freezes of the app, from both stores.

Google Play (Play Developer Reporting API): every crash and ANR of the last
weeks, with how often, on how many devices, the last version it was seen in,
and for each a sample report with its stack and the device it came from. A
summary by device model tells whether one phone, a foldable say, stands out.

App Store Connect: Apple gives no crash logs through its API, only through
Xcode. What it does give is the diagnostics of recent builds (hangs, slow
launches, heavy disk writes) and the crashes TestFlight testers sent.

Writes a readable report to stdout and to the step summary when it runs in
a workflow, and the raw answers to crash-report.json beside it.

  PLAY_SERVICE_ACCOUNT  the service account json (as for play-upload.py)
  ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8  as for asc-release.py
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

PACKAGE = 'com.eworldq8.sunnati'
APPLE_ID = '6814355836'
REPORTING = 'https://playdeveloperreporting.googleapis.com/v1beta1/'
ASC = 'https://api.appstoreconnect.apple.com'
LINES = []
RAW = {}


def say(*parts):
    line = ' '.join(str(p) for p in parts)
    LINES.append(line)
    print(line, flush=True)


def get(url, headers, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method or ('POST' if data else 'GET'),
                                 headers=dict(headers, **({'Content-Type': 'application/json'} if data else {})))
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            text = r.read().decode()
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as e:
        return {'error': {'code': e.code, 'text': e.read().decode()[:600]}}


# ---------------- Google Play ----------------

def google_token(sa, scope):
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    def b64(raw):
        return base64.urlsafe_b64encode(raw).rstrip(b'=')

    now = int(time.time())
    claim = {'iss': sa['client_email'], 'scope': scope, 'aud': sa['token_uri'], 'iat': now, 'exp': now + 3600}
    head = b64(json.dumps({'alg': 'RS256', 'typ': 'JWT'}).encode())
    body = b64(json.dumps(claim).encode())
    key = serialization.load_pem_private_key(sa['private_key'].encode(), password=None)
    sig = b64(key.sign(head + b'.' + body, padding.PKCS1v15(), hashes.SHA256()))
    data = urllib.parse.urlencode({'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                                   'assertion': (head + b'.' + body + b'.' + sig).decode()}).encode()
    with urllib.request.urlopen(urllib.request.Request(sa['token_uri'], data=data)) as r:
        return json.load(r)['access_token']


def first_lines(text, n=14):
    keep = [l for l in (text or '').splitlines() if l.strip()]
    return '\n'.join(keep[:n])


def play(days):
    raw = os.environ.get('PLAY_SERVICE_ACCOUNT', '')
    if not raw:
        say('Google Play: no PLAY_SERVICE_ACCOUNT, skipped')
        return
    sa = json.loads(raw if raw.strip().startswith('{') else base64.b64decode(raw).decode())
    head = {'Authorization': 'Bearer ' + google_token(sa, 'https://www.googleapis.com/auth/playdeveloperreporting')}
    app = 'apps/' + PACKAGE
    say('## Google Play: crashes and ANRs')

    # how often, overall and by device
    end = time.gmtime(time.time() - 2 * 86400)
    start = time.gmtime(time.time() - (days + 2) * 86400)
    span = {'aggregationPeriod': 'DAILY',
            'startTime': {'year': start.tm_year, 'month': start.tm_mon, 'day': start.tm_mday, 'timeZone': {'id': 'America/Los_Angeles'}},
            'endTime': {'year': end.tm_year, 'month': end.tm_mon, 'day': end.tm_mday, 'timeZone': {'id': 'America/Los_Angeles'}}}
    for metric_set, metrics in (('crashRateMetricSet', ['crashRate', 'userPerceivedCrashRate', 'distinctUsers']),
                                ('anrRateMetricSet', ['anrRate', 'userPerceivedAnrRate', 'distinctUsers'])):
        rates = get(REPORTING + app + '/' + metric_set + ':query', head,
                    {'timelineSpec': span, 'metrics': metrics, 'dimensions': ['deviceModel'], 'pageSize': 1000})
        RAW[metric_set] = rates
        if 'error' in rates:
            say('  %s: refused %s %s' % (metric_set, rates['error']['code'], rates['error']['text'][:300]))
            continue
        by_model = {}
        for row in rates.get('rows', []):
            model = next((d.get('stringValue') for d in row.get('dimensions', []) if d.get('dimension') == 'deviceModel'), '?')
            vals = {m['metric']: float(m.get('decimalValue', {}).get('value', 0) or 0) for m in row.get('metrics', [])}
            agg = by_model.setdefault(model, {'days': 0, 'users': 0.0, 'rate': 0.0})
            agg['days'] += 1
            agg['users'] += vals.get('distinctUsers', 0)
            agg['rate'] = max(agg['rate'], vals.get(metrics[0], 0))
        bad = sorted(((m, a) for m, a in by_model.items() if a['rate'] > 0), key=lambda x: -x[1]['rate'])
        say('  %s over %d days: %d device models, %d with any' % (metric_set.replace('MetricSet', ''), days, len(by_model), len(bad)))
        for model, a in bad[:15]:
            say('    %-40s worst day %.2f%%  (%d user-days)' % (model, a['rate'] * 100, a['users']))
        folds = [m for m in by_model if any(k in m.lower() for k in ('fold', 'flip', 'q2q', 'q5q', 'q6q', 'f9', 'sm-f'))]
        if folds:
            say('    foldables seen: ' + ', '.join(sorted(folds)))

    # every distinct problem, with a sample of each
    issues = get(REPORTING + app + '/errorIssues:search?pageSize=50', head)
    RAW['errorIssues'] = issues
    if 'error' in issues:
        say('  errorIssues: refused %s %s' % (issues['error']['code'], issues['error']['text'][:300]))
        return
    found = issues.get('errorIssues', [])
    say('  %d distinct issues' % len(found))
    for i, issue in enumerate(found):
        say('\n  [%d] %s %s' % (i + 1, issue.get('type'), issue.get('cause', '')[:160]))
        say('      where: %s' % issue.get('location', '')[:200])
        say('      reports %s, users %s, versions %s to %s' % (
            issue.get('errorReportCount'), issue.get('distinctUsers'),
            (issue.get('firstAppVersion') or {}).get('versionCode'), (issue.get('lastAppVersion') or {}).get('versionCode')))
        q = urllib.parse.quote('errorIssueId = ' + issue['name'].split('/')[-1])
        reports = get(REPORTING + app + '/errorReports:search?pageSize=5&filter=' + q, head)
        RAW.setdefault('errorReports', {})[issue['name']] = reports
        for r in reports.get('errorReports', [])[:2]:
            dev = r.get('deviceModel') or {}
            say('      device: %s (%s), android %s, version %s' % (
                dev.get('marketingName'), dev.get('deviceId', {}).get('buildDevice', ''),
                (r.get('osVersion') or {}).get('apiLevel'), (r.get('appVersion') or {}).get('versionCode')))
            say('      ' + first_lines(r.get('reportText')).replace('\n', '\n      '))


# ---------------- App Store Connect ----------------

def apple():
    if not os.environ.get('ASC_KEY_P8'):
        say('App Store Connect: no ASC key, skipped')
        return
    import jwt
    now = int(time.time())
    tok = jwt.encode({'iss': os.environ['ASC_ISSUER_ID'], 'iat': now, 'exp': now + 1100, 'aud': 'appstoreconnect-v1'},
                     base64.b64decode(os.environ['ASC_KEY_P8']).decode(), algorithm='ES256',
                     headers={'kid': os.environ['ASC_KEY_ID'], 'typ': 'JWT'})
    head = {'Authorization': 'Bearer ' + tok}
    say('\n## App Store Connect: diagnostics and TestFlight crashes')
    builds = get(ASC + '/v1/builds?filter[app]=%s&sort=-uploadedDate&limit=6' % APPLE_ID, head)
    RAW['builds'] = builds
    if 'error' in builds:
        say('  builds: refused %s %s' % (builds['error']['code'], builds['error']['text'][:300]))
        return
    for b in builds.get('data', []):
        at = b['attributes']
        sigs = get(ASC + '/v1/builds/%s/diagnosticSignatures?limit=20' % b['id'], head)
        RAW.setdefault('diagnostics', {})[at.get('version')] = sigs
        items = sigs.get('data', []) if 'error' not in sigs else []
        say('  build %s (%s): %s' % (at.get('version'), (at.get('uploadedDate') or '')[:10],
                                      'no diagnostics' if not items else '%d diagnostic signatures' % len(items)))
        for s in items[:8]:
            a = s['attributes']
            say('    %s weight %.2f: %s' % (a.get('diagnosticType'), float(a.get('weight') or 0), (a.get('signature') or '')[:180]))
    crashes = get(ASC + '/v1/apps/%s/betaFeedbackCrashSubmissions?limit=20' % APPLE_ID, head)
    RAW['betaCrashes'] = crashes
    if 'error' in crashes:
        say('  TestFlight crashes: not available (%s)' % crashes['error']['code'])
    else:
        items = crashes.get('data', [])
        say('  TestFlight crashes sent by testers: %d' % len(items))
        for c in items[:10]:
            a = c['attributes']
            say('    %s %s iOS %s build %s: %s' % ((a.get('createdDate') or '')[:10], a.get('deviceModel'), a.get('osVersion'),
                                                  a.get('buildBundleId') or '', (a.get('comment') or '')[:120]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=int, default=28)
    ap.add_argument('--which', default='both', choices=['both', 'android', 'ios'])
    args = ap.parse_args()
    if args.which in ('both', 'android'):
        play(args.days)
    if args.which in ('both', 'ios'):
        apple()
    with open('crash-report.json', 'w') as f:
        json.dump(RAW, f, ensure_ascii=False, indent=1)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as f:
            f.write('```\n' + '\n'.join(LINES) + '\n```\n')


if __name__ == '__main__':
    sys.exit(main())
