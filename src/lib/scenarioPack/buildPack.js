// Scenario Pack: every MDR rule scenario and a pairwise set of structural combinations, each turned
// into a COMPLETE message (not a fragment), checked with the rule engine, plus an optional client
// base sample that the generated values follow.
//
//   const pack = await buildPack({ model, rulesFile, coverage, parseXml, profile?, hints?, valueStyle?, maxCombos? })
//   -> { scenarioHeader, scenarioRows, comboHeader, comboRows, usageHeader, usageRows, summary, files, stats }
//
// parseXml(xmlString) -> generic tree ({ name, attrs, children, text }); browser: xmlToTree (domXml.js).
import { generateSample } from '../xsd/sampleGenerator.js'
import { listChoices } from '../xsd/xsdParser.js'
import { choicesFromProfile, describeRule, tagPathOf } from '../xsd/baseProfile.js'
import { generateScenarios } from '../mdrRules/scenarios.js'
import { bindRules, validateTree, planFix } from '../mdrRules/ruleEngine.js'
import { pairwise } from './pairwise.js'

export const SCENARIO_EXTRA = ['Sample file', 'Engine check', 'Generator notes']
export const COMBO_HEADER = ['Combination ID', 'Type', 'Choice selections', 'Optional elements present', 'Repeat counts', 'Expected result (Pass/Fail)', 'Sample file', 'Engine check', 'Generator notes']
export const USAGE_HEADER = ['Field (path)', 'What was learned from the base sample', 'Times seen', 'Distinct values', 'Length seen (min..max)']

const slug = (s) => String(s).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
const tick = () => new Promise((r) => setTimeout(r, 0))
const short = (id, n = 3) => tagPathOf(id).split('/').filter(Boolean).slice(-n).join('/')
const newSpec = (mode) => ({ mode, include: new Set(), exclude: new Set(), counts: {}, overrides: {}, choices: {}, lockedPresent: new Set(), lockedAbsent: new Set() })

