// Learn data conventions from client-provided base samples (all optional).
// Works on the generic XML tree ({ name, attrs, children, text }) so it is DOM-independent:
//   browser: xmlToTree() in lib/mdrRules/domXml.js      node tests: any tree with the same shape
//
// learnProfile(trees, { rootName, model }) -> profile
//   profile.byPath[tagPath] = { values[], rule }     tagPath like /Document/FIToFICstmrCdtTrf/.../Nm  (attributes: .../@Ccy)
//   profile.byName[name]    = { values[], rule }     same, merged over every place the element name occurs
//   profile.present[tagPath] = number of samples element appeared in      profile.repeats[tagPath] = max occurrences under one parent
//
// rule kinds:  counter  (AdrLine1 -> AdrLine2 ...)   repeatCounter (AdrLine1AdrLine1.. then AdrLine2AdrLine2..)   repeat (NmNmNm... filled to a length)   literal (reuse the client value)

export const tagPathOf = (id) =>
  '/' + id.split('/').filter((s) => s && !s.startsWith('#')).map((s) => s.replace(/~\d+$/, '')).join('/')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i

function findNode(n, name) {
  if (n.name === name) return n
  for (const c of n.children || []) { const f = findNode(c, name); if (f) return f }
  return null
}

// simple type of every leaf in the XSD model, by tag path (used to learn "at maximum length")
export function leafSimples(model) {
  const out = {}
  const walk = (n) => {
    if (n.kind === 'element' && n.simple && !(n.children || []).length) out[tagPathOf(n.id)] = n.simple
    if (n.kind === 'element') for (const a of n.attrs || []) out[`${tagPathOf(n.id)}/@${a.name}`] = a.simple
    for (const c of n.children || []) walk(c)
  }
  if (model) walk(model.root)
  return out
}

export function learnProfile(trees, opts = {}) {
  const simples = leafSimples(opts.model)
  const rootName = opts.rootName || opts.model?.root?.name
  const byPath = {}
  const present = {}
  const repeats = {}
  const add = (path, v) => { (byPath[path] ||= { values: [] }).values.push(v) }

  for (const t of trees) {
    const root = rootName ? findNode(t, rootName) : t
    if (!root) continue
    const seenHere = new Set()
    const walk = (n, parentPath) => {
      const path = `${parentPath}/${n.name}`
      seenHere.add(path)
      for (const [k, v] of Object.entries(n.attrs || {})) {
        if (k === 'xmlns' || k.startsWith('xmlns')) continue
        add(`${path}/@${k}`, v); seenHere.add(`${path}/@${k}`)
      }
      if (!n.children.length) { if (n.text) add(path, n.text) }
      const counts = {}
      for (const c of n.children) counts[c.name] = (counts[c.name] || 0) + 1
      for (const [name, k] of Object.entries(counts)) {
        const p = `${path}/${name}`
        repeats[p] = Math.max(repeats[p] || 0, k)
      }
      for (const c of n.children) walk(c, path)
    }
    walk(root, '')
    for (const p of seenHere) present[p] = (present[p] || 0) + 1
  }

  const byName = {}
  for (const [path, e] of Object.entries(byPath)) {
    e.rule = deriveRule(e.values, simples[path])
    const name = path.split('/').pop()
    const b = (byName[name] ||= { values: [], simple: simples[path] })
    b.values.push(...e.values)
  }
  for (const e of Object.values(byName)) { e.rule = deriveRule(e.values, e.simple); delete e.simple }
  return { rootName, files: trees.length, byPath, byName, present, repeats }
}

