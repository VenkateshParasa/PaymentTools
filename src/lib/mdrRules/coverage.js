// Rule coverage analysis: for each MDR rule, can this project check it, fix it, or must it be handled
// manually? Pure functions (no DOM, no file access) so the page and the Node CLI share them.
import { bindRules, validateTree, planFix } from './ruleEngine.js'

const mk = (name) => ({ name, attrs: {}, children: [], text: '' })
function ensure(el, chain) { let cur = el; for (const t of chain) { let n = cur.children.find((c) => c.name === t); if (!n) { n = mk(t); cur.children.push(n) } cur = n } return cur }
function remove(el, chain) { if (!chain.length) return; let cur = el; for (const t of chain.slice(0, -1)) { cur = cur.children.find((c) => c.name === t); if (!cur) return } cur.children = cur.children.filter((c) => c.name !== chain.at(-1)) }
function buildContext(ctx) { const rootEl = mk(ctx.tagPath[0]); let cur = rootEl; for (const t of ctx.tagPath.slice(1)) { const n = mk(t); cur.children.push(n); cur = n } return { rootEl, el: cur } }
const T = (ctx, p) => ctx.targets[p]

export function makeTrue(e, el, ctx, codes) {
  switch (e.op) {
    case 'present': case 'mustPresent': ensure(el, T(ctx, e.path).chain); break
    case 'absent': case 'mustAbsent': remove(el, T(ctx, e.path).chain); break
    case 'equals': ensure(el, T(ctx, e.path).chain).text = codes[e.value] || e.value; break
    case 'anyEquals': ensure(el, T(ctx, e.path).chain).text = e.values[0]; break
    case 'ccyDiff': case 'ccyEq': {
      const a = ensure(el, T(ctx, e.path).chain), b = ensure(el, T(ctx, e.path2).chain)
      a.attrs[T(ctx, e.path).attr || 'Ccy'] = 'AAA'; b.attrs[T(ctx, e.path2).attr || 'Ccy'] = e.op === 'ccyEq' ? 'AAA' : 'BBB'; break
    }
    case 'and': e.args.forEach((a) => makeTrue(a, el, ctx, codes)); break
    case 'or': makeTrue(e.args[0], el, ctx, codes); break
  }
}
export function makeFalse(e, el, ctx, codes) {
  switch (e.op) {
    case 'present': case 'mustPresent': case 'equals': case 'anyEquals': case 'ccyDiff': case 'ccyEq': remove(el, T(ctx, e.path).chain); break
    case 'absent': case 'mustAbsent': ensure(el, T(ctx, e.path).chain).text = 'X'; break
    case 'and': makeFalse(e.args[0], el, ctx, codes); break
    case 'or': e.args.forEach((a) => makeFalse(a, el, ctx, codes)); break
  }
}

const SUPPORTED = new Set(['present', 'absent', 'mustPresent', 'mustAbsent', 'equals', 'anyEquals', 'ccyDiff', 'ccyEq', 'and', 'or'])
export const supported = (e) => !e || (SUPPORTED.has(e.op) && (e.args || []).every(supported))
const statusOf = (rulesFile, b1, tree) => validateTree(tree, [b1], rulesFile).rules[0].status

export function syntheticTests(b, rulesFile) {
  const r = b.rule, codes = rulesFile.codes || {}, ctx = b.contexts[0]
  const out = { validPass: null, invalidFail: null, notApplicable: null, fixResolves: null, actions: '' }
  const iso = { rule: r, contexts: [ctx] }
  const fresh = () => { const c = buildContext(ctx); if (r.condition.when) makeTrue(r.condition.when, c.el, ctx, codes); return c }
  { const c = fresh(); makeTrue(r.condition.then, c.el, ctx, codes); out.validPass = statusOf(rulesFile, iso, c.rootEl) === 'pass' }
  {
    const c = fresh(); makeFalse(r.condition.then, c.el, ctx, codes)
    out.invalidFail = statusOf(rulesFile, iso, c.rootEl) === 'fail'
    if (out.invalidFail) {
      const actions = planFix(r.condition.then, ctx, new Set()).filter((a) => !(a.type === 'exclude' && a.min >= 1))
      out.actions = actions.map((a) => `${a.type === 'include' ? 'add' : 'remove'} ${a.label}`).join('; ')
      if (!actions.length) out.fixResolves = false
      else { actions.forEach((a) => (a.type === 'include' ? ensure(c.el, a.chain) : remove(c.el, a.chain))); out.fixResolves = statusOf(rulesFile, iso, c.rootEl) === 'pass' }
    }
  }
  if (r.condition.when) { const c = buildContext(ctx); makeFalse(r.condition.when, c.el, ctx, codes); out.notApplicable = statusOf(rulesFile, iso, c.rootEl) === 'na' }
  return out
}

