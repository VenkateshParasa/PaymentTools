// Automatic scenario generation from the parsed MDR rules and the XSD model.
// For every rule with a machine-readable condition it creates positive, negative and
// not-applicable scenarios (plus repeat variants), each with the fields involved, a sample XML
// fragment, the rule text, the expected result and a plain-English reason. Rules that cannot be
// read by a machine (guidelines, free text) get a "Manual needed" row so nothing is silently dropped.
import { bindRules, childElements, planFix } from './ruleEngine.js'
import { supported } from './coverage.js'
import { generateFromPattern } from '../xsd/patternGen.js'
import { hintFor } from '../xsd/valueHints.js'

export const SCENARIO_HEADER = ['Scenario ID', 'Message', 'Rule name', 'Rule type', 'Coverage (rule coverage report)', 'Scenario Type', 'Fields/sections included', 'Sample data (XML fragment)',
  'Scenario Description (rule text, MDR PDF)', 'What this scenario tests', 'Expected outcome, why?', 'Expected result (Pass/Fail)', 'Advisory warning raised', 'Occurrences', 'Expected generator action', 'Notes']

// ---------- helpers on the model ----------
const tagPathOf = (id) => id.split('/').filter((s) => s && !s.startsWith('#')).map((s) => s.replace(/~\d+$/, ''))
function parentMap(model) {
  const parent = new Map()
  const walk = (n, p) => { if (n.kind === 'element') { parent.set(n.id, p); p = n } for (const c of n.children || []) walk(c, p) }
  walk(model.root, null)
  return parent
}
function longNameFor(rulesFile) {
  const rev = {}
  for (const [long, tags] of Object.entries(rulesFile.tags || {})) for (const t of tags) if (!rev[t] || long.length < rev[t].length) rev[t] = long
  return (tag) => rev[tag] || tag
}

// ---------- values ----------
function leafValue(node, ccy) {
  const s = node.simple
  if (!s) return ''
  const fits = (v) => (!s.enums.length || s.enums.includes(v)) && (!s.patterns.length || s.patterns.every((p) => { try { return new RegExp(`^(?:${p})$`).test(v) } catch { return true } }))
  if (ccy === 'INR' && /^(decimal|float|double)$/.test(s.builtin)) return '1450000.00'
  const hint = ['Cd', 'Prtry'].includes(node.name) ? undefined : hintFor(node.name)
  if (hint !== undefined && fits(hint)) return hint
  if (s.enums.length) return s.enums[0]
  for (const p of s.patterns) { const v = generateFromPattern(p); if (v && fits(v)) return v }
  const b = s.builtin
  if (/^(decimal|float|double)$/.test(b)) return ccy === 'INR' ? '1450000.00' : '15250.00'
  if (/^(integer|int|long|short|byte|nonNegativeInteger|positiveInteger)$/.test(b)) return '1'
  if (b === 'boolean') return 'true'
  if (b === 'date') return '2026-11-14'
  if (b === 'dateTime') return '2026-11-14T10:00:00Z'
  return ('Sample ' + node.name).slice(0, s.maxLength || 35)
}

// ---------- XML fragment from a scenario state ----------
class X { constructor(tag) { this.tag = tag; this.attrs = {}; this.text = ''; this.kids = []; this.notes = [] } }

