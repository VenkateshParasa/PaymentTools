#!/usr/bin/env node
// Self-check for the Rules & Scenarios module (no installs).
//   node tools/mdr-rules/verify_all.mjs <MDR-Part2.pdf> <folder-of-xsds>
// 1. PDF text + rule extraction using the same browser code path (DecompressionStream).
// 2. Every generated scenario is re-checked with the rule engine: expected Pass/Fail must match.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { extractPdfPages, browserInflate } from '../../src/lib/mdrRules/pdfText.js'
import { extractAllMessages } from '../../src/lib/mdrRules/extractRules.js'
import { parseXsdTree, buildModel } from '../../src/lib/xsd/xsdParser.js'
import { generateSample } from '../../src/lib/xsd/sampleGenerator.js'
import { analyseCoverage } from '../../src/lib/mdrRules/coverage.js'
import { generateScenarios } from '../../src/lib/mdrRules/scenarios.js'
import { bindRules, validateTree } from '../../src/lib/mdrRules/ruleEngine.js'
import { xmlToTree } from './engine/nodeXml.js'

const [pdf, dir] = process.argv.slice(2)
if (!pdf || !dir) { console.log('Usage: node tools/mdr-rules/verify_all.mjs <pdf> <xsd-folder>'); process.exit(1) }
let bad = 0, total = 0
const pages = await extractPdfPages(fs.readFileSync(pdf), browserInflate)
const all = extractAllMessages(pages)
console.log(`PDF: ${pages.length} text blocks, ${Object.keys(all).length} messages`)
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.xsd'))) {
  const id = f.replace('.xsd', '')
  const rules = all[id]
  if (!rules) { console.log('no rules for', id); continue }
  const s = parseXsdTree(xmlToTree(fs.readFileSync(path.join(dir, f), 'utf8')))
  const model = buildModel(s.schema, s.roots[0])
  const cov = analyseCoverage(rules, model, { plainXml: (m) => generateSample(model, { mode: m }).xml, parseXml: xmlToTree })
  const sc = generateScenarios(rules, model, cov.rows)
  const bound = bindRules(rules, model)
  let mism = 0
  for (const r of sc.rows) {
    const [sid, , rule, , , type, , xml] = r
    if (!['Positive', 'Negative', 'Not applicable'].includes(type)) continue
    total++
    const b = bound.find((x) => x.rule.name === rule)
    const st = validateTree(xmlToTree(`<${model.root.name}>${xml}</${model.root.name}>`), [b], rules).rules[0].status
    if (type === 'Negative' ? st !== 'fail' : st === 'fail') { mism++; bad++; console.log('  MISMATCH', id, sid, rule, type, st) }
  }
  console.log(`${id}: rules ${rules.rules.length}, covered ${cov.counts.Covered}/${rules.rules.length}, scenario rows ${sc.rows.length}, mismatches ${mism}`)
}
console.log(`checked ${total} scenarios, ${bad} mismatches`)
process.exit(bad ? 1 : 0)
