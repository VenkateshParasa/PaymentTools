// Generate a string matching an XSD `pattern` (a regex subset: literals, escapes,
// [classes], (groups), | alternation, ? * + {n} {n,m} quantifiers). Deterministic via rng.
// Returns null when the pattern uses something unsupported.

const PRINTABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const CLASS_ESC = {
  d: '0123456789',
  w: PRINTABLE + '_',
  s: ' ',
  D: 'ABCDEFGHIJ',
  W: '-.,',
  S: PRINTABLE,
}

export function makeRng(seed = 1) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function generateFromPattern(pattern, rng = makeRng(1)) {
  try {
    const p = { s: pattern, i: 0 }
    const node = parseAlt(p)
    if (p.i < p.s.length) return null
    return emit(node, rng)
  } catch {
    return null
  }
}

function parseAlt(p) {
  const branches = [parseSeq(p)]
  while (p.s[p.i] === '|') { p.i++; branches.push(parseSeq(p)) }
  return { t: 'alt', branches }
}

function parseSeq(p) {
  const items = []
  while (p.i < p.s.length && p.s[p.i] !== '|' && p.s[p.i] !== ')') {
    const atom = parseAtom(p)
    const q = parseQuant(p)
    items.push({ atom, min: q[0], max: q[1] })
  }
  return { t: 'seq', items }
}

function parseQuant(p) {
  const c = p.s[p.i]
  if (c === '?') { p.i++; return [0, 1] }
  if (c === '*') { p.i++; return [0, 3] }
  if (c === '+') { p.i++; return [1, 3] }
  if (c === '{') {
    const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(p.s.slice(p.i))
    if (!m) throw new Error('bad quantifier')
    p.i += m[0].length
    const min = Number(m[1])
    const max = m[2] ? (m[3] === '' ? min + 3 : Number(m[3])) : min
    return [min, max]
  }
  return [1, 1]
}

function parseAtom(p) {
  const c = p.s[p.i]
  if (c === '(') {
    p.i++
    if (p.s.startsWith('?:', p.i)) p.i += 2
    const inner = parseAlt(p)
    if (p.s[p.i] !== ')') throw new Error('unclosed group')
    p.i++
    return inner
  }
  if (c === '[') return parseClass(p)
  if (c === '\\') { p.i++; return escAtom(p.s[p.i++]) }
  if (c === '.') { p.i++; return { t: 'set', chars: PRINTABLE } }
  p.i++
  return { t: 'lit', ch: c }
}

function escAtom(e) {
  if (CLASS_ESC[e]) return { t: 'set', chars: CLASS_ESC[e] }
  if ('nrt'.includes(e)) return { t: 'lit', ch: ' ' }
  if (e === 'p' || e === 'P' || e === 'i' || e === 'c' || e === 'I' || e === 'C') throw new Error('unsupported escape')
  return { t: 'lit', ch: e }
}

function parseClass(p) {
  p.i++ // [
  let neg = false
  if (p.s[p.i] === '^') { neg = true; p.i++ }
  let chars = ''
  while (p.i < p.s.length && p.s[p.i] !== ']') {
    let c = p.s[p.i++]
    if (c === '[') throw new Error('class subtraction unsupported')
    if (c === '\\') {
      const e = p.s[p.i++]
      if (CLASS_ESC[e]) { chars += CLASS_ESC[e]; continue }
      if ('pPiIcC'.includes(e)) throw new Error('unsupported escape')
      c = e
    }
    if (p.s[p.i] === '-' && p.s[p.i + 1] && p.s[p.i + 1] !== ']') {
      let end = p.s[p.i + 1]
      p.i += 2
      if (end === '\\') end = p.s[p.i++]
      for (let k = c.charCodeAt(0); k <= end.charCodeAt(0); k++) chars += String.fromCharCode(k)
    } else chars += c
  }
  if (p.s[p.i] !== ']') throw new Error('unclosed class')
  p.i++
  if (neg) chars = [...PRINTABLE].filter((ch) => !chars.includes(ch)).join('')
  if (!chars) throw new Error('empty class')
  return { t: 'set', chars }
}

function emit(n, rng) {
  if (n.t === 'alt') return emit(n.branches[Math.floor(rng() * n.branches.length)], rng)
  if (n.t === 'seq') {
    return n.items.map((it) => {
      const count = it.min + Math.floor(rng() * (it.max - it.min + 1))
      let out = ''
      for (let k = 0; k < count; k++) out += emit(it.atom, rng)
      return out
    }).join('')
  }
  if (n.t === 'set') return n.chars[Math.floor(rng() * n.chars.length)]
  return n.ch
}
