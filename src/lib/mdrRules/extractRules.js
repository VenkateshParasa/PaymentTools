// Rule extraction from MDR "Part 2" text (port of tools/mdr-rules/extract_rules.py; the two must agree).
// Output per message: { message, tags, codes, rules, valueConstraints }.

const FOOT = /((?:pacs|pain|camt)\.\d{3}\.\d{3}\.\d{2}) \w+ Payments Clearing and Settlement/g
const FOOTER_STRIP = /Approved by the Payments SEG on \d+ \w+ \d{4}\s+(?:pacs|pain|camt)\.\d{3}\.\d{3}\.\d{2} \w+ Payments Clearing and Settlement - Maintenance \d{4} - \d{4} \d+ \w+ \d{4}/g
const PATH = "(/[A-Za-z0-9_\\[\\]\\*/:]+)"

const norm = (s) => s.replace(/\s+/g, ' ').replace(/\/\s+/g, '/').trim()
const splitTop = (text, word) => text.split(new RegExp(` ${word} `)).map((p) => p.trim())

function parseClause(c, then) {
  c = c.trim()
  let m
  if (then) {
    m = c.match(new RegExp('^' + PATH + ' Must be (present|absent)$'))
    return m ? { op: m[2] === 'present' ? 'mustPresent' : 'mustAbsent', path: m[1] } : null
  }
  if ((m = c.match(new RegExp('^' + PATH + ' is (present|absent)$')))) return { op: m[2], path: m[1] }
  if ((m = c.match(new RegExp('^' + PATH + " is equal to value '([^']+)'$")))) return { op: 'equals', path: m[1], value: m[2] }
  if ((m = c.match(new RegExp('^' + PATH + '/attribute::Currency is (different from|equal to) ' + PATH + '/attribute::Currency$'))))
    return { op: m[2].startsWith('diff') ? 'ccyDiff' : 'ccyEq', path: m[1], path2: m[3] }
  return null
}

function parseExpr(text, then) {
  const ors = []
  for (const part of splitTop(text, 'Or')) {
    const ands = splitTop(part, 'And').map((x) => parseClause(x, then))
    if (ands.some((a) => a === null)) return null
    ors.push(ands.length === 1 ? ands[0] : { op: 'and', args: ands })
  }
  return ors.length === 1 ? ors[0] : { op: 'or', args: ors }
}

function parseProse(text) {
  const t = norm(text)
  let m
  if ((m = t.match(/^If (\w+) is not present, then (\w+) is not allowed\.?/))) return { when: { op: 'absent', path: '/' + m[1] }, then: { op: 'mustAbsent', path: '/' + m[2] } }
  if ((m = t.match(/^If (\w+) is present, then (\w+) must be present\.?/))) return { when: { op: 'present', path: '/' + m[1] }, then: { op: 'mustPresent', path: '/' + m[2] } }
  return null
}

function parseChqb(body) {
  const m = body.match(/if at least one occurrence of \[([\w/]+)\] has value included in the following list ((?:'\w+'\s*,?\s*)+), then the following element\(s\) \[(\w+)\] must be absent/)
  if (!m) return null
  return { when: { op: 'anyEquals', path: '/' + m[1], values: [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]) }, then: { op: 'mustAbsent', path: '/' + m[3] } }
}

export function extractMessage(mid, rawText) {
  const text = rawText.replace(FOOTER_STRIP, ' ')
  const tags = {}
  for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9]+)\s+<(\w+)>\s+\[\d\.\.[\d\*]\]/g)) {
    tags[m[1]] ??= []
    if (!tags[m[1]].includes(m[2])) tags[m[1]].push(m[2])
  }
  const entries = {}
  for (const e of text.split(/\\225|•/)) {
    const m = e.trim().match(/^([A-Z][A-Za-z0-9]+(?:Rule|Guideline))\s+([\s\S]*)/)
    if (!m) continue
    const name = m[1]
    let body = norm(m[2]).split(/ \d+(?:\.\d+)+ ?[A-Z]/)[0]
    if (!(name in entries) || (body.includes('On Condition') && !entries[name].includes('On Condition')) ||
        (body.includes('Following Must be True') && !entries[name].includes('Following Must be True'))) entries[name] = body
  }
  const rules = []
  const wanted = new Set()
  for (const name of Object.keys(entries).sort()) {
    const body = entries[name]
    const prose = body.split(/ On Condition | Following Must be True /)[0].trim()
    let cond = null, auto = 'text-only'
    if (body.includes('Following Must be True')) {
      const idx = body.indexOf('Following Must be True')
      const pre = body.slice(0, idx), post0 = body.slice(idx + 'Following Must be True'.length)
      const post = post0.split(/ This constraint is defined| if at least one/)[0].trim()
      let when = null
      if (pre.includes('On Condition')) when = parseExpr(pre.split('On Condition')[1].trim(), false)
      const then = parseExpr(post, true)
      if (then !== null && (when !== null || !pre.includes('On Condition'))) { cond = { when, then }; auto = 'formal' }
    }
    if (cond === null) {
      const c = parseChqb(body) || (!name.endsWith('Guideline') ? parseProse(prose) : null)
      if (c) { cond = c; auto = 'prose' }
    }
    if (name.endsWith('Guideline')) { cond = null; auto = 'text-only' }
    rules.push({ id: name, name, kind: name.endsWith('Guideline') ? 'guideline' : 'rule', text: prose.slice(0, 400), automation: auto, condition: cond })
    for (const v of body.matchAll(/equal to value '([A-Za-z]+)'/g)) wanted.add(v[1])
  }
  const codes = {}
  for (const nm of wanted) {
    const m = text.match(new RegExp(`\\b([A-Z0-9]{4}) ${nm}\\b`))
    if (m) codes[nm] = m[1]
  }
  const valueConstraints = []
  const seen = new Set()
  for (const m of text.matchAll(/\bC\d+ ([A-Z][A-Za-z0-9]+) ([\s\S]*?)(?=\bC\d+ [A-Z][A-Za-z0-9]+ |Approved by|$)/g)) {
    if (m[1].endsWith('Rule') || m[1].endsWith('Guideline') || seen.has(m[1])) continue
    seen.add(m[1])
    valueConstraints.push({ name: m[1], text: norm(m[2]).slice(0, 300) })
  }
  return { message: mid, tags, codes, rules, valueConstraints }
}

// pages (from pdfText.js) -> { [messageId]: rulesFile }, optionally limited to some ids
export function extractAllMessages(pages, only) {
  const per = {}
  for (const p of pages) {
    const ms = [...p.matchAll(FOOT)]
    if (ms.length) { const id = ms[ms.length - 1][1]; per[id] = (per[id] || '') + ' ' + p }
  }
  const out = {}
  for (const id of Object.keys(per).sort()) if (!only || only.includes(id)) out[id] = extractMessage(id, per[id])
  return out
}
