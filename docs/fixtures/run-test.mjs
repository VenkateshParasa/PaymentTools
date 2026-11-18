// Node test for lib/xsd without a DOM: a minimal XML tokenizer builds the same
// generic tree that domToTree() produces in the browser.
// Run from v2/:  node docs/fixtures/run-test.mjs
import fs from 'fs'
import { parseXsdTree, buildModel, listChoices } from '../../src/lib/xsd/xsdParser.js'
import { learnProfile, choicesFromProfile, parseHints } from '../../src/lib/xsd/baseProfile.js'
import { generateSample } from '../../src/lib/xsd/sampleGenerator.js'

function xmlToTree(xml) {
  xml = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  const re = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g
  const stack = [{ children: [] }]
  let m
  while ((m = re.exec(xml))) {
    if (m[5] !== undefined) { const t = stack.at(-1); if (m[5].trim()) t.text = (t.text || '') + m[5].trim(); continue }
    const [, close, name, rawAttrs, self] = m
    if (close) { stack.pop(); continue }
    const attrs = {}
    for (const a of rawAttrs.matchAll(/([\w:.-]+)="([^"]*)"/g)) attrs[a[1].replace(/^.*:/, '')] = a[2]
    const node = { name: name.replace(/^.*:/, ''), attrs, children: [], text: '' }
    stack.at(-1).children.push(node)
    if (!self) stack.push(node)
  }
  return stack[0].children[0]
}

let fail = 0
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fail++ }

const parsed = parseXsdTree(xmlToTree(fs.readFileSync(new URL('./mini-pacs.xsd', import.meta.url), 'utf8')))
ok(parsed.ok && parsed.roots[0] === 'Document', 'parses XSD, root = Document')
const model = buildModel(parsed.schema, 'Document')
ok(listChoices(model.root).length === 2, 'finds 2 choice groups: ' + listChoices(model.root).map((c) => c.id).join(', '))

const min = generateSample(model, { mode: 'mandatory' })
console.log(min.xml)
ok(min.xml.includes('xmlns="urn:test:mini:pacs.000.001.01"'), 'namespace on root')
ok(min.xml.includes('<EndToEndId>') && min.xml.includes('<UETR>'), 'mandatory elements present')
ok(!min.xml.includes('<InstrId>') && !min.xml.includes('<DbtrAcct>') && !min.xml.includes('<Agt>'), 'optional elements absent in mandatory mode')
ok(/<UETR>[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}<\/UETR>/.test(min.xml), 'UETR matches UUIDv4 pattern')
ok(/<IntrBkSttlmAmt Ccy="EUR">15250\.00<\/IntrBkSttlmAmt>/.test(min.xml), 'amount with required Ccy attribute')
ok(min.xml.includes('<OrgId>') && !min.xml.includes('<PrvtId>'), 'choice resolves to first option')
ok(!min.xml.includes('<Nested>'), 'recursive optional skipped in mandatory mode')

const full = generateSample(model, { mode: 'full', repeat: 2, annotate: true, choices: { [listChoices(model.root)[0].id]: 1 } })
console.log(full.xml)
ok((full.xml.match(/<CdtTrfTxInf>/g) || []).length >= 2, 'repeat=2 yields repeated unbounded element')
ok(full.xml.includes('<PrvtId>'), 'choice override honoured')
ok(full.xml.includes('<!-- 0..1 -->') && full.xml.includes('<Nested/>'), 'annotations + recursive element stopped with a marker in full mode')
ok(/<BICFI>[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}/.test(full.xml), 'BIC hint fits pattern')
ok(full.warnings.length === 0, 'no warnings: ' + full.warnings.join('; '))
const nmId = '/Document/#sequence/FIToFICstmrCdtTrf/#sequence/CdtTrfTxInf/#sequence/Dbtr/#sequence/Nm'
const accId = '/Document/#sequence/FIToFICstmrCdtTrf/#sequence/CdtTrfTxInf/#sequence/DbtrAcct/#choice/Othr'
const ccyId = '/Document/#sequence/FIToFICstmrCdtTrf/#sequence/CdtTrfTxInf/#sequence/IntrBkSttlmAmt/@Ccy'
const cu = generateSample(model, { mode: 'mandatory', overrides: { [nmId]: 'Custom & Co', [accId]: 'ACC-77', [ccyId]: 'USD' } })
ok(cu.xml.includes('<Nm>Custom &amp; Co</Nm>'), 'custom value used (escaped), optional element forced in')
ok(cu.xml.includes('<DbtrAcct>') && cu.xml.includes('<Othr>ACC-77</Othr>') && !cu.xml.includes('<IBAN>'), 'custom value selects its choice branch and pulls in ancestors')
ok(cu.xml.includes('Ccy="USD"'), 'custom attribute value')
const bad = generateSample(model, { overrides: { '/Document/#sequence/FIToFICstmrCdtTrf/#sequence/CdtTrfTxInf/#sequence/ChrgBr': 'XXXX' } })
ok(bad.xml.includes('<ChrgBr>XXXX</ChrgBr>') && bad.warnings.length === 1, 'invalid custom value used as typed + warning')