function fillContent(x, node, entry, depth = 0, explicit = false) {
  for (const a of node.attrs || []) if (a.use === 'required' || entry?.attrs?.[a.name]) x.attrs[a.name] = entry?.attrs?.[a.name] || (a.simple?.enums?.[0] ?? (a.name === 'Ccy' ? 'EUR' : 'X'))
  const kids = childElements(node)
  if (kids.length) {
    if (explicit || x.kids.length || depth >= 6) return
    const seenChoice = new Set()
    const required = kids.filter((c) => c.min >= 1)
    if (!required.length) { addKid(x, kids[0], depth); return } // nothing mandatory: show one sensible child
    for (const c of node.children) {
      if (c.kind === 'element' && c.min >= 1) addKid(x, c, depth)
      else if (c.kind === 'choice' && !seenChoice.has(c.id)) { seenChoice.add(c.id); const f = childElements(c)[0]; if (f) addKid(x, f, depth) }
      else if (c.kind !== 'element' && c.kind !== 'choice') for (const k of childElements(c).filter((k) => k.min >= 1)) addKid(x, k, depth)
    }
  } else if (node.simple && !x.text) {
    x.text = entry?.value ?? leafValue(node, entry?.attrs?.Ccy)
  }
}
function addKid(x, c, depth) { const k = new X(c.name); x.kids.push(k); fillContent(k, c, null, depth + 1) }

function xmlFragment(model, state) {
  const parent = parentMap(model)
  const rootX = new X(model.root.name)
  const reg = new Map([[model.root.id, rootX]])
  const ensureNode = (node) => {
    if (reg.has(node.id)) return reg.get(node.id)
    const p = ensureNode(parent.get(node.id))
    const x = new X(node.name); p.kids.push(x); reg.set(node.id, x); return x
  }
  const order = [...state.values()].sort((a, b) => (a.mode === 'absent') - (b.mode === 'absent'))
  for (const e of order) {
    if (e.mode === 'absent') { const p = e.node.id === model.root.id ? null : ensureNode(parent.get(e.node.id)); if (p) { p.kids = p.kids.filter((k) => k.tag !== e.node.name); reg.delete(e.node.id); p.notes.push(`${e.node.name} not present`) } continue }
    const p = ensureNode(parent.get(e.node.id))
    const explicit = [...state.keys()].some((k) => k.startsWith(e.node.id + '/'))
    const count = e.count || 1
    for (let i = 0; i < count; i++) {
      let x = i === 0 ? reg.get(e.node.id) : null
      if (!x) { x = new X(e.node.name); p.kids.push(x); if (i === 0) reg.set(e.node.id, x) }
      const val = Array.isArray(e.value) ? e.value[i] ?? e.value.at(-1) : e.value
      fillContent(x, e.node, { ...e, value: val }, 0, explicit)
      for (const [k, v] of Object.entries(e.attrs || {})) x.attrs[k] = v
    }
  }
  const out = []
  const attrs = (n) => Object.entries(n.attrs).map(([k, v]) => ` ${k}="${v}"`).join('')
  const emit = (n, d) => {
    const ind = '  '.repeat(d)
    if (!n.kids.length && !n.notes.length) { out.push(n.text ? `${ind}<${n.tag}${attrs(n)}>${n.text}</${n.tag}>` : `${ind}<${n.tag}${attrs(n)}/>`); return }
    out.push(`${ind}<${n.tag}${attrs(n)}>`)
    n.kids.forEach((k) => emit(k, d + 1))
    n.notes.forEach((c) => out.push(`${ind}  <!-- ${c} -->`))
    out.push(`${ind}</${n.tag}>`)
  }
  // skip a lone document wrapper
  const start = rootX.kids.length === 1 && !rootX.notes.length ? rootX.kids[0] : rootX
  emit(start, 0)
  return out.join('\n')
}

// ---------- state builders ----------
const setS = (st, node, patch) => { const e = st.get(node.id) || { node, mode: 'present', count: 1, attrs: {} }; Object.assign(e, patch); if (patch.attrs) e.attrs = { ...(st.get(node.id)?.attrs || {}), ...patch.attrs }; st.set(node.id, e) }
const tg = (ctx, p) => ctx.targets[p]
function otherValue(node, code) { const en = node.simple?.enums || []; return en.find((v) => v !== code) || 'XXXX' }