export async function buildPack({ model, rulesFile, coverage, parseXml, profile = null, hints = {}, valueStyle = 'realistic', scenarioMode = 'full', maxCombos = 500, maxFactors = 800, onProgress = () => {} }) {
  const bound = bindRules(rulesFile, model)
  const sc = generateScenarios(rulesFile, model, coverage?.rows || [])
  const nodes = []
  const walk = (n) => { if (n.kind === 'element') nodes.push(n); for (const c of n.children || []) walk(c) }
  walk(model.root)

  const baseOpts = { mode: scenarioMode, profile, hints, valueStyle, adoptStructure: !!profile, choices: choicesFromProfile(model, profile) }
  const files = []
  const addFile = (name, xml) => { files.push({ name, xml }); return name }

  const failuresOf = (xml) => {
    try { return validateTree(parseXml(xml), bound, rulesFile).failures.filter((f) => f.bound.rule.kind !== 'guideline') }
    catch { return null }
  }

  // build one message from a spec; repair collateral rule failures (everything except the target rule)
  function make(spec, iteration, target) {
    const inc = new Set(spec.include), exc = new Set(spec.exclude)
    const notes = []
    let res, failed = []
    for (let k = 0; k < 5; k++) {
      res = generateSample(model, {
        ...baseOpts, ...(spec.mode ? { mode: spec.mode } : {}), choices: { ...baseOpts.choices, ...spec.choices },
        iteration, include: inc, exclude: exc, counts: spec.counts, overrides: spec.overrides,
      })
      const f = failuresOf(res.xml)
      if (f === null) { notes.push('Could not parse the generated XML for the rule check'); failed = []; break }
      failed = f
      let changed = false
      for (const x of failed.filter((y) => y.bound.rule.name !== target)) {
        for (const a of planFix(x.bound.rule.condition.then, x.ctx, exc)) {
          if (a.type === 'include' && !spec.lockedAbsent.has(a.id) && !inc.has(a.id)) { inc.add(a.id); exc.delete(a.id); changed = true; notes.push(`added ${a.label} (rule ${x.bound.rule.name})`) }
          else if (a.type === 'exclude' && a.min < 1 && !spec.lockedPresent.has(a.id) && !exc.has(a.id)) { exc.add(a.id); inc.delete(a.id); changed = true; notes.push(`removed ${a.label} (rule ${x.bound.rule.name})`) }
        }
      }
      if (!changed) break
    }
    for (const w of res.warnings.slice(0, 3)) notes.push(w)
    return { xml: res.xml, notes: [...new Set(notes)], failedNames: new Set(failed.map((f) => f.bound.rule.name)) }
  }

  function specFromState(st) {
    const sp = newSpec(scenarioMode)
    for (const e of st.values()) {
      const id = e.node.id
      if (e.mode === 'absent') { sp.exclude.add(id); sp.lockedAbsent.add(id); continue }
      sp.include.add(id); sp.lockedPresent.add(id)
      if (e.count > 1) sp.counts[id] = e.count
      if (e.value !== undefined && e.value !== '' && !(e.node.children || []).length) sp.overrides[id] = e.value
      for (const [k, v] of Object.entries(e.attrs || {})) sp.overrides[`${id}/@${k}`] = v
    }
    return sp
  }

  function specFromFragment(fragment) {
    const m = /<(\w+)((?:\s+\w+="[^"]*")*)\s*>([^<]*)<\/\1>/.exec(fragment || '')
    if (!m) return null
    const attrs = Object.fromEntries([...m[2].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]]))
    const node = nodes.find((n) => n.name === m[1] && !(n.children || []).length) || (m[1] === 'Amt' ? nodes.find((n) => (n.attrs || []).some((a) => a.name === 'Ccy')) : null)
    if (!node) return null
    const sp = newSpec(scenarioMode)
    sp.include.add(node.id); sp.lockedPresent.add(node.id)
    sp.overrides[node.id] = m[3]
    for (const [k, v] of Object.entries(attrs)) sp.overrides[`${node.id}/@${k}`] = v
    return sp
  }

  // ---- 1. rule scenarios -> full messages ----
  const scenarioRows = []
  const stats = { sampleContent: scenarioMode === 'full' ? 'all fields' : 'mandatory only', scenarios: sc.rows.length, withSample: 0, confirmed: 0, mismatches: 0, manual: 0, guidelines: 0, valueChecks: 0 }
  let iter = 0
  for (let i = 0; i < sc.rows.length; i++) {
    const row = sc.rows[i], meta = sc.meta[i]
    if (i % 5 === 0) { onProgress(i, sc.rows.length, 'Rule scenarios'); await tick() }
    let file = '', check = '', notes = ''
    if (meta.kind === 'guideline') { stats.guidelines++; check = 'Guideline: note only'; notes = 'No sample generated: guidelines are advisory.' }
    else if (meta.kind === 'manual') { stats.manual++; check = 'Manual needed'; notes = 'No sample generated: write this scenario by hand.' }
    else {
      const spec = meta.kind === 'rule' ? specFromState(meta.st) : specFromFragment(meta.fragment)
      if (!spec) { check = 'No sample'; notes = 'The value fragment does not map to an element of this message.' }
      else {
        const out = make(spec, ++iter, meta.kind === 'rule' ? meta.rule : null)
        file = addFile(`${row[0]}_${slug(meta.rule)}_${slug(row[5])}.xml`, out.xml)
        stats.withSample++
        if (meta.kind === 'rule') {
          const failed = out.failedNames.has(meta.rule)
          const ok = meta.expect === 'Fail' ? failed : !failed
          const others = [...out.failedNames].filter((n) => n !== meta.rule)
          check = ok ? (meta.expect === 'Fail' ? 'Confirmed: rule fails as expected' : 'Confirmed: rule satisfied') : `MISMATCH: expected ${meta.expect}, rule ${failed ? 'failed' : 'passed'}`
          if (others.length) check += `; other rules still failing: ${others.join(', ')}`
          ok ? stats.confirmed++ : stats.mismatches++
        } else { stats.valueChecks++; check = 'Value check (not covered by the rule engine)' }
        notes = out.notes.join('; ')
      }
    }
    scenarioRows.push([...row, file, check, notes])
  }

  // ---- 2. ALL_Fields sample + structural combinations (pairwise) ----
  const comboRows = []
  const factors = []
  for (const c of listChoices(model.root)) if (c.options.length > 1) factors.push({ kind: 'choice', id: c.id, options: c.options, levels: Math.min(c.options.length, 60) })
  for (const n of nodes) if (n !== model.root && n.min === 0 && !n.recursive) factors.push({ kind: 'opt', node: n, levels: 2 })
  for (const n of nodes) if (n.max > 1 && !n.recursive) factors.push({ kind: 'rep', node: n, levels: 2, many: Math.min(n.max, 3) })
  const factorsCut = Math.max(0, factors.length - maxFactors)
  factors.length = Math.min(factors.length, maxFactors)

  const addCombo = (label, type, spec, descr) => {
    const id = `C${String(comboRows.length + 1).padStart(3, '0')}`
    const out = make(spec, ++iter, null)
    const file = addFile(`${id}_${slug(label)}.xml`, out.xml)
    const bad = [...out.failedNames]
    comboRows.push([id, type, descr.choices, descr.opts, descr.reps, 'Pass', file, bad.length ? `Rules still failing: ${bad.join(', ')}` : 'Confirmed: no rule violated', out.notes.join('; ')])
  }
  // ALL_Fields_sample: every field and section of the XSD (first / client-chosen branch of each choice), values as the
  // generator or client sample gives them. Rules are NOT applied or repaired: it only has to satisfy the message schema.
  {
    const all = generateSample(model, { ...baseOpts, mode: 'full', iteration: 1, choices: baseOpts.choices })
    const bad = failuresOf(all.xml)
    addFile('ALL_Fields_sample.xml', all.xml)
    comboRows.push(['ALL_FIELDS', 'ALL_Fields_sample (XSD-valid only, rules ignored)', '(defaults)', 'all', '1', 'n/a (rules not applied)', 'ALL_Fields_sample.xml',
      bad === null ? 'Not checked' : bad.length ? `Informational: breaks ${[...new Set(bad.map((f) => f.bound.rule.name))].join(', ')}` : 'No rule violated', all.warnings.slice(0, 3).join('; ')])
  }
  addCombo('mandatory-only', 'Boundary: mandatory fields only', newSpec('mandatory'), { choices: '(defaults)', opts: 'none', reps: '1' })
  const pw = pairwise(factors.map((f) => f.levels), maxCombos)
  for (let t = 0; t < pw.tests.length; t++) {
    if (t % 5 === 0) { onProgress(t, pw.tests.length, 'Combinations'); await tick() }
    const test = pw.tests[t]
    const spec = newSpec('mandatory')
    const ch = [], op = [], rp = []
    factors.forEach((f, i) => {
      const v = test[i]
      if (f.kind === 'choice') { spec.choices[f.id] = v; ch.push(`${short(f.id, 2).replace(/\/?#?choice.*/, '')}=${f.options[v]}`) }
      else if (f.kind === 'opt') { if (v) { spec.include.add(f.node.id); op.push(short(f.node.id, 3)) } }
      else { spec.counts[f.node.id] = v ? f.many : 1; if (v) rp.push(`${short(f.node.id, 2)} x${f.many}`) }
    })
    addCombo('pairwise', 'Structural (pairwise)', spec, { choices: ch.join('; ') || '-', opts: op.join('; ') || 'none', reps: rp.join('; ') || 'all 1' })
  }

  // ---- 3. what was adopted from the base sample ----
  const usageRows = []
  if (profile) {
    for (const [path, e] of Object.entries(profile.byPath)) {
      if (!e.rule) continue
      usageRows.push([path, describeRule(e.rule), e.rule.n, e.rule.distinct, `${e.rule.minLen}..${e.rule.len}`])
    }
    const ch = choicesFromProfile(model, profile)
    for (const [id, idx] of Object.entries(ch)) usageRows.push([short(id, 4), `choice branch #${idx + 1} followed`, '', '', ''])
  } else usageRows.push(['(no base sample)', `Own conventions used${valueStyle === 'sequence' ? ' (sequence of tag names: NmNm.., AdrLine1AdrLine1.. to field length)' : ' (realistic values)'}`, '', '', ''])

  const summary = {
    ...stats,
    combinations: comboRows.length,
    factors: factors.length,
    pairs: pw.pairs,
    capped: pw.capped,
    factorsCut,
    files: files.length,
    baseSamples: profile?.files || 0,
  }
  onProgress(1, 1, 'Done')
  return { scenarioHeader: [...sc.header, ...SCENARIO_EXTRA], scenarioRows, comboHeader: COMBO_HEADER, comboRows, usageHeader: USAGE_HEADER, usageRows, summary, files }
}

// Sheets for buildXlsx()
export function packSheets(pack, coverage, header) {
  const summaryRows = Object.entries(pack.summary).map(([k, v]) => [k, String(v)])
  const sheets = [
    { name: 'Scenarios', header: pack.scenarioHeader, rows: pack.scenarioRows },
    { name: 'Combinations', header: pack.comboHeader, rows: pack.comboRows },
  ]
  if (coverage?.rows) sheets.push({ name: 'Rule coverage', header: header.coverage, rows: coverage.rows.map((r) => r.cells) })
  sheets.push({ name: 'Base sample usage', header: pack.usageHeader, rows: pack.usageRows })
  sheets.push({ name: 'Summary', header: ['Item', 'Value'], rows: summaryRows })
  return sheets
}
