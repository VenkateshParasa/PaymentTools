// Tests for the VMF module (lib/vmf). Run from the project root:  node docs/fixtures/run-vmf-test.mjs [path-to-xsd]
// 1. mini-pacs009.vmf: hand-written to mirror the real VMF layout (sections, facets, xmlType attribute, formulas in CDATA).
// 2. a full-size VMF generated from a real pacs.009 XSD (skipped if the XSD is not found).
import fs from 'fs'
import { parseVmfText } from '../../src/lib/vmf/vmfParser.js'
import { generateVmfSample, validateXml } from '../../src/lib/vmf/vmfSample.js'
import { compileFormula } from '../../src/lib/vmf/formula.js'
import { parseXmlTree } from '../../src/lib/vmf/xmlTree.js'
import { buildHybrid, compareStructures, parseXsdModel } from '../../src/lib/vmf/hybrid.js'
import { xsdToVmf } from './xsd-to-vmf.mjs'

let fail = 0
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fail++ }

// ---- XML reader ----
const t = parseXmlTree('<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "y">]><a xmlns:p="u" p:k="1" k="2"><!-- c --><b><![CDATA[x < y && z]]></b><c>a &amp; b</c></a>')
ok(t.children[0].text === 'x < y && z' && t.children[1].text === 'a & b' && t.attrs.k === '2' && t.attrsFull['p:k'] === '1', 'xml reader: CDATA, entities, comments, DOCTYPE, prefixed attributes')
ok((() => { try { parseXmlTree('<a><b></a>'); return false } catch { return true } })(), 'xml reader rejects mismatched tags')

// ---- formulas ----
const amt = compileFormula('if(!IsISOCurrencyCode($value.Ccy)) {\n return false;\n}\nreturn IsValidDecimals($value.Ccy, toText($value.Value, false));')
ok(amt.evaluate({ Ccy: 'EUR', Value: '10.25' }) && !amt.evaluate({ Ccy: 'JPY', Value: '10.5' }) && !amt.evaluate({ Ccy: 'ZZZ', Value: '1' }), 'currency+decimals formula (EUR 2dp ok, JPY 2dp fails, unknown currency fails)')

// ---- mini VMF ----
const mini = parseVmfText(fs.readFileSync(new URL('./mini-pacs009.vmf', import.meta.url), 'utf8'))
ok(mini.info.root === 'FICdtTrf' && mini.info.namespace.endsWith('pacs.009.001.08') && mini.info.standardName === 'pacs.009.001.08_CORE', 'reads message info and root FICdtTrf: ' + JSON.stringify(mini.info))
ok(mini.rules.length === 6 && new Set(mini.rules.map((r) => r.set)).size === 2, 'reads rules from several <validationrules> blocks (' + mini.rules.length + ')')
const msgId = mini.model.root.children[0].children[0].children[0].children[0]
ok(msgId.name === 'MsgId' && msgId.min === 1 && msgId.simple.maxLength === 35 && msgId.simple.patterns.length === 1 && msgId.vmf.xmlType.startsWith('HVPSPlus'), 'field facets, required and xmlType read')
const r = generateVmfSample(mini, { mode: 'mandatory' })
console.log(r.xml)
ok(r.report.wellFormed && r.report.totals.fail === 0, 'mandatory sample: no rule fails ' + JSON.stringify(r.report.totals))
ok(/<IntrBkSttlmAmt Ccy="[A-Z]{3}">/.test(r.xml) && r.report.rules.find((x) => x.name === 'CurrencyAmount').status === 'Pass', 'amount + currency pass the combined formula')
ok(r.report.rules.find((x) => x.name === 'NeedsLookup').status === 'Not evaluated' && r.report.unsupportedFunctions.includes('IsBusinessDay'), 'unknown function is reported, not guessed: ' + r.report.unsupportedFunctions)
const full = generateVmfSample(mini, { mode: 'full', wrapDocument: true })
ok(full.xml.includes('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.009.001.08">') && full.xml.includes('<BICFI>') && full.xml.includes('<Ctry>'), 'full sample wrapped in Document, optional fields present')
ok(full.report.totals.fail === 0 && full.report.rules.find((x) => x.name === 'Country').status === 'Pass' && full.report.rules.find((x) => x.name === 'BICFI').status === 'Pass', 'full sample passes BIC + country rules')
ok(full.report.rules.find((x) => x.name === 'MsgIdNoSlash').checked >= 2, 'rule on the shared xmlType (---copy suffix ignored) applied to several fields')

// a rule that cannot be satisfied is reported as FAIL, not hidden
const bad = parseVmfText(fs.readFileSync(new URL('./mini-pacs009.vmf', import.meta.url), 'utf8').replace('IsValidBIC($value)', 'IsValidBIC($value) && $value.length() > 20'))
const rb = generateVmfSample(bad, {})
ok(rb.report.totals.fail === 1 && rb.report.unsolved.length > 0, 'an unsatisfiable rule is reported (unsolved: ' + rb.report.unsolved + ')')

