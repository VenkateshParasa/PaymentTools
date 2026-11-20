// VMF -> a base sample that passes the VMF's own facets and validation formulas.
//   1. every field/attribute that a <fieldvalidation> applies to gets a value found by trying candidates
//      (generator default, enumerations, pattern-generated values, ISO currencies/countries, sample BICs, amounts)
//      until all of its formulas pass;
//   2. the normal sample generator builds the message with those values (mandatory fields, or all fields);
//   3. the finished XML is parsed again and EVERY formula is run on EVERY matching element: the report says what passed,
//      what failed and what could not be evaluated (unknown function), so nothing is silently skipped.
import { generateSample, fits, defaultValue } from '../xsd/sampleGenerator.js'
import { makeRng, generateFromPattern } from '../xsd/patternGen.js'
import { tagPathOf } from '../xsd/baseProfile.js'
import { compileFormula, compileFunctionDefs, Unsupported } from './formula.js'
import { ruleApplies } from './vmfParser.js'
import { CURRENCIES, COUNTRIES, SAMPLE_BICS } from './isoData.js'
import { parseXmlTree } from './xmlTree.js'
import { FUNCTIONS } from './functions.js'

const POPULAR_CCY = ['EUR', 'USD', 'GBP', 'CHF', 'JPY']
const POPULAR_CTRY = ['DE', 'US', 'GB', 'FR', 'CH']
const EXTRA = () => [
  ...POPULAR_CCY, ...Object.keys(CURRENCIES), ...POPULAR_CTRY, ...COUNTRIES, ...SAMPLE_BICS,
  '15250.00', '100.00', '1500.50', '1000', '10', '1', '0.01',
]

// seeds = what the formulas themselves reveal about acceptable input: string literals they compare with, regular expressions they
// match, and lengths they test (from the formula and every VMF function it calls)
const resize = (v, len) => (len < v.length ? v.slice(0, len) : v.repeat(Math.ceil(len / v.length)).slice(0, len))
function valuePool(s, name, seeds = null) {
  const out = new Set()
  const add = (v) => { if (v !== undefined && v !== null && v !== '' && fits(String(v), s)) out.add(String(v)) }
  const sink = []
  const defaults = []
  for (let seed = 1; seed <= 4; seed++) { const d = defaultValue(s, name, makeRng(seed), sink, name); defaults.push(d); add(d) }
  if (s.enums.length) { s.enums.forEach(add); return [...out] }
  if (seeds) {
    seeds.strings.forEach(add)
    for (const re of seeds.regexes) for (let k = 1; k <= 6; k++) { try { add(generateFromPattern(re, makeRng(k))) } catch { /* pattern not supported by the generator */ } }
    if (s.builtin === 'string') for (const k of seeds.numbers) if (Number.isInteger(k) && k > 0 && k <= 140) for (const d of defaults.slice(0, 2)) add(resize(String(d), k))
  }
  for (const v of EXTRA()) { add(v); if (out.size >= 900) break }
  return [...out]
}
const seedsOf = (rs) => ({
  strings: [...new Set(rs.flatMap((r) => r.c.lits.strings))], regexes: [...new Set(rs.flatMap((r) => r.c.lits.regexes))], numbers: [...new Set(rs.flatMap((r) => r.c.lits.numbers))],
})

function prepare(rules, table) {
  return rules.map((r) => {
    try {
      const c = compileFormula(r.formula, table)
      return c.unknown.length ? { ...r, error: `function ${c.unknown.join(', ')} is neither defined in the VMF nor built in`, unknown: c.unknown } : { ...r, c }
    } catch (e) {
      return { ...r, error: e instanceof Unsupported ? `unsupported: ${e.message}` : e.message }
    }
  })
}

// true = passes, false = fails, null = could not be evaluated
function check(rule, value) {
  try { return rule.c.evaluate(value) } catch (e) { if (e instanceof Unsupported) return null; throw e }
}
const passesAll = (rs, value) => rs.every((r) => check(r, value) !== false)

export function allElements(model) {
  const out = []
  const walk = (n) => { if (n.kind === 'element') out.push(n); for (const c of n.children || []) walk(c) }
  walk(model.root)
  return out
}

