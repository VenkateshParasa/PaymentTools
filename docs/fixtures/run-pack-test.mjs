// Node test for the Scenario Pack (lib/scenarioPack) against the mini fixture and a hand-written rules file.
// Run from the project root:  node docs/fixtures/run-pack-test.mjs
import fs from 'fs'
import JSZip from 'jszip'
import { parseXsdTree, buildModel } from '../../src/lib/xsd/xsdParser.js'
import { analyseCoverage, COVERAGE_HEADER } from '../../src/lib/mdrRules/coverage.js'
import { generateSample } from '../../src/lib/xsd/sampleGenerator.js'
import { learnProfile } from '../../src/lib/xsd/baseProfile.js'
import { buildPack, packSheets } from '../../src/lib/scenarioPack/buildPack.js'
import { pairwise } from '../../src/lib/scenarioPack/pairwise.js'
import { buildXlsx, buildZip } from '../../src/lib/scenarioPack/export.js'
import { xmlToTree } from '../../tools/mdr-rules/engine/nodeXml.js'

let fail = 0
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fail++ }

// pairwise: every pair of values is covered
const levels = [3, 2, 2, 4, 2, 2]
const pw = pairwise(levels, 500)
let missing = 0
for (let i = 0; i < levels.length; i++) for (let j = i + 1; j < levels.length; j++)
  for (let a = 0; a < levels[i]; a++) for (let b = 0; b < levels[j]; b++)
    if (!pw.tests.some((t) => t[i] === a && t[j] === b)) missing++
ok(missing === 0 && !pw.capped && pw.tests.length < 24, `pairwise covers all pairs with ${pw.tests.length} tests (full product = 192)`)
ok(pairwise([2, 2, 2], 2).capped, 'pairwise reports when the cap is hit')

const parsed = parseXsdTree(xmlToTree(fs.readFileSync(new URL('./mini-pacs.xsd', import.meta.url), 'utf8')))
const model = buildModel(parsed.schema, 'Document')
const rulesFile = {
  message: 'pacs.000.001.01',
  tags: { ChargeBearer: ['ChrgBr'], DebtorAccount: ['DbtrAcct'], Nested: ['Nested'] },
  codes: {},
  rules: [
    { id: 'DebtorAccountRule', name: 'DebtorAccountRule', kind: 'rule', text: 'If ChargeBearer is DEBT then DebtorAccount must be present.', automation: 'formal',
      condition: { when: { op: 'equals', path: '/ChargeBearer', value: 'DEBT' }, then: { op: 'mustPresent', path: '/DebtorAccount' } } },
    { id: 'NestedRule', name: 'NestedRule', kind: 'rule', text: 'If Nested is present then DebtorAccount must be absent.', automation: 'formal',
      condition: { when: { op: 'present', path: '/Nested' }, then: { op: 'mustAbsent', path: '/DebtorAccount' } } },
  ],
  valueConstraints: [],
}
const coverage = analyseCoverage(rulesFile, model, { plainXml: (m) => generateSample(model, { mode: m }).xml, parseXml: xmlToTree })

const base = `<Document xmlns="urn:test:mini:pacs.000.001.01"><FIToFICstmrCdtTrf><CdtTrfTxInf>
  <PmtId><EndToEndId>E2E-AB-0007</EndToEndId><InstrId>INSTR0001</InstrId></PmtId>
  <Dbtr><Nm>NmNmNmNmNmNmNmNmNmNmNmNmNmNmNmNmNmN</Nm><PrvtId>XYZ</PrvtId></Dbtr>
</CdtTrfTxInf></FIToFICstmrCdtTrf></Document>`
const profile = learnProfile([xmlToTree(base)], { model })

// guideline rules: one note row, no scenarios, no sample
const gRules = { ...rulesFile, rules: [...rulesFile.rules, { id: 'AdvisoryRule', name: 'AdvisoryRule', kind: 'guideline', text: 'Usage guideline: prefer SHAR.', automation: 'formal',
  condition: { when: { op: 'equals', path: '/ChargeBearer', value: 'DEBT' }, then: { op: 'mustPresent', path: '/DebtorAccount' } } }] }