function applyTrue(e, st, ctx, codes, opt = 0) {
  switch (e.op) {
    case 'present': case 'mustPresent': setS(st, tg(ctx, e.path).node, { mode: 'present' }); break
    case 'absent': case 'mustAbsent': setS(st, tg(ctx, e.path).node, { mode: 'absent' }); break
    case 'equals': setS(st, tg(ctx, e.path).node, { mode: 'present', value: codes[e.value] || e.value }); break
    case 'anyEquals': setS(st, tg(ctx, e.path).node, { mode: 'present', value: e.values[0] }); break
    case 'ccyDiff': case 'ccyEq':
      setS(st, tg(ctx, e.path).node, { mode: 'present', attrs: { [tg(ctx, e.path).attr || 'Ccy']: e.op === 'ccyDiff' ? 'INR' : 'EUR' } })
      setS(st, tg(ctx, e.path2).node, { mode: 'present', attrs: { [tg(ctx, e.path2).attr || 'Ccy']: 'EUR' } }); break
    case 'and': e.args.forEach((a) => applyTrue(a, st, ctx, codes)); break
    case 'or': applyTrue(e.args[opt], st, ctx, codes); e.args.forEach((a, i) => { if (i !== opt) applyFalse(a, st, ctx, codes) }); break
  }
}
function applyFalse(e, st, ctx, codes) {
  switch (e.op) {
    case 'present': case 'mustPresent': setS(st, tg(ctx, e.path).node, { mode: 'absent' }); break
    case 'absent': case 'mustAbsent': setS(st, tg(ctx, e.path).node, { mode: 'present' }); break
    case 'equals': { const n = tg(ctx, e.path).node; setS(st, n, { mode: 'present', value: otherValue(n, codes[e.value] || e.value) }); break }
    case 'anyEquals': { const n = tg(ctx, e.path).node; setS(st, n, { mode: 'present', value: otherValue(n, e.values[0]) }); break }
    case 'ccyDiff': case 'ccyEq':
      setS(st, tg(ctx, e.path).node, { mode: 'present', attrs: { [tg(ctx, e.path).attr || 'Ccy']: e.op === 'ccyDiff' ? 'EUR' : 'INR' } })
      setS(st, tg(ctx, e.path2).node, { mode: 'present', attrs: { [tg(ctx, e.path2).attr || 'Ccy']: 'EUR' } }); break
    case 'and': applyFalse(e.args[0], st, ctx, codes); break
    case 'or': e.args.forEach((a) => applyFalse(a, st, ctx, codes)); break
  }
}

