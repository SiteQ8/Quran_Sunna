#!/usr/bin/env python3
"""يضع أسرار توقيع iOS وأندرويد في مستودع GitHub، مشفّرةً كما تطلبها واجهته.

الاستعمال:
    GITHUB_TOKEN=... python3 tools/ios/set-secrets.py \
        --team-id XXXXXXXXXX \
        --p12 sunnati.p12 --p12-password '...' \
        --profile Sunnati.mobileprovision \
        --profile-widget SunnatiWidget.mobileprovision \
        --asc-key-id XXXXXXXXXX --asc-issuer-id '....-....' --asc-p8 AuthKey_XXXXXXXXXX.p8

أو من الشهادة والمفتاح مباشرة، فيصنع الـp12 بنفسه:
        --cer distribution.cer --key sunnati.key --p12-password '...'

ولأندرويد، مفتاح الرفع الذي يعرفه Play:
        --keystore sunnati-upload.keystore --keystore-password '...' \
        --key-alias sunnati --key-password '...'

كل ملفّ يُقرأ ويُشفَّر ويُرسل، ولا يُكتب في أيّ مكان. الأسرار التي لم تُعطَ
تُترك كما هي في المستودع.
"""
import argparse, base64, json, os, subprocess, sys, tempfile, urllib.request

REPO = 'SiteQ8/Quran_Sunna'
API = 'https://api.github.com'


def call(method, path, token, body=None):
    req = urllib.request.Request(API + path, method=method,
        headers={'Authorization': 'token ' + token, 'Accept': 'application/vnd.github+json',
                 'Content-Type': 'application/json'},
        data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def seal(public_key_b64, value):
    from nacl import encoding, public
    key = public.PublicKey(public_key_b64.encode('utf-8'), encoding.Base64Encoder())
    box = public.SealedBox(key)
    return base64.b64encode(box.encrypt(value.encode('utf-8'))).decode('utf-8')


def b64file(path):
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('ascii')


def make_p12(cer, key, password):
    """يجمع الشهادة التي نزلت من أبل مع المفتاح الخاصّ في ملفّ p12."""
    tmp = tempfile.mkdtemp()
    pem = os.path.join(tmp, 'cert.pem')
    p12 = os.path.join(tmp, 'sunnati.p12')
    subprocess.run(['openssl', 'x509', '-in', cer, '-inform', 'DER', '-out', pem, '-outform', 'PEM'], check=True)
    subprocess.run(['openssl', 'pkcs12', '-export', '-inkey', key, '-in', pem, '-out', p12,
                    '-passout', 'pass:' + password, '-legacy'], check=False)
    if not os.path.exists(p12):
        subprocess.run(['openssl', 'pkcs12', '-export', '-inkey', key, '-in', pem, '-out', p12,
                        '-passout', 'pass:' + password], check=True)
    return p12


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--team-id')
    ap.add_argument('--p12')
    ap.add_argument('--cer')
    ap.add_argument('--key')
    ap.add_argument('--p12-password')
    ap.add_argument('--profile')
    ap.add_argument('--profile-widget')
    ap.add_argument('--asc-key-id')
    ap.add_argument('--asc-issuer-id')
    ap.add_argument('--asc-p8')
    ap.add_argument('--keystore')
    ap.add_argument('--keystore-password')
    ap.add_argument('--key-alias')
    ap.add_argument('--key-password')
    a = ap.parse_args()

    token = os.environ.get('GITHUB_TOKEN')
    if not token:
        sys.exit('GITHUB_TOKEN غير موجود في البيئة')

    if a.cer and a.key:
        if not a.p12_password:
            sys.exit('--p12-password مطلوبة مع --cer و--key')
        a.p12 = make_p12(a.cer, a.key, a.p12_password)
        print('صُنع p12 من الشهادة والمفتاح')

    secrets = {}
    if a.team_id: secrets['IOS_TEAM_ID'] = a.team_id
    if a.p12: secrets['IOS_CERT_P12'] = b64file(a.p12)
    if a.p12_password: secrets['IOS_CERT_PASSWORD'] = a.p12_password
    if a.profile: secrets['IOS_PROFILE'] = b64file(a.profile)
    if a.profile_widget: secrets['IOS_PROFILE_WIDGET'] = b64file(a.profile_widget)
    if a.asc_key_id: secrets['ASC_KEY_ID'] = a.asc_key_id
    if a.asc_issuer_id: secrets['ASC_ISSUER_ID'] = a.asc_issuer_id
    if a.asc_p8: secrets['ASC_KEY_P8'] = b64file(a.asc_p8)
    if a.keystore: secrets['ANDROID_KEYSTORE'] = b64file(a.keystore)
    if a.keystore_password: secrets['ANDROID_KEYSTORE_PASSWORD'] = a.keystore_password
    if a.key_alias: secrets['ANDROID_KEY_ALIAS'] = a.key_alias
    if a.key_password: secrets['ANDROID_KEY_PASSWORD'] = a.key_password
    if not secrets:
        sys.exit('لم يُعطَ أيّ سرّ')

    pk = call('GET', f'/repos/{REPO}/actions/secrets/public-key', token)
    for name, value in secrets.items():
        call('PUT', f'/repos/{REPO}/actions/secrets/{name}', token,
             {'encrypted_value': seal(pk['key'], value), 'key_id': pk['key_id']})
        print('وُضع', name)

    have = {s['name'] for s in call('GET', f'/repos/{REPO}/actions/secrets', token).get('secrets', [])}
    ios = ['IOS_TEAM_ID', 'IOS_CERT_P12', 'IOS_CERT_PASSWORD', 'IOS_PROFILE', 'IOS_PROFILE_WIDGET',
           'ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_P8']
    android = ['ANDROID_KEYSTORE', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']
    for label, need in (('iOS', ios), ('أندرويد', android)):
        missing = [n for n in need if n not in have]
        print(label, 'الناقص:', ', '.join(missing) if missing else 'لا شيء، الورك فلو يوقّع')


if __name__ == '__main__':
    main()
