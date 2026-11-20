import { generateFromPattern, makeRng } from './patternGen.js'
import { hintFor } from './valueHints.js'
import { lookupRule, tagPathOf, groupPresentInProfile } from './baseProfile.js'

// generate(model, opts) -> XML string
// opts: { mode: 'mandatory' | 'full', choices: { [groupId]: index }, repeat: 1, seed: 1,
//         annotate: false, declaration: true,
//         overrides: { [elementId or elementId/@attr]: 'custom value' },
//         profile: learnProfile(...) (client base sample, optional), iteration: 1 (counter fields: AdrLine1, AdrLine2 ...),
//         valueStyle: 'realistic' | 'sequence'  (for fields the profile has no pattern for: realistic values, or the tag name repeated
//                     to the field length: NmNmNm..., AdrLine1AdrLine1... with the number advancing per sample),
//         hints: { [name or '*']: { length, lengthPolicy: 'max'|'mid' } },
//         include: Set<elementId> (force present), exclude: Set<elementId> (force absent unless something below is included),
//         counts: { [elementId]: n } (repeat count for one element; overrides.value may be an array: one per occurrence),
//         values: { [elementId or elementId/@attr]: 'value' } (preferred values; used only if the element is emitted, never forces it in),
//         adoptStructure: false (follow the profile's optional elements and repeat counts) }
// A custom value forces its element (and ancestors) into the output, even if optional.
export function generateSample(model, opts = {}) {
  const o = { mode: 'mandatory', choices: {}, repeat: 1, seed: 1, annotate: false, declaration: true, overrides: {}, profile: null, iteration: 1, valueStyle: 'realistic', hints: {}, adoptStructure: false, values: {}, include: new Set(), exclude: new Set(), counts: {}, ...opts, _seen: {} }
  o._inc = [...o.include]
  const rng = makeRng(o.seed)
  const warnings = []
  const lines = []
  if (o.declaration) lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  emitElement(model.root, 0, o, rng, lines, warnings, model.targetNamespace)
  return { xml: lines.join('\n'), warnings }
}

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (v) => esc(v).replace(/"/g, '&quot;')
const card = (n) => `${n.min}..${n.max === Infinity ? 'n' : n.max}`
const ind = (d) => '  '.repeat(d)

function emitElement(n, depth, o, rng, lines, warnings, ns) {
  if (o.exclude.has(n.id) && !incBelow(n, o)) return
  const want = o.adoptStructure && o.profile?.repeats?.[tagPathOf(n.id)] ? o.profile.repeats[tagPathOf(n.id)] : o.repeat
  const count = n.max > 1 ? Math.min(n.max, Math.max(n.min, o.counts[n.id] ?? want)) : 1
  for (let i = 0; i < count; i++) emitOne(n, depth, o, rng, lines, warnings, i === 0 ? ns : undefined)
}

function emitOne(n, depth, o, rng, lines, warnings, ns) {
  const attrs = (n.attrs || [])
    .filter((a) => o.mode === 'full' || a.use === 'required' || hasOverride(o, `${n.id}/@${a.name}`))
    .map((a) => ` ${a.name}="${escAttr(valueFor(a.simple, a.name, rng, warnings, `${n.id}/@${a.name}`, o))}"`)
    .join('')
  const nsAttr = ns ? ` xmlns="${escAttr(ns)}"` : ''
  const note = o.annotate && depth > 0 ? ` <!-- ${card(n)} -->` : ''
  const open = `${ind(depth)}<${n.name}${nsAttr}${attrs}`

  if (n.recursive) { lines.push(`${open}/> <!-- recursive type: stopped -->`); return }

  const hasChildren = (n.children || []).length > 0
  if (hasChildren) {
    const body = []
    for (const c of n.children) emitParticle(c, depth + 1, o, rng, body, warnings)
    if (!body.length) { lines.push(`${open}/>${note}`); return }
    lines.push(`${open}>${note}`, ...body, `${ind(depth)}</${n.name}>`)
  } else {
    const v = n.simple ? valueFor(n.simple, n.name, rng, warnings, n.id, o) : ''
    lines.push(`${open}>${esc(v)}</${n.name}>${note}`)
  }
}

const hasOverride = (o, id) => Object.prototype.hasOwnProperty.call(o.overrides, id) && o.overrides[id] !== ''
// true when this node or anything below it has a custom value
const incBelow = (n, o) => o._inc.some((k) => k === n.id || k.startsWith(n.id + '/'))
const forcedBelow = (n, o) => incBelow(n, o) || Object.keys(o.overrides).some((k) => o.overrides[k] !== '' && (k === n.id || k.startsWith(n.id + '/')))

function included(n, o) {
  if (o.exclude.has(n.id) && !incBelow(n, o)) return false
  return o.mode === 'full' || n.min >= 1 || forcedBelow(n, o) || (o.adoptStructure && groupPresentInProfile(o.profile, n))
}

function emitParticle(p, depth, o, rng, lines, warnings) {
  if (p.kind === 'element') {
    if (included(p, o)) emitElement(p, depth, o, rng, lines, warnings)
    return
  }
  if (!included(p, o)) return
  const times = p.max > 1 ? Math.min(p.max, Math.max(p.min, o.repeat)) : 1
  for (let t = 0; t < times; t++) {
    if (p.kind === 'choice') {
      const forced = p.children.findIndex((c) => forcedBelow(c, o))
      let idx = forced >= 0 ? forced : Math.min(o.choices[p.id] ?? 0, p.children.length - 1)
      if (forced < 0 && p.children[idx]?.kind === 'element' && o.exclude.has(p.children[idx].id)) {
        const alt = p.children.findIndex((c) => !(c.kind === 'element' && o.exclude.has(c.id)))
        if (alt >= 0) idx = alt
      }
      const pick = p.children[idx]
      if (pick) emitChoiceMember(pick, depth, o, rng, lines, warnings)
    } else {
      for (const c of p.children) emitParticle(c, depth, o, rng, lines, warnings)
    }
  }
}

// the chosen branch is always emitted (a choice must resolve), even if its own minOccurs is 0
function emitChoiceMember(c, depth, o, rng, lines, warnings) {
  if (c.kind === 'element') emitElement({ ...c, min: Math.max(1, c.min) }, depth, o, rng, lines, warnings)
  else emitParticle({ ...c, min: Math.max(1, c.min) }, depth, o, rng, lines, warnings)
}

// ---- values ----
function xsdRegex(p) {
  try { return new RegExp(`^(?:${p})$`) } catch { return null }
}

export function fits(v, s) {
  if (s.enums.length) return s.enums.includes(v)
  if (s.length !== undefined && v.length !== s.length) return false
  if (s.minLength !== undefined && v.length < s.minLength) return false
  if (s.maxLength !== undefined && v.length > s.maxLength) return false
  if (s.patterns.length) {
    const res = s.patterns.map(xsdRegex)
    // unsupported-in-JS patterns can't be checked: accept the hint
    if (res.every(Boolean) && !res.some((r) => r.test(v))) return false
  }
  return true
}

// "sequence" style: the tag name repeated up to the field length. Only for free-text strings (no enumeration,
// no pattern) with room for a name (> 5 chars), so codes, ids with patterns, dates and amounts stay realistic.
function sequenceRule(name, s) {
  if (s.enums.length || s.patterns.length || s.builtin !== 'string') return null
  const max = s.length ?? s.maxLength
  if (max !== undefined && max <= 5) return null
  if (name === 'AdrLine') return { kind: 'repeatCounter', stem: 'AdrLine', start: 1, step: 1, width: 0, atMax: true }
  return { kind: 'repeat', unit: name, atMax: true }
}

function renderRule(r, s, o, seen) {
  const max = s.length ?? s.maxLength
  if (r.kind === 'counter') {
    const num = String(r.start + r.step * (Math.max(1, o.iteration) - 1 + seen)).padStart(r.width, '0')
    return r.stem + num
  }
  if (r.kind === 'repeat' || r.kind === 'repeatCounter') {
    const unit = r.kind === 'repeat' ? r.unit : r.stem + String(r.start + r.step * (Math.max(1, o.iteration) - 1 + seen)).padStart(r.width, '0')
    let target = r.atMax && max !== undefined ? max : r.len ?? max
    if (target === undefined) target = unit.length * 4
    if (max !== undefined) target = Math.min(target, max)
    return unit.repeat(Math.ceil(target / unit.length)).slice(0, target)
  }
  return r.value
}

// resize a value to a wanted length (cut, or repeat it) and keep it only if it still satisfies the schema
function resize(v, len, s) {
  if (!len || len === v.length) return v
  const out = len < v.length ? v.slice(0, len) : v.repeat(Math.ceil(len / v.length)).slice(0, len)
  return fits(out, s) ? out : v
}

function applyHints(v, name, where, s, o) {
  const h = o.hints[name] || o.hints[where] || o.hints['*']
  if (!h || s.enums.length) return v
  const max = s.length ?? s.maxLength
  if (h.length) return resize(v, h.length, s)
  if (h.lengthPolicy === 'max' && max !== undefined && s.builtin === 'string') return resize(v, max, s)
  if (h.lengthPolicy === 'mid' && max !== undefined && s.builtin === 'string') return resize(v, Math.ceil(max / 2), s)
  return v
}

function valueFor(s, name, rng, warnings, where, o) {
  if (hasOverride(o, where)) {
    const ov = o.overrides[where]
    const seenOv = (o._seenOv ||= {})[where] = ((o._seenOv || {})[where] ?? -1) + 1
    const v = Array.isArray(ov) ? ov[seenOv] ?? ov.at(-1) : ov
    if (!fits(v, s)) warnings.push(`${where}: custom value "${v}" does not match the schema facets (enumeration / pattern / length); used as typed`)
    return v
  }
  if (o.values[where] !== undefined) return applyHints(o.values[where], name, where, s, o)
  const seen = (o._seen[where] = (o._seen[where] ?? -1) + 1)
  const rule = lookupRule(o.profile, where, name) || (o.valueStyle === 'sequence' ? sequenceRule(name, s) : null)
  if (rule) {
    const v = renderRule(rule, s, o, seen)
    if (fits(v, s)) return applyHints(v, name, where, s, o)
    warnings.push(`${where}: client-sample pattern gave "${v}" which does not fit the schema; used the default value`)
  }
  return applyHints(defaultValue(s, name, rng, warnings, where), name, where, s, o)
}

export function defaultValue(s, name, rng, warnings, where) {
  const hint = hintFor(name)
  if (hint !== undefined && fits(hint, s)) return hint
  if (s.enums.length) return s.enums[0]

  for (const pat of s.patterns) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const v = generateFromPattern(pat, rng)
      if (v !== null && fits(v, s)) return v
    }
  }
  if (s.patterns.length) warnings.push(`${where}: could not satisfy pattern ${s.patterns[0]}; used a placeholder`)
  return builtinValue(s, name)
}