// ---- client base sample (profile) ----
const base = `<Document xmlns="urn:test:mini:pacs.000.001.01"><FIToFICstmrCdtTrf><CdtTrfTxInf>
  <PmtId><EndToEndId>E2E-AB-0007</EndToEndId><InstrId>INSTR0001</InstrId></PmtId>
  <Dbtr><Nm>NmNmNmNmNmNmNmNmNmNmNmNmNmNmNmNmNmN</Nm><PrvtId>XYZ</PrvtId></Dbtr>
</CdtTrfTxInf></FIToFICstmrCdtTrf></Document>`
const prof = learnProfile([xmlToTree(base)], { model })
const nm = prof.byName.Nm.rule
ok(nm.kind === 'repeat' && nm.unit === 'Nm' && nm.len === 35 && nm.atMax, 'learns NmNm... repeat unit, at max length (35): ' + JSON.stringify(nm))
ok(prof.byName.InstrId.rule.kind === 'counter' && prof.byName.InstrId.rule.width === 4, 'learns zero-padded counter INSTR0001')
const pc = choicesFromProfile(model, prof)
ok(Object.values(pc).includes(1), 'client used the 2nd choice branch: ' + JSON.stringify(pc))
const g1 = generateSample(model, { mode: 'mandatory', profile: prof, choices: pc, iteration: 1, overrides: { [nmId]: '' }, adoptStructure: true })
const g3 = generateSample(model, { mode: 'mandatory', profile: prof, choices: pc, iteration: 3, adoptStructure: true })
ok(g1.xml.includes('<Nm>NmNmNmNmNmNmNmNmNmNmNmNmNmNmNmNmNmN</Nm>'), 'Nm filled to 35 chars from the client pattern')
ok(g1.xml.includes('<InstrId>INSTR0001</InstrId>') && g3.xml.includes('<InstrId>INSTR0003</InstrId>'), 'counter advances with the iteration (1 -> 3)')
ok(g1.xml.includes('<PrvtId>') && !g1.xml.includes('<OrgId>'), 'second choice branch followed from the client sample')
ok(g1.warnings.length === 0, 'no warnings: ' + g1.warnings.join('; '))
const same = generateSample(model, { mode: 'mandatory' }).xml === generateSample(model, { mode: 'mandatory', profile: null, hints: {}, iteration: 4 }).xml
ok(same, 'no profile / realistic = unchanged output')
const ts = generateSample(model, { mode: 'full', valueStyle: 'sequence' })
ok(/<InstrId>(InstrId)+/.test(ts.xml) && /<EndToEndId>(EndToEndId)+/.test(ts.xml) && /<BICFI>DEUTDEFF/.test(ts.xml) && /Ccy="EUR"/.test(ts.xml) && /<ChrgBr>SHAR/.test(ts.xml), 'sequence style leaves patterns/enums/codes realistic (BIC, Ccy, ChrgBr)')
ok(/<Nm>(Nm)+N?<\/Nm>/.test(ts.xml) && ts.xml.match(/<Nm>(.*)<\/Nm>/)[1].length === 35, 'sequence style: Nm repeated up to max length')
const hb = generateSample(model, { mode: 'full', hints: parseHints('BICFI length=8\nNm lengthPolicy=mid') })
ok(/<BICFI>DEUTDEFF<\/BICFI>/.test(hb.xml), 'hint: BIC 8 chars')
ok(hb.xml.match(/<Nm>(.*)<\/Nm>/)[1].length === 18, 'hint: Nm at half of max length')
// repeated unit with a number: AdrLine1AdrLine1... -> AdrLine2AdrLine2... in the next sample
const mini2 = learnProfile([{ name: 'Document', attrs: {}, text: '', children: [{ name: 'FIToFICstmrCdtTrf', attrs: {}, text: '', children: [{ name: 'CdtTrfTxInf', attrs: {}, text: '', children: [{ name: 'PmtId', attrs: {}, text: '', children: [{ name: 'InstrId', attrs: {}, text: 'InstrId1InstrId1InstrId1', children: [] }] }] }] }] }], { model })
const rc = mini2.byName.InstrId.rule
ok(rc.kind === 'repeatCounter' && rc.stem === 'InstrId' && rc.start === 1, 'learns AdrLine1AdrLine1 style (repeat + counter): ' + JSON.stringify(rc))
const i2 = generateSample(model, { mode: 'full', profile: mini2, iteration: 2 }).xml.match(/<InstrId>(.*)<\/InstrId>/)[1]
ok(i2.startsWith('InstrId2InstrId2') && i2.length <= 35, 'second sample advances the number: ' + i2)
process.exit(fail ? 1 : 0)