const gp = await buildPack({ model, rulesFile: gRules, coverage, parseXml: xmlToTree })
const gRows = gp.scenarioRows.filter((r) => r[2] === 'AdvisoryRule')
ok(gRows.length === 1 && gRows[0][5] === 'Guideline (note only)' && gRows[0][16] === '' && /note only/.test(gRows[0][17]) && gp.summary.guidelines === 1, 'guideline: a single note row, no sample file, counted in the summary')
ok(!gp.files.some((f) => /AdvisoryRule/.test(f.name)) && gp.summary.mismatches === 0, 'guideline: no sample generated for it')
const run = (extra) => buildPack({ model, rulesFile, coverage, parseXml: xmlToTree, ...extra })
const pack = await run({})
const s = pack.summary
console.log(JSON.stringify(s))
ok(s.scenarios > 0 && s.withSample === s.scenarios, `every rule scenario got a full message (${s.withSample}/${s.scenarios})`)
ok(s.mismatches === 0, `rule engine confirms every expected Pass/Fail (mismatches: ${s.mismatches})`)
ok(pack.files.every((f) => f.xml.includes('<Document') && f.xml.includes('<GrpHdr>')), 'samples are complete messages (root + mandatory header present)')
ok(pack.scenarioRows.every((r) => r.length === pack.scenarioHeader.length), 'scenario rows match header width')
ok(new Set(pack.files.map((f) => f.name)).size === pack.files.length, 'file names are unique')
ok(s.combinations >= 3 && pack.comboRows.every((r) => r.length === pack.comboHeader.length), `combinations built: ${s.combinations} (factors ${s.factors})`)
ok(pack.comboRows.slice(1).every((r) => /Confirmed/.test(r[7])), 'every combination satisfies all rules (collateral repair)')
const all = pack.files.find((x) => x.name === 'ALL_Fields_sample.xml')?.xml || ''
const fullPlain = generateSample(model, { mode: 'full' }).xml
ok(all && ['<DbtrAcct>', '<Agt>', '<SplmtryData>', '<InstrId>'].every((t) => all.includes(t)), 'ALL_Fields_sample contains optional fields and sections')
ok(all.split('\n').length >= fullPlain.split('\n').length, 'ALL_Fields_sample is as complete as a plain full-mode sample')
ok(pack.comboRows[0][0] === 'ALL_FIELDS' && /rules ignored/.test(pack.comboRows[0][1]), 'ALL_Fields_sample listed on the Combinations sheet, rules not applied')
const scen = pack.files.filter((f) => /^S\d+_/.test(f.name))
ok(scen.every((f) => f.xml.includes('<Agt>') && f.xml.includes('<InstrId>')), 'rule scenario samples include optional fields and sections not touched by the rule')
const withAcct = scen.filter((f) => f.xml.includes('<DbtrAcct>')).length
ok(withAcct > 0 && withAcct < scen.length, `rule values applied on top: DbtrAcct present in ${withAcct}/${scen.length} scenario samples`)
const mand = await run({ scenarioMode: 'mandatory' })
ok(mand.files.filter((f) => /^S\d+_/.test(f.name)).every((f) => !f.xml.includes('<Agt>')) && mand.summary.mismatches === 0, 'scenarioMode=mandatory still available')
const neg = pack.scenarioRows.find((r) => r[5] === 'Negative')
ok(neg && /fails as expected/.test(neg[17]), 'negative scenario really violates its rule: ' + neg?.[17])

// no base sample + default options: realistic values, never NmNm... filler
ok(pack.files.every((f) => !/<Nm>(Nm){3,}/.test(f.xml)), 'realistic (default), no base sample: no NmNm... filler')
const seq = await run({ valueStyle: 'sequence' })
ok(seq.files.some((f) => /<Nm>(Nm){10,}/.test(f.xml)) && seq.summary.mismatches === 0, 'sequence style toggle: tag-name filler used, rules still confirmed')
// with a client base sample: counters advance across scenarios, 2nd choice branch followed
const p2 = await run({ profile })
ok(p2.summary.mismatches === 0 && p2.usageRows.length > 3, 'with base sample: still verified; usage sheet lists learned rules (' + p2.usageRows.length + ')')
const instr = p2.files.map((x) => x.xml.match(/<InstrId>(INSTR\d+)<\/InstrId>/)?.[1]).filter(Boolean)
ok(new Set(instr).size > 2 && instr.every((v) => /^INSTR\d{4}$/.test(v)), 'InstrId follows client counter, new number per sample: ' + instr.slice(0, 4).join(','))
ok(p2.files.every((x) => !x.xml.includes('<OrgId>') || x.name.startsWith('C')), 'client choice branch (PrvtId) used in rule scenarios')

// export
const xlsx = await buildXlsx(packSheets(p2, coverage, { coverage: COVERAGE_HEADER }))
const z = await JSZip.loadAsync(xlsx)
ok(Object.keys(z.files).includes('xl/worksheets/sheet1.xml') && Object.keys(z.files).length >= 9, 'xlsx has workbook, styles and 5 sheets')
const sheet1 = await z.file('xl/worksheets/sheet1.xml').async('string')
ok(sheet1.includes('S001') && !sheet1.includes('&amp;amp;'), 'xlsx scenario sheet holds the scenario rows')
const zip = await JSZip.loadAsync(await buildZip(p2.files))
ok(Object.keys(zip.files).length === p2.files.length, 'zip holds one XML per sample')
fs.mkdirSync('/tmp/pack-out', { recursive: true })
fs.writeFileSync('/tmp/pack-out/pack.xlsx', xlsx)
ok(p2.files.some((f) => /<Nm>(Nm){10,}/.test(f.xml)), 'with a base sample that uses NmNm..., that pattern is followed')
process.exit(fail ? 1 : 0)