export const VALUE_INFO = {
  AnyBIC: ['Partially covered', 'XSD pattern checks the 8/11 character structure', 'BIC existence in the ISO 9362 registry is not checked', 'Use real BICs when a realistic sample matters'],
  BICFI: ['Partially covered', 'XSD pattern checks the 8/11 character structure', 'BIC existence in the ISO 9362 registry is not checked', 'Use real BICs when a realistic sample matters'],
  IBAN: ['Partially covered', 'XSD pattern checks length and character classes', 'Check digits (mod-97) are not verified', 'Use IBANs with valid check digits (DE89 3704 0044 0532 0130 00 is valid)'],
  Country: ['Not covered', 'XSD pattern accepts any two capital letters', 'Needs the ISO 3166 list', 'Review country codes manually'],
  ActiveCurrency: ['Not covered', 'XSD pattern accepts any three capital letters', 'Needs the ISO 4217 active currency list', 'Review currency codes manually'],
  ActiveOrHistoricCurrency: ['Not covered', 'XSD pattern accepts any three capital letters', 'Needs the ISO 4217 active and historic list', 'Review currency codes manually'],
  CurrencyAmount: ['Not covered', 'XSD limits total and fraction digits generically', 'Needs fraction digits per currency (for example JPY 0, BHD 3)', 'Review amounts per currency manually'],
}

export const COVERAGE_HEADER = ['Message', 'Rule name', 'Rule type', 'Rule text (MDR PDF)', 'Source form', 'Coverage', 'Reason', 'Auto-check', 'Auto-fix', 'Fix actions',
  'Self-test: valid case passes', 'Self-test: invalid case fails', 'Self-test: not-applicable case', 'Bound contexts', 'Plain generated sample (no rules applied)', 'Scenarios', 'Manual action needed']
export const VALUE_HEADER = ['Message', 'Constraint', 'Text (MDR PDF)', 'Coverage', 'What the XSD already checks', 'What is not checked', 'Manual action needed']

// opts: { plainXml: (mode) => xml, parseXml: (xml) => tree, scenarioCounts?: { [rule]: string } }
export function analyseCoverage(rulesFile, model, opts) {
  const id = rulesFile.message
  const bound = bindRules(rulesFile, model)
  const plain = {}
  for (const mode of ['mandatory', 'full']) {
    const v = validateTree(opts.parseXml(opts.plainXml(mode)), bound, rulesFile)
    plain[mode] = Object.fromEntries(v.rules.map((x) => [x.name, x.status]))
  }
  const rows = []
  const counts = { Covered: 0, 'Partially covered': 0, 'Not covered': 0 }
  for (const b of bound) {
    const r = b.rule
    let cov, reason, manual = '', t = null
    if (r.kind === 'guideline') { cov = 'Not covered'; reason = 'Guideline (advisory): the PDF gives a recommendation, not a hard rule'; manual = 'Review manually; no automated check or change' }
    else if (!r.condition) { cov = 'Not covered'; reason = 'Rule is written as free text only (no formal condition)'; manual = 'Needs a manual check or a hand-written handler' }
    else if (!supported(r.condition.when) || !supported(r.condition.then)) { cov = 'Not covered'; reason = 'Condition uses an operator the engine does not support'; manual = 'Needs a special handler' }
    else if (!b.contexts.length) { cov = 'Not covered'; reason = 'Elements of the rule were not found in this XSD (version mismatch?)'; manual = 'Check the element names against the XSD' }
    else {
      t = syntheticTests(b, rulesFile)
      const detect = t.validPass && t.invalidFail && t.notApplicable !== false
      if (!detect) { cov = 'Not covered'; reason = 'Self-test failed: the engine does not detect this rule correctly'; manual = 'Needs a fix in the engine before relying on it' }
      else if (!t.fixResolves) { cov = 'Partially covered'; reason = 'Violations are detected, but there is no safe automatic fix'; manual = 'Fix samples manually when this rule fails' }
      else { cov = 'Covered'; reason = r.automation === 'prose' ? 'Detected and fixed automatically (condition taken from the rule sentence)' : 'Detected and fixed automatically (formal condition in the PDF)' }
      if (cov === 'Covered' && /\bis optional\b|may be present to/i.test(r.text)) { cov = 'Partially covered'; reason = 'Only the formal condition is enforced; the rule text also describes optional cases that are not checked'; manual = 'Review the optional cases manually' }
    }
    counts[cov]++
    rows.push({
      rule: r.name, cells: [id, r.name, r.kind === 'guideline' ? 'Guideline' : 'Hard rule', r.text, r.automation, cov, reason,
        t ? 'Yes' : 'No', t ? (t.fixResolves ? 'Yes' : 'No') : 'No', t ? t.actions : '',
        t ? (t.validPass ? 'Pass' : 'FAIL') : '', t ? (t.invalidFail ? 'Pass' : 'FAIL') : '', t ? (t.notApplicable === null ? 'n/a' : t.notApplicable ? 'Pass' : 'FAIL') : '',
        b.contexts.length, ['mandatory', 'full'].map((m) => `${m}: ${plain[m][r.name]}`).join(' | '), opts.scenarioCounts?.[r.name] || '', manual],
      coverage: cov, reason, manual, automatable: !!t,
    })
  }
  const order = { 'Not covered': 0, 'Partially covered': 1, Covered: 2 }
  rows.sort((a, b) => order[a.coverage] - order[b.coverage] || a.rule.localeCompare(b.rule))
  const valueRows = (rulesFile.valueConstraints || []).map((v) => {
    const info = VALUE_INFO[v.name] || ['Not covered', 'Not analysed', 'No automated check for this constraint', 'Review manually']
    return { name: v.name, cells: [id, v.name, v.text, info[0], info[1], info[2], info[3]], coverage: info[0] }
  })
  return { rows, valueRows, counts, bound }
}
