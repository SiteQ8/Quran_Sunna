/* The shipped mushaf is the one thing in this repository that must never drift.
   tools/verify-mushaf.js holds the checks, and this runs them with the suite so
   a bad text cannot pass unnoticed. */
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'verify-mushaf.js');
const payload = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'data', 'mushaf.json'), 'utf8'));

test('the mushaf passes every check in the audit', () => {
  let output = '';
  try {
    output = execFileSync(process.execPath, [TOOL], { encoding: 'utf8', cwd: ROOT });
  } catch (err) {
    assert.fail('the audit reported a problem:\n' + (err.stdout || err.message));
  }
  assert.match(output, /all \d+ checks passed/);
  const count = +/all (\d+) checks passed/.exec(output)[1];
  assert.ok(count >= 180, 'the audit should be thorough, it ran only ' + count + ' checks');
});

test('the text has not moved since it was compared verse by verse', () => {
  const tool = fs.readFileSync(TOOL, 'utf8');
  const known = /KNOWN_DIGEST = '([0-9a-f]{64})'/.exec(tool);
  assert.ok(known, 'the audit must carry the digest of the verified text');
  const digest = crypto.createHash('sha256')
    .update(payload.a.map((s) => s.join('\n')).join('\n'), 'utf8')
    .digest('hex');
  assert.strictEqual(digest, known[1],
    'the mushaf text changed, which needs a fresh comparison against an outside copy');
});

test('the audit refuses a text that has been tampered with', () => {
  /* Proves the audit can actually fail, because a check that never fails is
     worth nothing. A single letter is dropped from one verse in a copy. */
  const copy = JSON.parse(JSON.stringify(payload));
  copy.a[111][0] = copy.a[111][0].slice(1);
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mushaf-'));
  fs.mkdirSync(path.join(dir, 'docs', 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'data', 'mushaf.json'), JSON.stringify(copy));
  fs.copyFileSync(TOOL, path.join(dir, 'tools', 'verify-mushaf.js'));

  let failed = false;
  try {
    execFileSync(process.execPath, [path.join(dir, 'tools', 'verify-mushaf.js')], { encoding: 'utf8' });
  } catch (err) {
    failed = true;
    assert.match(String(err.stdout), /FAILED/);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(failed, 'a changed verse must be caught');
});

test('no surah is missing, short or doubled', () => {
  assert.strictEqual(payload.a.length, 114);
  const total = payload.a.reduce((n, s) => n + s.length, 0);
  assert.strictEqual(total, 6236);
  payload.a.forEach(function (verses, i) {
    assert.ok(verses.length > 0, 'surah ' + (i + 1) + ' is empty');
    verses.forEach(function (v, a) {
      assert.strictEqual(typeof v, 'string', (i + 1) + ':' + (a + 1) + ' is not text');
      assert.ok(v.trim().length > 1, (i + 1) + ':' + (a + 1) + ' is too short to be a verse');
    });
  });
});

test('the text carries no latin letter, digit or control character', () => {
  const offenders = [];
  payload.a.forEach(function (verses, s) {
    verses.forEach(function (v, a) {
      if (/[A-Za-z0-9\u0000-\u001F\u007F]/.test(v)) offenders.push((s + 1) + ':' + (a + 1));
    });
  });
  assert.deepStrictEqual(offenders, [], 'these verses hold something that is not arabic');
});