export function generateVmfSample(vmf, opts = {}) {
  const fnInfo = compileFunctionDefs(vmf.functions || [])
  const rules = prepare(vmf.rules, fnInfo.table)
  const usable = rules.filter((r) => !r.error)
  const rulesFor = (meta, tag) => usable.filter((r) => ruleApplies(r, meta, tag))
  const matched = new Map(rules.map((r) => [r, 0]))
  const unsolved = []
  const sink = []

  // one message part (data / header / trailer): find values that satisfy the formulas, then build the XML
  function buildPart(model, label) {
    const els = allElements(model)
    for (const n of els) {
      for (const r of usable) if (ruleApplies(r, n.vmf, n.name)) matched.set(r, matched.get(r) + 1)
      for (const a of n.attrs) for (const r of usable) if (ruleApplies(r, a.vmf, a.name)) matched.set(r, matched.get(r) + 1)
    }
    const values = {}
    const lbl = (x) => (label === 'Data' ? x : `${label}: ${x}`)
    for (const n of els) {
      const isLeaf = !(n.children || []).length && n.simple
      if (!isLeaf) continue
      const attrPick = {}
      for (const a of n.attrs) {
        const ar = rulesFor(a.vmf, a.name)
        if (!ar.length) continue
        const pick = valuePool(a.simple, a.name, seedsOf(ar)).find((v) => passesAll(ar, v))
        if (pick === undefined) unsolved.push(lbl(`${n.name}/@${a.name}`))
        else { values[`${n.id}/@${a.name}`] = pick; attrPick[a.name] = pick }
      }
      const er = rulesFor(n.vmf, n.name)
      if (!er.length) continue
      const pool = valuePool(n.simple, n.name, seedsOf(er))
      let found
      if (!n.attrs.length) found = pool.find((v) => passesAll(er, v))
      else {
        const first = n.attrs[0]
        const ar = rulesFor(first.vmf, first.name)
        const attrOptions = [...new Set([attrPick[first.name], defaultValue(first.simple, first.name, makeRng(1), sink, ''), ...valuePool(first.simple, first.name, seedsOf(ar))].filter((x) => x !== undefined))].filter((v) => passesAll(ar, v))
        const others = Object.fromEntries(n.attrs.slice(1).map((a) => [a.name, attrPick[a.name] ?? defaultValue(a.simple, a.name, makeRng(1), sink, '')]))
        outer: for (const ao of attrOptions) {
          for (const v of pool) {
            if (passesAll(er, { Value: v, [first.name]: ao, ...others })) { found = v; values[`${n.id}/@${first.name}`] = ao; break outer }
          }
        }
      }
      if (found === undefined) unsolved.push(lbl(n.name))
      else values[n.id] = found
    }
    const wrap = label === 'Data' && !!opts.wrapDocument && !!model.targetNamespace
    const gen = generateSample(wrap ? { ...model, targetNamespace: '' } : model, {
      mode: opts.mode || 'mandatory', repeat: opts.repeat || 1, valueStyle: opts.valueStyle || 'realistic', hints: opts.hints || {},
      profile: label === 'Data' ? opts.profile || null : null, adoptStructure: label === 'Data' && !!opts.profile, iteration: opts.iteration || 1,
      choices: label === 'Data' ? opts.choices || {} : {}, annotate: !!opts.annotate, values, declaration: !wrap,
    })
    let xml = gen.xml
    if (wrap) {
      const inner = gen.xml.split('\n').map((l) => '  ' + l).join('\n')
      xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Document xmlns="${model.targetNamespace}">\n${inner}\n</Document>`
    }
    return { label, name: model.root.name, xml, model, warnings: gen.warnings }
  }

  // header / trailer are optional (most messages have none): only built when asked for
  const include = !!opts.includeHeaderTrailer
  const info = vmf.partInfo || { header: { found: 0, built: 0 }, trailer: { found: 0, built: 0 }, issues: [] }
  const partIssues = include ? [...info.issues] : []
  const safe = (m, label) => { try { return [buildPart(m, label)] } catch (e) { partIssues.push(`${label}: ${e.message}`); return [] } }
  const parts = [
    ...(include ? (vmf.parts?.header || []).flatMap((m) => safe(m, 'Header')) : []),
    buildPart(vmf.model, 'Data'),
    ...(include ? (vmf.parts?.trailer || []).flatMap((m) => safe(m, 'Trailer')) : []),
  ]
  const data = parts.find((x) => x.label === 'Data')

  // re-read every XML and run every formula on every matching element
  const report = validateXml(parts, rules, matched)
  report.unsolved = unsolved
  // header/trailer status for the UI: off | none | ok | incomplete
  const found = info.header.found + info.trailer.found
  const built = info.header.built + info.trailer.built
  const ht = parts.filter((x) => x.label !== 'Data')
  if (include) {
    if (unsolved.some((u) => /^(Header|Trailer):/.test(u))) partIssues.push('no value satisfying the rules was found for some header/trailer fields')
    if (report.rules.some((r) => r.examples.some((x) => /^(Header|Trailer) /.test(x)))) partIssues.push('some header/trailer values fail their rules')
    if (found > built || ht.length < built) partIssues.push('some header/trailer fields could not be built')
  }
  report.headerTrailer = !include ? { state: 'off', message: '' }
    : found === 0 ? { state: 'none', message: 'Header and trailer are ignored: there are no fields in them.' }
    : partIssues.length ? { state: 'incomplete', message: 'Header and trailer data is incomplete or unreliable.', issues: [...new Set(partIssues)] }
    : { state: 'ok', message: `Header (${info.header.built}) and trailer (${info.trailer.built}) fields were generated as separate parts.` }
  report.functionNotes = fnInfo.notes
  report.functionsFound = (vmf.functions || []).length
  report.userFunctions = Object.values(fnInfo.table).map((f) => ({ name: f.name, params: f.params, usedBy: rules.filter((r) => r.c?.usedUser.includes(f.name)).map((r) => r.name) }))
  return { xml: data.xml, parts: parts.map(({ label, name, xml }) => ({ label, name, xml })), report, warnings: parts.flatMap((x) => x.warnings) }
}

// parts: [{ label, xml, model }]
export function validateXml(parts, rules, matched = new Map()) {
  const stats = new Map(rules.map((r) => [r, { checked: 0, passed: 0, failed: 0, notEvaluated: 0, examples: [] }]))
  const usable = rules.filter((r) => !r.error)
  for (const part of parts) {
    let tree
    try { tree = parseXmlTree(part.xml) } catch (e) { return { wellFormed: false, error: `${part.label}: ${e.message}`, rules: [], totals: {} } }
    const model = part.model
    const index = new Map()
    for (const n of allElements(model)) { const p = tagPathOf(n.id); if (!index.has(p)) index.set(p, n) }
    const run = (meta, tag, value, where) => {
      for (const r of usable) {
        if (!ruleApplies(r, meta, tag)) continue
        const st = stats.get(r)
        st.checked++
        const ok = check(r, value)
        if (ok === null) st.notEvaluated++
        else if (ok) st.passed++
        else { st.failed++; if (st.examples.length < 3) st.examples.push(`${part.label === 'Data' ? '' : part.label + ' '}${where}: ${typeof value === 'object' ? JSON.stringify(value) : `"${value}"`}`) }
      }
    }
    const find = (n) => (n.name === model.root.name ? n : n.children.map(find).find(Boolean))
    const start = find(tree)
    if (!start) return { wellFormed: true, error: `Root <${model.root.name}> not found in the ${part.label} sample`, rules: [], totals: {} }
    const walk = (tn, path) => {
      const node = index.get(path)
      if (node) {
        const attrs = Object.entries(tn.attrs).filter(([k]) => k !== 'xmlns' && !k.startsWith('xmlns'))
        if (!tn.children.length) run(node.vmf, node.name, node.attrs.length ? { Value: tn.text, ...Object.fromEntries(attrs) } : tn.text, path)
        for (const [k, v] of attrs) { const a = node.attrs.find((x) => x.name === k); if (a) run(a.vmf, a.name, v, `${path}/@${k}`) }
      }
      for (const c of tn.children) walk(c, `${path}/${c.name}`)
    }
    walk(start, `/${start.name}`)
  }

  const rows = rules.map((r) => {
    const s = stats.get(r)
    let status, note = ''
    if (r.error) { status = 'Not evaluated'; note = r.error }
    else if (s.failed) status = 'FAIL'
    else if (s.notEvaluated) { status = 'Not evaluated'; note = 'formula could not be run on some values' }
    else if (!s.checked) { status = 'Not used'; note = matched.get(r) ? 'field(s) exist in the message but are not in this sample (optional)' : 'no field in this message uses this type' }
    else status = 'Pass'
    return { name: r.name, errorCode: r.errorCode, severity: r.severity, scope: r.scope, set: r.set, fieldname: r.fieldname, formula: r.formula, message: r.message,
      usesFunctions: r.c?.usedUser || [], matchedFields: matched.get(r) || 0, checked: s.checked, passed: s.passed, failed: s.failed, status, note, examples: s.examples }
  })
  const unsupportedFunctions = [...new Set(rules.flatMap((r) => r.unknown || []))]
  const totals = {
    rules: rows.length, pass: rows.filter((r) => r.status === 'Pass').length, fail: rows.filter((r) => r.status === 'FAIL').length,
    notEvaluated: rows.filter((r) => r.status === 'Not evaluated').length, notUsed: rows.filter((r) => r.status === 'Not used').length,
    checks: rows.reduce((a, r) => a + r.checked, 0),
  }
  return { wellFormed: true, rules: rows, totals, unsupportedFunctions, implemented: Object.keys(FUNCTIONS) }
}
