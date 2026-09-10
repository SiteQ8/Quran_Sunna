/*
 * The printed layout of the Madinah mushaf: which words fall on which of the
 * fifteen lines of each page.
 *
 * The app already divides the mushaf into the same 604 pages, so this adds the
 * line breaks alone, not a second mushaf. The text stays the one already in
 * docs/data/mushaf.json; only the shape of the page comes from here.
 *
 * Run:  node tools/store/fetch-madinah-lines.mjs [firstPage] [lastPage]
 * Out:  docs/data/madinah-lines.json
 *
 * The source is asked for one page at a time with a pause between, because it
 * is someone else's server and 604 requests at once is not a fair way to ask.
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';

const OUT = 'docs/data/madinah-lines.json';
const FIRST = Number(process.argv[2] || 1);
const LAST = Number(process.argv[3] || 604);
const PAUSE = 350;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(n) {
  const url = 'https://api.quran.com/api/v4/verses/by_page/' + n +
    '?words=true&word_fields=line_number&per_page=300';
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('page ' + n + ' answered ' + res.status);
  const body = await res.json();

  /* every word of the page in order, each knowing its line, its surah and its
     ayah; a word that is an end-of-ayah mark is not a word of the text */
  const lines = new Map();
  for (const verse of body.verses || []) {
    const [surah, ayah] = String(verse.verse_key).split(':').map(Number);
    let at = 0;
    for (const word of verse.words || []) {
      if (word.char_type_name !== 'word') continue;
      at += 1;
      const line = word.line_number;
      if (!line) continue;
      if (!lines.has(line)) lines.set(line, []);
      const run = lines.get(line);
      const last = run[run.length - 1];
      /* words of one ayah on one line are kept as a single run */
      if (last && last[0] === surah && last[1] === ayah && last[3] === at - 1) last[3] = at;
      else run.push([surah, ayah, at, at]);
    }
  }
  return [...lines.keys()].sort((a, b) => a - b).map((k) => lines.get(k));
}

const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { v: 1, pages: {} };
let done = 0;

for (let n = FIRST; n <= LAST; n++) {
  try {
    out.pages[n] = await page(n);
    done += 1;
    if (done % 20 === 0) process.stdout.write('  ' + n + ' pages\n');
  } catch (err) {
    process.stdout.write('  page ' + n + ' failed: ' + err.message + '\n');
  }
  await sleep(PAUSE);
}

mkdirSync('docs/data', { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
const kept = Object.keys(out.pages).length;
process.stdout.write('kept ' + kept + ' of 604 pages, ' +
  Math.round(readFileSync(OUT, 'utf8').length / 1024) + ' kb\n');