const mostCommon = (arr) => {
  const m = new Map()
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

export function counterOf(v) {
  const m = /^(.*[^\d])(\d{1,6})$/.exec(v)
  if (!m || UUID.test(v)) return null
  if ((m[1].match(/[A-Za-z]/g) || []).length < 2) return null
  return { stem: m[1], num: Number(m[2]), width: m[2].length > 1 && m[2][0] === '0' ? m[2].length : 0 }
}

export function repeatUnitOf(v) {
  if (v.length < 4) return null
  for (let k = 1; k <= v.length / 2; k++) {
    const u = v.slice(0, k)
    if (!/[A-Za-z]/.test(u)) continue
    if (k === 1 && v.length < 4) continue
    if (u.repeat(Math.ceil(v.length / k)).slice(0, v.length) === v) return u
  }
  return null
}

// values = every value seen for this field/name, in document order
export function deriveRule(values, simple) {
  if (!values.length) return null
  const lens = values.map((v) => v.length)
  const base = { len: Math.max(...lens), minLen: Math.min(...lens), n: values.length, distinct: new Set(values).size }
  if (simple?.maxLength !== undefined && base.len >= simple.maxLength) base.atMax = true

  const units = values.map(repeatUnitOf)
  if (units.every(Boolean)) {
    // unit that itself ends in a number (AdrLine1AdrLine1...): the number advances from sample to sample
    const uc = units.map(counterOf)
    if (uc.every(Boolean) && new Set(uc.map((c) => c.stem)).size === 1) {
      const step = uc.length > 1 && uc[1].num !== uc[0].num ? uc[1].num - uc[0].num : 1
      return { kind: 'repeatCounter', stem: uc[0].stem, start: uc[0].num, step, width: uc[0].width, ...base }
    }
    if (new Set(units).size === 1) return { kind: 'repeat', unit: units[0], ...base }
  }
  const counters = values.map(counterOf)
  if (counters.every(Boolean) && new Set(counters.map((c) => c.stem)).size === 1) {
    const step = counters.length > 1 && counters[1].num !== counters[0].num ? counters[1].num - counters[0].num : 1
    return { kind: 'counter', stem: counters[0].stem, start: counters[0].num, step, width: counters[0].width, ...base }
  }
  return { kind: 'literal', value: mostCommon(values), ...base }
}

// choice group id -> index of the branch the client sample used (only groups seen in the samples)
export function choicesFromProfile(model, profile) {
  const out = {}
  if (!profile) return out
  const below = (n) => {
    if (n.kind === 'element') return !!profile.present[tagPathOf(n.id)]
    return (n.children || []).some(below)
  }
  const walk = (n) => {
    if (n.kind === 'choice') {
      const i = n.children.findIndex(below)
      if (i > 0) out[n.id] = i
    }
    for (const c of n.children || []) walk(c)
  }
  walk(model.root)
  return out
}

export const presentInProfile = (profile, id) => !!profile?.present?.[tagPathOf(id)]
export const groupPresentInProfile = (profile, n) =>
  n.kind === 'element' ? presentInProfile(profile, n.id) : (n.children || []).some((c) => groupPresentInProfile(profile, c))

export function lookupRule(profile, where, name) {
  if (!profile) return null
  return profile.byPath[tagPathOf(where)]?.rule || profile.byName[name]?.rule || null
}

// one-line description for UIs
export function describeRule(r) {
  if (!r) return ''
  if (r.kind === 'counter') return `counter "${r.stem}" + number from ${String(r.start).padStart(r.width, '0')}`
  if (r.kind === 'repeatCounter') return `repeat "${r.stem}<n>" (n from ${r.start}, +1 per sample)${r.atMax ? ' to max length' : ` to ${r.len} chars`}`
  if (r.kind === 'repeat') return `repeat "${r.unit}"${r.atMax ? ' to max length' : ` to ${r.len} chars`}`
  return `reuse "${r.value}" (${r.len} chars)`
}

// "AdrLine length=8" / "* lengthPolicy=max" lines -> { AdrLine: {length:8}, '*': {lengthPolicy:'max'} }
export function parseHints(text) {
  const out = {}
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*(\S+)\s+(.+)$/.exec(line)
    if (!m) continue
    const h = (out[m[1]] ||= {})
    for (const kv of m[2].split(/[\s,]+/)) {
      const [k, v] = kv.split('=')
      if (k === 'length' && Number(v) > 0) h.length = Number(v)
      else if (k === 'lengthPolicy' && ['max', 'mid'].includes(v)) h.lengthPolicy = v
    }
  }
  return out
}