// ---- full-size VMF from a real XSD ----
const xsdPath = process.argv[2] || '/Users/venkateshparasa/Downloads/archive_payments_clearing_and_settlement_15_52355c2554/pacs.009.001.13.xsd'
if (fs.existsSync(xsdPath)) {
  const rules = `<validationrules name="Default"><datavalidationrules><fieldvalidations>
    <fieldvalidation><name>Ccy</name><fieldname>xmlType=ActiveCurrencyCode</fieldname><formula>IsISOCurrencyCode($value)</formula><severity>error</severity><error-code>D00006</error-code></fieldvalidation>
    <fieldvalidation><name>Amt</name><fieldname>xmlType=ActiveCurrencyAndAmount</fieldname><formula><![CDATA[if(!IsISOCurrencyCode($value.Ccy)) { return false; } return IsValidDecimals($value.Ccy, toText($value.Value, false));]]></formula><severity>error</severity><error-code>D00004</error-code></fieldvalidation>
    <fieldvalidation><name>BIC</name><fieldname>xmlType=BICFIDec2014Identifier</fieldname><formula>IsValidBIC($value)</formula><severity>error</severity><error-code>D00001</error-code></fieldvalidation>
    <fieldvalidation><name>Country</name><fieldname>xmlType=CountryCode</fieldname><formula>IsISOCountryCode($value)</formula><severity>error</severity><error-code>D00004</error-code></fieldvalidation>
  </fieldvalidations></datavalidationrules></validationrules>`
  const vmfText = xsdToVmf(fs.readFileSync(xsdPath, 'utf8'), rules)
  fs.writeFileSync('/tmp/pacs009-from-xsd.vmf', vmfText)
  const t0 = Date.now()
  const big = parseVmfText(vmfText)
  ok(big.info.root === 'FICdtTrf', `real-size VMF parsed (${(vmfText.length / 1024).toFixed(0)} KB, ${Date.now() - t0} ms)`)
  for (const [mode, wrap] of [['mandatory', false], ['full', false], ['full', true]]) {
    const g = generateVmfSample(big, { mode, wrapDocument: wrap })
    const lines = g.xml.split('\n').length
    const failed = g.report.rules.filter((x) => x.status === 'FAIL')
    ok(g.report.wellFormed && failed.length === 0 && g.report.unsolved.length === 0, `${mode}${wrap ? ' + Document' : ''}: ${lines} lines, checks ${g.report.totals.checks}, rules ${JSON.stringify(g.report.rules.map((x) => x.name + ':' + x.status + '/' + x.checked))}`)
    if (mode === 'full' && wrap) fs.writeFileSync('/tmp/pacs009-sample.xml', g.xml)
  }
} else console.log('SKIP full-size test (XSD not found: ' + xsdPath + ')')

