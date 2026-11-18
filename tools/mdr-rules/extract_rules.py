#!/usr/bin/env python3
"""Extract per-message constraint rules from an ISO 20022 MDR "Part 2" PDF.

Standard library only (no installs). Usage:
    python3 extract_rules.py <MDR-Part2.pdf> [out_dir] [message_id ...]
Default out_dir: v2/src/content/schemas/rules  (gitignored: keep MDR-derived data local).

Output: one <message-id>.json per message with
  tags   long element name -> XML tags (from the element tables)
  codes  code name used in formal conditions -> code (e.g. ClearingSystem -> CLRG)
  rules  [{id, name, kind: rule|guideline, text, automation: formal|prose|text-only, condition}]
  valueConstraints  [{name, text}]  base-type constraints (currency, country, IBAN, BIC ...)
condition = { when: Expr|null, then: Expr }  with Expr one of
  {op: present|absent|mustPresent|mustAbsent, path}
  {op: equals, path, value}        {op: anyEquals, path, values}
  {op: ccyDiff|ccyEq, path, path2}
  {op: and|or, args: [Expr...]}
"""
import json, os, re, sys, zlib

FOOT = re.compile(r'((?:pacs|pain|camt)\.\d{3}\.\d{3}\.\d{2}) \w+ Payments Clearing and Settlement')
FOOTER_STRIP = re.compile(r'Approved by the Payments SEG on \d+ \w+ \d{4}\s+(?:pacs|pain|camt)\.\d{3}\.\d{3}\.\d{2} \w+ Payments Clearing and Settlement - Maintenance \d{4} - \d{4} \d+ \w+ \d{4}')


def read_pages(pdf):
    d = open(pdf, 'rb').read()
    pages = []
    for m in re.finditer(rb'stream\r?\n', d):
        s = m.end(); e = d.find(b'endstream', s)
        try:
            st = zlib.decompress(d[s:e])
        except Exception:
            continue
        if b'BT' not in st:
            continue
        out = []
        for tj in re.finditer(rb'\[(.*?)\]\s*TJ|\((.*?)(?<!\\)\)\s*Tj', st, re.S):
            if tj.group(1) is not None:
                out.append(''.join(x.decode('latin1') for x in re.findall(rb'\(((?:\\.|[^\\)])*)\)', tj.group(1))))
            else:
                out.append(tj.group(2).decode('latin1'))
        pages.append(' '.join(out).replace('\\(', '(').replace('\\)', ')'))
    return pages


def norm(s):
    s = re.sub(r'\s+', ' ', s)
    s = re.sub(r'/\s+', '/', s)
    return s.strip()

PATH = r"(/[A-Za-z0-9_\[\]\*/:]+)"


def split_top(text, word):
    return [p.strip() for p in re.split(r' %s ' % word, text)]


def parse_clause(c, then):
    c = c.strip()
    m = re.match(PATH + r" Must be (present|absent)$", c) if then else None
    if m:
        return {'op': 'mustPresent' if m.group(2) == 'present' else 'mustAbsent', 'path': m.group(1)}
    if then:
        return None
    m = re.match(PATH + r" is (present|absent)$", c)
    if m:
        return {'op': m.group(2), 'path': m.group(1)}
    m = re.match(PATH + r" is equal to value '([^']+)'$", c)
    if m:
        return {'op': 'equals', 'path': m.group(1), 'value': m.group(2)}
    m = re.match(PATH + r"/attribute::Currency is (different from|equal to) " + PATH + r"/attribute::Currency$", c)
    if m:
        return {'op': 'ccyDiff' if m.group(2).startswith('diff') else 'ccyEq', 'path': m.group(1), 'path2': m.group(3)}
    return None


def parse_expr(text, then):
    ors = []
    for part in split_top(text, 'Or'):
        ands = [parse_clause(x, then) for x in split_top(part, 'And')]
        if any(a is None for a in ands):
            return None
        ors.append(ands[0] if len(ands) == 1 else {'op': 'and', 'args': ands})
    return ors[0] if len(ors) == 1 else {'op': 'or', 'args': ors}


def parse_prose(name, text):
    t = norm(text)
    m = re.match(r"If (\w+) is not present, then (\w+) is not allowed\.?", t)
    if m:
        return {'when': {'op': 'absent', 'path': '/' + m.group(1)}, 'then': {'op': 'mustAbsent', 'path': '/' + m.group(2)}}
    m = re.match(r"If (\w+) is present, then (\w+) must be present\.?", t)
    if m:
        return {'when': {'op': 'present', 'path': '/' + m.group(1)}, 'then': {'op': 'mustPresent', 'path': '/' + m.group(2)}}
    return None