function builtinValue(s, name) {
  const b = s.builtin
  if (/^(decimal|float|double)$/.test(b)) return decimal(s)
  if (/^(integer|int|long|short|byte|nonNegativeInteger|positiveInteger|unsignedInt|unsignedLong|negativeInteger|nonPositiveInteger)$/.test(b)) {
    const lo = s.minInclusive !== undefined ? s.minInclusive : b === 'positiveInteger' ? 1 : 1
    return String(Math.max(lo, 1) <= (s.maxInclusive ?? Infinity) ? Math.max(lo, 1) : lo)
  }
  if (b === 'boolean') return 'true'
  if (b === 'date') return '2026-11-14'
  if (b === 'dateTime' || b === 'ISODateTime') return '2026-11-14T10:00:00Z'
  if (b === 'time') return '10:00:00'
  if (b === 'gYear') return '2026'
  if (b === 'gYearMonth') return '2026-11'
  if (b === 'duration') return 'P1D'
  if (b === 'base64Binary') return 'U2FtcGxl'
  return fitString(name ? `Sample ${name}` : 'Sample', s)
}

function decimal(s) {
  const frac = s.fractionDigits !== undefined ? Math.min(s.fractionDigits, 2) : 2
  const intDigits = s.totalDigits !== undefined ? Math.max(1, s.totalDigits - (s.fractionDigits ?? 0)) : 5
  let int = '15250'.slice(0, intDigits)
  if (s.minInclusive !== undefined && Number(int) < s.minInclusive) int = String(Math.ceil(s.minInclusive))
  return frac > 0 ? `${int}.${'0'.repeat(frac)}` : int
}

function fitString(v, s) {
  let out = v
  const max = s.length ?? s.maxLength
  const min = s.length ?? s.minLength
  if (max !== undefined && out.length > max) out = out.slice(0, max)
  if (min !== undefined) while (out.length < min) out += 'X'
  return out
}
