'use strict';
/* The wrapper computes الكويت's prayer times on its own, in java, since a
   trusted web activity has no bridge from the page. This proves that java
   agrees with the app's engine to the minute, by compiling the pure class and
   running it, whenever a jdk is present. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const src = path.join(root, 'android/app/src/main/java/io/github/siteq8/sunnati/PrayerTimes.java');
const hasJdk = spawnSync('javac', ['-version']).status === 0;

test('the wrapper carries the ojeiri table the app carries', () => {
  const app = fs.readFileSync(path.join(root, 'docs/data/ojeiri.js'), 'utf8');
  const fromApp = JSON.parse(/var OJEIRI = (\{.*\});/.exec(app)[1]);
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'android/app/src/main/res/raw/ojeiri.json'), 'utf8'));
  assert.deepStrictEqual(raw, fromApp, 'the two tables must be the same file');
});

test('the java port gives the same minute as the js engine for a year the table does not hold', { skip: !hasJdk && 'no jdk here' }, () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sunnati-java-'));
  fs.writeFileSync(path.join(dir, 'Check.java'), `
import io.github.siteq8.sunnati.PrayerTimes;
import java.util.*;
public class Check { public static void main(String[] a) {
  Calendar c = Calendar.getInstance(TimeZone.getTimeZone("Asia/Kuwait")); c.set(2027,0,1,12,0,0);
  StringBuilder sb = new StringBuilder();
  for (int i = 0; i < 365; i++) { int y=c.get(Calendar.YEAR), m=c.get(Calendar.MONTH)+1, d=c.get(Calendar.DAY_OF_MONTH);
    int[] t = PrayerTimes.forDate(y, m, d, null);
    sb.append(y+"-"+m+"-"+d+" "+t[0]+" "+t[1]+" "+t[2]+" "+t[3]+" "+t[4]+" "+t[5]+"\\n"); c.add(Calendar.DATE, 1); }
  System.out.print(sb); } }`);
  execFileSync('javac', ['-d', dir, src, path.join(dir, 'Check.java')]);
  const out = execFileSync('java', ['-cp', dir, 'Check']).toString().trim().split('\n');
  const PE = require(path.join(root, 'docs/js/prayer-engine.js'));
  const calc = new PE.Calculator({ lat: 29.3759, lng: 47.9774, method: 'Ojeiri', asr: 'standard' });
  let off = 0;
  out.forEach(function (line) {
    const parts = line.split(' ');
    const [y, m, d] = parts[0].split('-').map(Number);
    const t = calc.timesFor(new Date(y, m - 1, d), 3);
    [t.fajr, t.sunrise, t.dhuhr, t.asr, t.maghrib, t.isha].forEach(function (v, i) { if (v !== +parts[i + 1]) off++; });
  });
  assert.strictEqual(out.length, 365);
  assert.strictEqual(off, 0, 'minutes on which java and js disagree');
});

test('the wrapper declares what an alarm needs and nothing it does not', () => {
  const manifest = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  ['USE_EXACT_ALARM', 'SCHEDULE_EXACT_ALARM', 'RECEIVE_BOOT_COMPLETED', 'POST_NOTIFICATIONS', 'VIBRATE', 'INTERNET'].forEach(function (p) {
    assert.ok(manifest.indexOf('android.permission.' + p) !== -1, 'missing ' + p);
  });
  assert.ok(manifest.indexOf('android:name=".AdhanReceiver"') !== -1);
  assert.ok(manifest.indexOf('android.intent.action.BOOT_COMPLETED') !== -1, 'alarms are armed again after a reboot');
  assert.ok(manifest.indexOf('android:name=".MainActivity"') !== -1, 'our launcher arms the alarms');
  assert.ok(manifest.indexOf('com.google.androidbrowserhelper.trusted.LauncherActivity"\n            android:exported="true"') === -1, 'the library launcher is not the entry any more');
  const shortcuts = fs.readFileSync(path.join(root, 'android/app/src/main/res/xml/shortcuts.xml'), 'utf8');
  assert.ok(shortcuts.indexOf('AdhanToggleActivity') !== -1, 'the adhan can be switched off from the icon');
});

test('the wrapper can see a browser and hand it the splash, the two faults that crashed the first build', () => {
  const manifest = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.ok(manifest.indexOf('<queries>') !== -1 && manifest.indexOf('android.support.customtabs.action.CustomTabsService') !== -1,
    'without a query for custom tabs, android 11 and later hide every browser from the app');
  const paths = fs.readFileSync(path.join(root, 'android/app/src/main/res/xml/filepaths.xml'), 'utf8');
  assert.ok(/files-path[^>]*path="twa_splash\/"/.test(paths), 'the file provider must allow files/twa_splash, where the splash is written for chrome');
  const strings = fs.readFileSync(path.join(root, 'android/app/src/main/res/values/strings.xml'), 'utf8');
  assert.ok(/<string name="appName">سُنّتي<\/string>/.test(strings), 'the label the system shows is the name alone');
  const main = fs.readFileSync(path.join(root, 'android/app/src/main/java/io/github/siteq8/sunnati/MainActivity.java'), 'utf8');
  assert.ok(main.indexOf('try {') !== -1 && main.indexOf('AdhanScheduler.scheduleNext(this);') !== -1, 'the alarm must never keep the app from opening');
});

test('the splash the launcher inflates is a bitmap, not a layer list over an adaptive icon', () => {
  const res = path.join(root, 'android/app/src/main/res');
  assert.ok(!fs.existsSync(path.join(res, 'drawable', 'splash.xml')), 'a <bitmap> whose src is the adaptive icon xml throws on inflation and killed the app at launch');
  ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].forEach(function (d) {
    const f = path.join(res, 'drawable-' + d, 'splash.png');
    assert.ok(fs.existsSync(f), 'splash for ' + d);
    const png = fs.readFileSync(f);
    assert.strictEqual(png.toString('ascii', 1, 4), 'PNG');
  });
  const manifest = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.ok(manifest.indexOf('android:theme="@style/Theme.Launcher"') !== -1, 'the launcher wears the translucent theme the library recommends');
  assert.ok(manifest.indexOf('android:name=".App"') !== -1 && manifest.indexOf('.CrashActivity') !== -1, 'a crash shows its trace on screen');
});