// ---------- wording ----------
let CODES = {}
const lname = (p) => p.replace(/^\//, '').replace(/\[[^\]]*\]/g, '').replace(/\/attribute::Currency/, '')
function phr(e, truth = true) {
  const L = lname(e.path || '')
  switch (e.op) {
    case 'present': case 'mustPresent': return truth ? `${L} is present` : `${L} is not present`
    case 'absent': case 'mustAbsent': return truth ? `${L} is not present` : `${L} is present`
    case 'equals': { const v = CODES[e.value] ? `${CODES[e.value]} (${e.value})` : e.value; return truth ? `${L} is ${v}` : `${L} is not ${v}` }
    case 'anyEquals': return truth ? `${L} contains ${e.values.join(' or ')}` : `${L} does not contain ${e.values.join(' or ')}`
    case 'ccyDiff': return (truth ? 'the currency of ' + L + ' differs from' : 'the currency of ' + L + ' is the same as') + ' the currency of ' + lname(e.path2)
    case 'ccyEq': return (truth ? 'the currency of ' + L + ' is the same as' : 'the currency of ' + L + ' differs from') + ' the currency of ' + lname(e.path2)
    case 'and': return truth ? e.args.map((a) => phr(a, true)).join(' and ') : phr(e.args[0], false)
    case 'or': return truth ? e.args.map((a) => phr(a, true)).join(' or ') : 'none of these hold: ' + e.args.map((a) => phr(a, true)).join(', ')
    default: return ''
  }
}
function req(e) {
  switch (e.op) {
    case 'mustPresent': return `${lname(e.path)} must be present`
    case 'mustAbsent': return `${lname(e.path)} is not allowed`
    case 'and': return e.args.map(req).join(' and ')
    case 'or': return `at least one of ${e.args.map((a) => lname(a.path)).join(', ')} must be present`
    default: return ''
  }
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

// ---------- per-rule scenarios ----------
const pickCtx = (b) => b.contexts.find((c) => /Cdtr(Acct)?$/.test(c.tagPath.at(-1))) || b.contexts.find((c) => c.tagPath.includes('CdtTrfTxInf')) || b.contexts[0]

function specsFor(b, codes) {
  const { condition: { when: W, then: Tt } } = b.rule
  const ctx = pickCtx(b)
  const specs = []
  const add = (type, build, tests, why, result, action = 'none', extra = {}) => specs.push({ type, build, tests, why, result, action, ...extra })
  const branches = W ? (W.op === 'or' ? W.args : [W]) : [null]
  const violations = Tt.op === 'and' ? Tt.args : [Tt]
  const actionFor = (clause) => planFix(clause, ctx, new Set()).filter((a) => !(a.type === 'exclude' && a.min >= 1)).map((a) => `${a.type === 'include' ? 'add' : 'remove'} ${a.label}`).join('; ') || 'none'

  branches.forEach((wb) => {
    const wTxt = wb ? phr(wb) : ''
    add('Positive', (st) => { if (wb) applyTrue(wb, st, ctx, codes); applyTrue(Tt, st, ctx, codes) },
      wb ? `${cap(wTxt)}, requirement met` : `${cap(phr(Tt))}`,
      wb ? `Should pass: ${wTxt}, and ${phr(Tt)}, so the rule is satisfied.` : `Should pass: ${phr(Tt)}, which satisfies the rule.`, 'Pass')
    if (Tt.op === 'or') {
      Tt.args.forEach((o, k) => add('Positive', (st) => { if (wb) applyTrue(wb, st, ctx, codes); applyTrue(Tt, st, ctx, codes, k) },
        `Only ${lname(o.path)} present (one option is enough)`,
        `Should pass: ${req(Tt)}; ${lname(o.path)} alone satisfies the rule and the other options are absent.`, 'Pass'))
      add('Positive', (st) => { if (wb) applyTrue(wb, st, ctx, codes); Tt.args.forEach((o) => applyTrue(o, st, ctx, codes)) },
        'All options present', 'Should pass: all of the options may be present together.', 'Pass')
    }
    violations.forEach((v) => add('Negative', (st) => { if (wb) applyTrue(wb, st, ctx, codes); applyFalse(v, st, ctx, codes) },
      `${wb ? cap(wTxt) + ', but ' : ''}${phr(v, false)}`,
      `Should fail: ${wb ? wTxt + ', so ' : ''}${req(v)}, but ${phr(v, false)}.`, 'Fail', actionFor(v)))
  })
  if (W) {
    const nas = W.op === 'and' ? W.args.slice(0, 3) : [W]
    nas.forEach((n) => add('Not applicable', (st) => { applyFalse(n, st, ctx, codes) },
      `${cap(phr(n, false))}`, `Should pass (rule not triggered): ${phr(n, false)}, so there is nothing to check.`, 'Pass'))
    if (W.op === 'present' && Tt.op === 'mustPresent') add('Positive', (st) => { applyFalse(W, st, ctx, codes); applyTrue(Tt, st, ctx, codes) },
      `Only ${lname(Tt.path)} present (no ${lname(W.path)})`, `Should pass: the rule only restricts the case where ${phr(W)}; ${phr(Tt)} on its own is allowed.`, 'Pass')
  }
  // repeat variants for the first repeatable element involved
  const rep = Object.values(ctx.targets).find((t) => t.node.max > 1)
  if (rep) {
    const wb = branches[0]
    add('Positive', (st) => { if (wb) applyTrue(wb, st, ctx, codes); applyTrue(Tt, st, ctx, codes); if (st.get(rep.node.id)?.mode === 'present') st.get(rep.node.id).count = 3 },
      `${rep.node.name} repeated 3 times, requirement met`, `Should pass: ${rep.node.name} appears 3 times and the rule is satisfied for every occurrence.`, 'Pass', 'none', { occ: `${rep.node.name} x3`, needsRep: rep.node.id })
    add('Negative', (st) => { if (wb) applyTrue(wb, st, ctx, codes); applyFalse(violations[0], st, ctx, codes); if (st.get(rep.node.id)?.mode === 'present') st.get(rep.node.id).count = 3 },
      `${rep.node.name} repeated 3 times, requirement not met`, `Should fail: ${rep.node.name} appears 3 times but ${req(violations[0])} is not satisfied.`, 'Fail', actionFor(violations[0]), { occ: `${rep.node.name} x3`, needsRep: rep.node.id })
  }
  return { specs, ctx }
}

const VALUE_SCENARIOS = {
  ActiveCurrency: [['Valid ISO 4217 currency (EUR)', '<Amt Ccy="EUR">15250.00</Amt>', 'Currency = EUR', 'Pass', 'Should pass: EUR is a valid active currency code.', 'Needs the ISO 4217 list'], ['Pattern-valid but unknown currency (XXZ)', '<Amt Ccy="XXZ">15250.00</Amt>', 'Currency = XXZ', 'Fail', 'Should fail: three capital letters pass the XSD, but XXZ is not an ISO 4217 currency.', 'Needs the ISO 4217 list']],
  CurrencyAmount: [['JPY amount with no decimals', '<Amt Ccy="JPY">15250</Amt>', 'Amount = JPY 15250', 'Pass', 'Should pass: JPY has 0 minor units.', 'Needs fraction digits per currency'], ['JPY amount with 2 decimals', '<Amt Ccy="JPY">15250.50</Amt>', 'Amount = JPY 15250.50', 'Fail', 'Should fail: JPY allows no fractional digits.', 'Needs fraction digits per currency']],
  Country: [['Valid ISO 3166 country (DE)', '<Ctry>DE</Ctry>', 'Country = DE', 'Pass', 'Should pass: DE is a valid country code.', 'Needs the ISO 3166 list'], ['Pattern-valid but unassigned country (ZZ)', '<Ctry>ZZ</Ctry>', 'Country = ZZ', 'Fail', 'Should fail: two capital letters pass the XSD, but ZZ is not an assigned ISO 3166 code.', 'Needs the ISO 3166 list']],
  IBAN: [['IBAN with correct check digits', '<IBAN>DE89370400440532013000</IBAN>', 'IBAN = DE89370400440532013000', 'Pass', 'Should pass: structure and check digits are valid.', 'Check digits computable (mod-97)'], ['Pattern-valid IBAN with wrong check digits', '<IBAN>DE00370400440532013000</IBAN>', 'IBAN = DE00370400440532013000', 'Fail', 'Should fail: the XSD pattern passes but the mod-97 check digits are wrong.', 'Check digits computable (mod-97)']],
  BICFI: [['BIC with correct structure', '<BICFI>DEUTDEFFXXX</BICFI>', 'BICFI = DEUTDEFFXXX', 'Pass', 'Should pass: 11-character BIC in the right format.', 'Structure only; registry not checked'], ['BIC with wrong structure (7 characters)', '<BICFI>DEUTDEF</BICFI>', 'BICFI = DEUTDEF', 'Fail', 'Should fail: a BIC has 8 or 11 characters.', 'XSD pattern']],
}
VALUE_SCENARIOS.ActiveOrHistoricCurrency = VALUE_SCENARIOS.ActiveCurrency
VALUE_SCENARIOS.AnyBIC = VALUE_SCENARIOS.BICFI

// coverageRows: rows from analyseCoverage (for the Coverage column); returns { header, rows, stats }
export function generateScenarios(rulesFile, model, coverageRows = []) {
  const id = rulesFile.message
  const codes = rulesFile.codes || {}
  CODES = codes
  const covOf = Object.fromEntries(coverageRows.map((r) => [r.rule, r.coverage]))
  const short = longNameFor(rulesFile)
  const bound = bindRules(rulesFile, model)
  const rows = []
  const stats = { automatic: 0, manual: 0, scenarios: 0 }
  const meta = [] // parallel to rows: what each scenario is made of (used to build full messages)
  const push = (r, m = { kind: 'none' }) => { rows.push([`S${String(rows.length + 1).padStart(3, '0')}`, id, ...r]); meta.push(m) }
  const human = (e) => { const t = tagPathOf(e.node.id); return `${t.slice(-2).map(short).join('/')} (${t.slice(-3).join('/')})` }
  const fieldText = (st) => [...st.values()].map((e) => {
    const d = e.mode === 'absent' ? 'Not present' : e.value !== undefined ? (Array.isArray(e.value) ? e.value.join(', ') : e.value) : 'Present'
    const at = e.attrs && Object.keys(e.attrs).length ? ` [${Object.entries(e.attrs).map(([k, v]) => `${k}=${v}`).join(', ')}]` : ''
    return `${human(e)} = ${d}${e.mode === 'present' && e.count > 1 ? ` x${e.count}` : ''}${at}`
  }).join('; ')

  for (const b of bound) {
    const r = b.rule
    const type = r.kind === 'guideline' ? 'Guideline' : 'Hard rule'
    const cov = covOf[r.name] || ''
    if (!r.condition || !supported(r.condition.when) || !supported(r.condition.then) || !b.contexts.length) {
      stats.manual++
      const why = r.kind === 'guideline'
        ? 'Guideline (advisory): write one compliant and one non-compliant case by hand. A broken guideline never fails a message.'
        : !r.condition ? 'Rule is free text only: write the valid and invalid cases by hand.' : 'The engine cannot read this rule: write the cases by hand.'
      push([r.name, type, cov, 'Manual needed', '(not generated)', '', r.text, 'Scenarios must be written manually', why, 'n/a', r.kind === 'guideline' ? 'Yes (if broken)' : 'No', '', 'none (manual)', 'See the coverage report for the reason.'], { kind: 'manual', rule: r.name })
      continue
    }
    stats.automatic++
    const { specs, ctx } = specsFor(b, codes)
    for (const sp of specs) {
      const st = new Map()
      sp.build(st)
      push([r.name, type, cov, sp.type, fieldText(st), xmlFragment(model, st), r.text, sp.tests, sp.why, sp.result, 'No', sp.occ || '1', sp.action, ctx !== b.contexts[0] || b.contexts.length > 1 ? `Rule applies to ${b.contexts.length} place(s) in this message; shown for ${ctx.tagPath.at(-1)}.` : ''], { kind: 'rule', rule: r.name, type: sp.type, expect: sp.result, st })
      stats.scenarios++
    }
  }
  for (const v of rulesFile.valueConstraints || []) {
    const items = VALUE_SCENARIOS[v.name]
    if (!items) continue
    for (const [tests, xml, fields, res, why, note] of items) {
      push([v.name, 'Base-type constraint', 'Value-level (see value-constraints report)', 'Value check', fields, xml, v.text.slice(0, 300), tests, why, res, 'No', '1', res === 'Fail' ? 'set a valid value' : 'none', note], { kind: 'value', rule: v.name, fragment: xml, expect: res })
      stats.scenarios++
    }
  }
  return { header: SCENARIO_HEADER, rows, stats, meta }
}

export function scenarioCounts(rows) {
  const by = {}
  for (const r of rows) (by[r[2]] ??= []).push(r[5])
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, `${v.length} (${v.filter((x) => x === 'Positive').length} valid / ${v.filter((x) => x === 'Negative').length} invalid / ${v.filter((x) => x === 'Not applicable').length} n.a.)`]))
}
