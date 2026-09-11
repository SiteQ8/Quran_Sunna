#!/usr/bin/env node
'use strict';
/* What weighs, and what weighs twice.
 *
 * Ten identical copies of the opening artwork sat in the package for months,
 * a third of its size, because a loop walked five densities and screenshotted
 * the same page each time. Nothing was watching, so this watches: every file
 * in the site and every entry in the package is fingerprinted, and two that
 * carry the same bytes under different names are an error.
 *
 *   node tools/review-weight.js
 *
 * It reads the zip's own central directory rather than shelling out, so it
 * needs nothing that node does not already carry.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const APK_DIR = path.join(ROOT, 'android/app/build/outputs/apk/debug');

/* Two copies of these are the point of them, not a mistake. Each line says
   why, so nobody has to guess later whether it is still true. */
const ALLOWED = [
  { match: /^META-INF\//, why: 'signing files the packager writes itself' }
];

let faults = 0;

function fault(lines) {
  faults++;
  lines.forEach(function (l) { console.log(l); });
  console.log('');
}

function human(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

/* ---------- the site ---------- */

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    if (e.name.charAt(0) === '.') return;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  });
  return out;
}

function checkSite() {
  const files = walk(DOCS, []);
  const byHash = new Map();
  let total = 0;
  files.forEach(function (p) {
    const buf = fs.readFileSync(p);
    total += buf.length;
    /* an empty file carries no bytes to repeat */
    if (buf.length === 0) return;
    const key = crypto.createHash('sha1').update(buf).digest('hex');
    if (!byHash.has(key)) byHash.set(key, []);
    byHash.get(key).push({ rel: path.relative(ROOT, p), size: buf.length });
  });

  let wasted = 0;
  byHash.forEach(function (group) {
    if (group.length < 2) return;
    wasted += group[0].size * (group.length - 1);
    fault(['same bytes under ' + group.length + ' names in the site, ' +
      human(group[0].size) + ' each:']
      .concat(group.map(function (g) { return '  ' + g.rel; })));
  });

  console.log('site: ' + files.length + ' files, ' + human(total) +
    (wasted ? ', ' + human(wasted) + ' of it repeated' : ''));
}

/* ---------- the package ---------- */