// ---- functions defined in the VMF, header/trailer parts ----
const fx = parseVmfText(fs.readFileSync(new URL('./mini-pacs009-functions.vmf', import.meta.url), 'utf8'))
ok(fx.functions.length >= 3 && ['HasPrefix', 'IsRefOk'].every((n) => fx.functions.some((f) => f.name === n)), 'finds function definitions in the VMF: ' + fx.functions.map((f) => f.name || '(declarations)').join(', '))
ok(fx.parts.header.length === 1 && fx.parts.trailer.length === 1 && fx.parts.header[0].root.name === 'AppHdr', 'header and trailer fields are read like data fields')
const off = generateVmfSample(fx, { mode: 'mandatory' })
ok(off.parts.length === 1 && off.report.headerTrailer.state === 'off', 'header/trailer are left out unless the option is on')
const none = generateVmfSample(mini, { includeHeaderTrailer: true })
ok(none.parts.length === 1 && none.report.headerTrailer.state === 'none' && /ignored: there are no fields/.test(none.report.headerTrailer.message), 'option on, no header/trailer fields: "' + none.report.headerTrailer.message + '"')
const gf = generateVmfSample(fx, { mode: 'mandatory', includeHeaderTrailer: true })
ok(gf.report.headerTrailer.state === 'ok', 'option on, fields present and mapped: ' + gf.report.headerTrailer.message)
const brokenFx = parseVmfText(fs.readFileSync(new URL('./mini-pacs009-functions.vmf', import.meta.url), 'utf8').replace('$value.length() <= 12', '$value.length() > 40'))
const bad2 = generateVmfSample(brokenFx, { includeHeaderTrailer: true })
ok(bad2.report.headerTrailer.state === 'incomplete' && /incomplete or unreliable/.test(bad2.report.headerTrailer.message), 'option on, header cannot satisfy its rule: "' + bad2.report.headerTrailer.message + '" ' + JSON.stringify(bad2.report.headerTrailer.issues))
const noName = parseVmfText(fs.readFileSync(new URL('./mini-pacs009-functions.vmf', import.meta.url), 'utf8').replace('<name>BizMsgIdr</name>', '<name></name>').replace('>BizMsgIdr</xml-name>', '></xml-name>'))
ok(generateVmfSample(noName, { includeHeaderTrailer: true }).report.headerTrailer.state === 'incomplete', 'option on, a header field that cannot be read: reported incomplete')
console.log(gf.parts.map((x) => `--- ${x.label}\n${x.xml}`).join('\n'))
const fr = (n) => gf.report.rules.find((x) => x.name === n)
ok(fr('EndToEndRef').status === 'Pass' && /<EndToEndId>REF\d{5,}<\/EndToEndId>/.test(gf.xml), 'rule using VMF functions: value derived from the function code (pattern + prefix) -> ' + (gf.xml.match(/<EndToEndId>(.*?)</) || [])[1])
ok(fr('EndToEndRef').usesFunctions.includes('HasPrefix') && fr('EndToEndRef').usesFunctions.includes('IsRefOk'), 'report lists which VMF functions each rule uses (nested calls)')
ok(fr('RefFormat').status === 'Pass', 'loop-based VMF function (digit sum) evaluated: NbOfTxs = ' + (gf.xml.match(/<NbOfTxs>(.*?)</) || [])[1])
ok(fr('MissingFn').status === 'Not evaluated' && gf.report.unsupportedFunctions.includes('NoSuchFunction'), 'function that is neither in the VMF nor built in is reported')
ok(gf.report.functionNotes.some((x) => /IsValidBIC/.test(x)) && fr('BICFI').status === 'Pass', 'VMF function that depends on something unknown falls back to the built-in of the same name')
ok(gf.parts.length === 3 && gf.parts[0].label === 'Header' && /<BizMsgIdr>H-/.test(gf.parts[0].xml) && fr('HeaderRef').status === 'Pass', 'header rule applied to the header part only')
ok(gf.report.rules.find((x) => x.name === 'HeaderRef').checked === 1 && !gf.parts[2].xml.includes('H-'), 'header rules are not applied to trailer / data fields')

// ---- hybrid: structure from the XSD, rules from the VMF ----
if (fs.existsSync(xsdPath)) {
  const xsdModel = parseXsdModel(fs.readFileSync(xsdPath, 'utf8'))
  // 1. VMF mirrors the XSD (same version): every field is matched by path
  const same = parseVmfText(fs.readFileSync('/tmp/pacs009-from-xsd.vmf', 'utf8'))
  const h1 = buildHybrid(same, xsdModel)
  ok(h1.hybrid.name === 0 && h1.hybrid.type === 0 && h1.hybrid.path > 100, 'same-version VMF + XSD: all fields matched by path ' + JSON.stringify({ ...h1.hybrid, compare: undefined }))
  const g1 = generateVmfSample(h1, { mode: 'full', wrapDocument: true })
  ok(g1.report.wellFormed && g1.report.totals.fail === 0 && g1.report.unsolved.length === 0 && g1.report.totals.checks > 100, 'hybrid full sample passes all VMF rules (' + g1.report.totals.checks + ' checks)')
  ok(g1.xml.includes('<Document xmlns="' + xsdModel.targetNamespace + '">'), 'hybrid uses the XSD namespace for the Document wrapper')
  // 2. different versions: the hand-written pacs.009.001.08 VMF against the pacs.009.001.13 XSD
  const h2 = buildHybrid(mini, xsdModel)
  const cmp = compareStructures(mini, xsdModel)
  ok(cmp.common > 5 && cmp.onlyXsd.length > 50 && cmp.onlyVmf.length >= 0, `version compare: ${cmp.common} common, ${cmp.onlyVmf.length} only in VMF, ${cmp.onlyXsd.length} only in XSD`)
  const g2 = generateVmfSample(h2, { mode: 'full' })
  const st = (n) => g2.report.rules.find((x) => x.name === n)
  ok(g2.report.totals.fail === 0 && st('BICFI').checked > 0 && st('Country').checked > 0 && st('ActiveOrHistoricCurrency').checked > 0, 'different versions: VMF rules still applied to XSD fields (BICFI ' + st('BICFI').checked + ', Country ' + st('Country').checked + ', Ccy ' + st('ActiveOrHistoricCurrency').checked + ')')
  const gm = generateVmfSample(h2, { mode: 'mandatory' })
  ok(gm.report.totals.fail === 0 && gm.xml.includes('<FICdtTrf'), 'different versions, mandatory only: no failures')
  // 3. VMF-only structure still works unchanged
  ok(generateVmfSample(mini, { mode: 'mandatory' }).report.totals.fail === 0, 'VMF-only mode unchanged')
}
process.exit(fail ? 1 : 0)
