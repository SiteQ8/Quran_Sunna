import pymupdf, re, unicodedata, json
F="/mnt/user-data/uploads/__فا_نك_با_عيينا_.pdf"
MAP = {129:'ير',135:'ما',94:'ني',176:'ين',110:'بم',192:'يم',128:'تي',139:'تم',184:'لم',
 202:'بي',179:'ئي',216:'مأ',156:'ثر',214:'ئم',86:'تن',63:'نم',44:'لا',49:'تى',
 72:'كى',67:'ثم',64:'كي',61:'كى',70:'بن',40:'لأ',41:'في',0:''}
d=pymupdf.open(F)

def tidy(s):
    s = unicodedata.normalize('NFKC', s)
    s = re.sub(r'[ \t]{2,}', ' ', s)
    s = re.sub(r'\s+([،.])', r'\1', s)
    return s.strip(' ،.\u200f')

def lines(i):
    """Every line of the page, in reading order. A page may be one span holding
       many lines, so the glyphs are bucketed by their own baseline first."""
    marks = set(range(0x064B, 0x0653)) | {0x0670, 0x0653, 0x0654, 0x0655}
    rows = {}
    for span in d[i].get_texttrace():
        if span['font'].startswith('Jomhuria'): continue
        for c in span['chars']:
            piece = MAP.get(c[1], '') if c[0] == 0xFFFD else chr(c[0])
            if not piece: continue
            x0, y0, x1, y1 = c[3]
            # a mark is drawn above its letter, so its middle, not its top,
            # decides which line it belongs to
            key_y = (y0 + y1) / 2
            rows.setdefault(round(key_y / 9), []).append((x0, x1, piece, c[0] in marks))
    out = []
    for y in sorted(rows):
        # arabic is read from the right, so the glyphs are taken by falling x,
        # and a mark keeps to the letter it sits on
        items = sorted(rows[y], key=lambda r: (-r[0], r[3]))
        # the space between words is read from the gap itself, since a space
        # glyph beside a mark is sometimes not emitted at all
        widths = [r[1] - r[0] for r in items if not r[3] and r[1] > r[0]]
        unit = sorted(widths)[len(widths)//2] if widths else 6
        parts = []; prev = None
        for x0, x1, piece, is_mark in items:
            if prev is not None and not is_mark and prev - x1 > unit * 0.42: parts.append(' ')
            parts.append(piece)
            if not is_mark: prev = x0
        text = ''.join(parts)
        if text: out.append((y * 9, text))
    return out

def duas(i):
    ls = lines(i)
    if not ls: return []
    gaps = [ls[j+1][0] - ls[j][0] for j in range(len(ls) - 1)]
    base = sorted(gaps)[len(gaps)//2] if gaps else 0
    groups = [[ls[0][1]]]
    for j in range(1, len(ls)):
        if base and ls[j][0] - ls[j-1][0] > base * 1.5: groups.append([ls[j][1]])
        else: groups[-1].append(ls[j][1])
    return [tidy(' '.join(g)) for g in groups if len(tidy(' '.join(g))) > 14]

if __name__ == '__main__':
    for pg in [4, 5, 6]:
        print('=== page %d ===' % (pg + 1))
        for x in duas(pg): print('  •', x[:170])

TOPICS = [(4,'الرزق'),(8,'البركة'),(12,'التسخير والتيسير'),(16,'السلام'),(19,'الغنى'),
 (22,'الجنة'),(26,'الوالدين والعائلة'),(30,'السعادة'),(33,'ثبات الدين'),(37,'حُبّ الله'),
 (40,'قضاء الحاجات'),(43,'الصحة والعافية'),(46,'الحظ'),(49,'المغفرة والتوبة'),(53,'الصلاح والهداية'),
 (56,'التوكل'),(59,'حُسن الخاتمة'),(62,'حُسن الخُلُق'),(65,'الفرج'),(68,'الطمأنينة والأمان'),
 (71,'القرب من الله'),(74,'الرضا'),(77,'الأثر الطيب'),(80,'شكر النعم'),(83,'الحكمة والبصيرة'),
 (86,'الإخلاص'),(90,'الرحمة'),(93,'السعة'),(96,'سلامة القلب'),(100,'ليلة القدر')]

MARK = re.compile(r'[\u064B-\u0655\u0670]')

def plain(t):
    """The marks recovered from this file land beside the wrong letters often
       enough that they cannot be trusted, and the book prints these du'as
       unvocalised anyway, so they are dropped and the letters kept."""
    t = MARK.sub('', t)
    t = re.sub(r'\u0640+', '', t)
    t = re.sub(r'\s+', ' ', t)
    return t.strip(' ،.')

def trustworthy(t):
    """A line that lost its spaces among the marks is left out rather than
       shown wrong: an arabic word does not run past eleven letters."""
    if len(t) < 16: return False
    words = t.split()
    if not words: return False
    if max(len(w) for w in words) > 11: return False
    if len(words) < 3: return False
    return True

def quranic(raw):
    '''A verse of the qur'an is set fully vocalised in this book. The app holds
       the qur'an already, so those lines are left to it rather than copied
       here, where their marks do not survive the file.'''
    marks = len(MARK.findall(raw))
    letters = len(re.sub(r'[^\u0621-\u064A]', '', raw))
    return letters and marks / letters > 0.30

def collect():
    out = []
    for k, (start, title) in enumerate(TOPICS):
        end = TOPICS[k+1][0] if k+1 < len(TOPICS) else 103
        items = []
        for pg in range(start, end):
            for raw in duas(pg - 1):
                if quranic(raw): continue
                t = plain(raw)
                if trustworthy(t) and t not in items: items.append(t)
        out.append({'t': title, 'i': items})
    return out