function centralDirectory(buf) {
  /* the end record is last, after a comment of at most 65535 bytes */
  let eocd = -1;
  const from = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('no end-of-central-directory record');

  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('bad central entry at ' + at);
    const crc = buf.readUInt32LE(at + 16);
    const packed = buf.readUInt32LE(at + 20);
    const plain = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    entries.push({ name: name, crc: crc, packed: packed, plain: plain });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function findApk() {
  if (!fs.existsSync(APK_DIR)) return null;
  const apks = fs.readdirSync(APK_DIR).filter(function (f) { return /\.apk$/.test(f); });
  return apks.length ? path.join(APK_DIR, apks[0]) : null;
}

function buildApk() {
  const gradlew = path.join(ROOT, 'android/gradlew');
  if (!fs.existsSync(gradlew)) return null;
  const env = Object.assign({}, process.env, {
    ANDROID_HOME: process.env.ANDROID_HOME || '/opt/android-sdk',
    JAVA_HOME: process.env.JAVA_HOME || '/usr/lib/jvm/java-21-openjdk-amd64'
  });
  if (!fs.existsSync(env.ANDROID_HOME + '/platforms')) return null;
  console.log('no package yet, building one');
  execFileSync(gradlew, ['--no-daemon', '-q', ':app:assembleDebug'],
    { cwd: path.join(ROOT, 'android'), env: env, stdio: 'ignore' });
  return findApk();
}

function checkPackage() {
  let apk = findApk();
  if (!apk) {
    try { apk = buildApk(); } catch (e) { apk = null; }
  }
  if (!apk) {
    console.error('no package to weigh, and none could be built: run tools/android/setup-sdk.sh');
    process.exit(1);
  }

  const buf = fs.readFileSync(apk);
  const entries = centralDirectory(buf);
  const byContent = new Map();
  entries.forEach(function (e) {
    if (e.plain === 0) return;
    if (ALLOWED.some(function (a) { return a.match.test(e.name); })) return;
    /* the crc and the plain size together: the packager already worked the
       crc out, so nothing has to be unpacked to compare */
    const key = e.crc + ':' + e.plain;
    if (!byContent.has(key)) byContent.set(key, []);
    byContent.get(key).push(e);
  });

  let wasted = 0;
  byContent.forEach(function (group) {
    if (group.length < 2) return;
    wasted += group[0].packed * (group.length - 1);
    fault(['same bytes under ' + group.length + ' names in the package, ' +
      human(group[0].plain) + ' each:']
      .concat(group.map(function (g) { return '  ' + g.name; })));
  });

  const heavy = entries.slice().sort(function (a, b) { return b.packed - a.packed; }).slice(0, 5);
  console.log('package: ' + path.relative(ROOT, apk) + ', ' + human(buf.length) +
    ', ' + entries.length + ' entries' +
    (wasted ? ', ' + human(wasted) + ' of it repeated' : ''));
  console.log('heaviest:');
  heavy.forEach(function (e) {
    console.log('  ' + human(e.packed).padStart(8) + '  ' + e.name);
  });
}

/* ---------- what no phone can reach ---------- */

/* A bitmap that an anydpi-vN folder shadows is only ever chosen below api N.
   Five copies of ic_launcher.png sat in the package for exactly that reason:
   minSdk is 26, anydpi-v26 wins on every device that can install the app, and
   aapt2 confirmed the bitmaps were never resolved at any density. They weigh
   and they are never seen. */
function checkShadowed() {
  const before = faults;
  const RES = path.join(ROOT, 'android/app/src/main/res');
  const gradle = path.join(ROOT, 'android/app/build.gradle');
  if (!fs.existsSync(RES) || !fs.existsSync(gradle)) return;
  const min = parseInt((/minSdk(?:Version)?\s+(\d+)/.exec(fs.readFileSync(gradle, 'utf8')) || [])[1], 10);
  if (!min) return;

  const dirs = fs.readdirSync(RES, { withFileTypes: true })
    .filter(function (e) { return e.isDirectory(); }).map(function (e) { return e.name; });

  dirs.forEach(function (dir) {
    const m = /^([a-z]+)-anydpi(?:-v(\d+))?$/.exec(dir);
    if (!m) return;
    const type = m[1];
    const since = m[2] ? parseInt(m[2], 10) : 0;
    if (since > min) return;   /* older phones really do fall back to the bitmap */
    fs.readdirSync(path.join(RES, dir)).forEach(function (f) {
      const stem = f.replace(/\.[^.]+$/, '');
      const shadowed = [];
      dirs.forEach(function (other) {
        if (other === dir || other.indexOf(type + '-') !== 0) return;
        const at = path.join(RES, other, stem + '.png');
        if (fs.existsSync(at)) shadowed.push({ rel: path.relative(ROOT, at), size: fs.statSync(at).size });
      });
      if (!shadowed.length) return;
      const sum = shadowed.reduce(function (a, b) { return a + b.size; }, 0);
      fault([dir + '/' + f + ' is chosen on every phone from api ' + Math.max(since, min) +
        ', and minSdk is ' + min + ', so these are never reached (' + human(sum) + '):']
        .concat(shadowed.map(function (g) { return '  ' + g.rel; })));
    });
  });
  if (faults === before) console.log('shadowed bitmaps: none, minSdk ' + min);
}

console.log('');
checkSite();
console.log('');
checkShadowed();
console.log('');
checkPackage();
console.log('');

if (faults) {
  console.error(faults + ' place' + (faults === 1 ? '' : 's') +
    ' carry the same bytes twice; give them one name or drop the copies');
  process.exit(1);
}
console.log('nothing weighs twice');