def parse_chqb(body):
    m = re.search(r"if at least one occurrence of \[([\w/]+)\] has value included in the following list ((?:'\w+'\s*,?\s*)+), then the following element\(s\) \[(\w+)\] must be absent", body)
    if not m:
        return None
    vals = re.findall(r"'(\w+)'", m.group(2))
    return {'when': {'op': 'anyEquals', 'path': '/' + m.group(1), 'values': vals}, 'then': {'op': 'mustAbsent', 'path': '/' + m.group(3)}}


def extract_message(mid, text):
    text = FOOTER_STRIP.sub(' ', text)
    tags = {}
    for long, tag in re.findall(r'\b([A-Z][A-Za-z0-9]+)\s+<(\w+)>\s+\[\d\.\.[\d\*]\]', text):
        tags.setdefault(long, [])
        if tag not in tags[long]:
            tags[long].append(tag)
    entries = {}
    for e in re.split(r'\\225|\u2022', text):
        m = re.match(r'([A-Z][A-Za-z0-9]+(?:Rule|Guideline))\s+(.*)', e.strip(), re.S)
        if not m:
            continue
        name, body = m.group(1), norm(m.group(2))
        body = re.split(r' \d+(?:\.\d+)+ ?[A-Z]', body)[0]
        if name not in entries or ('On Condition' in body and 'On Condition' not in entries[name]) or \
           ('Following Must be True' in body and 'Following Must be True' not in entries[name]):
            entries[name] = body
    rules, wanted_codes = [], set()
    for name in sorted(entries):
        body = entries[name]
        prose = re.split(r' On Condition | Following Must be True ', body)[0].strip()
        cond, auto = None, 'text-only'
        if 'Following Must be True' in body:
            pre, post = body.split('Following Must be True', 1)
            post = re.split(r' This constraint is defined| if at least one', post)[0].strip()
            when = None
            if 'On Condition' in pre:
                when = parse_expr(pre.split('On Condition', 1)[1].strip(), False)
            then = parse_expr(post, True)
            if then is not None and (when is not None or 'On Condition' not in pre):
                cond, auto = {'when': when, 'then': then}, 'formal'
        if cond is None:
            c = parse_chqb(body) or (parse_prose(name, prose) if not name.endswith('Guideline') else None)
            if c:
                cond, auto = c, 'prose'
        if name.endswith('Guideline'):
            cond, auto = None, 'text-only'
        rules.append({'id': name, 'name': name, 'kind': 'guideline' if name.endswith('Guideline') else 'rule',
                      'text': prose[:400], 'automation': auto, 'condition': cond})
        for v in re.findall(r"equal to value '([A-Za-z]+)'", body):
            wanted_codes.add(v)
    codes = {}
    for nm in wanted_codes:
        m = re.search(r'\b([A-Z0-9]{4}) %s\b' % nm, text)
        if m:
            codes[nm] = m.group(1)
    values, seen_v = [], set()
    for n, body in re.findall(r'\bC\d+ ([A-Z][A-Za-z0-9]+) (.*?)(?=\bC\d+ [A-Z][A-Za-z0-9]+ |Approved by|$)', text):
        if n.endswith('Rule') or n.endswith('Guideline') or n in seen_v:
            continue
        seen_v.add(n)
        values.append({'name': n, 'text': norm(body)[:300]})
    return {'message': mid, 'tags': tags, 'codes': codes, 'rules': rules, 'valueConstraints': values}


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    pdf = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'content', 'schemas', 'rules')
    only = set(sys.argv[3:])
    os.makedirs(out, exist_ok=True)
    per = {}
    for p in read_pages(pdf):
        m = FOOT.findall(p)
        if m:
            per[m[-1]] = per.get(m[-1], '') + ' ' + p
    for mid, text in sorted(per.items()):
        if only and mid not in only:
            continue
        data = extract_message(mid, text)
        data['source'] = os.path.basename(pdf)
        with open(os.path.join(out, mid + '.json'), 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=1, ensure_ascii=False)
        by = {}
        for r in data['rules']:
            by[r['automation']] = by.get(r['automation'], 0) + 1
        print(mid, len(data['rules']), 'rules', by, len(data['tags']), 'tags')

if __name__ == '__main__':
    main()
