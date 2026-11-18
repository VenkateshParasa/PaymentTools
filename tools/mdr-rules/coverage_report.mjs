#!/usr/bin/env node
// Command-line version of the "Rules & scenarios" page: writes the same CSV files.
//
//   node tools/mdr-rules/coverage_report.mjs <xsd-file | folder-of-xsds> [--rules <dir>] [--out <dir>]
//
// Defaults: rules = src/content/schemas/rules, out = docs/rule-coverage.
// Prerequisite: rules JSON from the page ("Download rules JSON") or
//               python3 tools/mdr-rules/extract_rules.py <MDR Part 2 PDF>
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseXsdTree, buildModel } from '../../src/lib/xsd/xsdParser.js'
import { generateSample } from '../../src/lib/xsd/sampleGenerator.js'
import { analyseCoverage, COVERAGE_HEADER, VALUE_HEADER } from '../../src/lib/mdrRules/coverage.js'
import { generateScenarios, scenarioCounts } from '../../src/lib/mdrRules/scenarios.js'
import { toCsv } from '../../src/lib/mdrRules/csv.js'
import { xmlToTree } from './engine/nodeXml.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const input = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')))
if (!input) { console.log('Usage: node tools/mdr-rules/coverage_report.mjs <xsd | folder> [--rules dir] [--out dir]'); process.exit(1) }
const rulesDir = flag('--rules', path.join(root, 'src/content/schemas/rules'))
const outDir = flag('--out', path.join(root, 'docs/rule-coverage'))
fs.mkdirSync(outDir, { recursive: true })
const xsds = fs.statSync(input).isDirectory() ? fs.readdirSync(input).filter((f) => f.endsWith('.xsd')).map((f) => path.join(input, f)) : [input]

const summary = []
for (const xsdPath of xsds) {
  const id = path.basename(xsdPath, '.xsd')
  const rulesPath = path.join(rulesDir, id + '.json')
  if (!fs.existsSync(rulesPath)) { console.log(`SKIP ${id}: no rules file`); continue }
  const rulesFile = JSON.parse(fs.readFileSync(rulesPath, 'utf8'))
  const parsed = parseXsdTree(xmlToTree(fs.readFileSync(xsdPath, 'utf8')))
  const model = buildModel(parsed.schema, parsed.roots[0])
  const plainXml = (mode) => generateSample(model, { mode }).xml
  let cov = analyseCoverage(rulesFile, model, { plainXml, parseXml: xmlToTree })
  const sc = generateScenarios(rulesFile, model, cov.rows)
  cov = analyseCoverage(rulesFile, model, { plainXml, parseXml: xmlToTree, scenarioCounts: scenarioCounts(sc.rows) })
  fs.writeFileSync(path.join(outDir, `${id}-rule-coverage.csv`), toCsv(COVERAGE_HEADER, cov.rows.map((r) => r.cells)))
  fs.writeFileSync(path.join(outDir, `${id}-value-constraints.csv`), toCsv(VALUE_HEADER, cov.valueRows.map((r) => r.cells)))
  fs.writeFileSync(path.join(outDir, `${id}-rule-scenarios-generated.csv`), toCsv(sc.header, sc.rows))
  summary.push([id, rulesFile.rules.length, cov.counts.Covered, cov.counts['Partially covered'], cov.counts['Not covered'], rulesFile.rules.filter((r) => r.kind === 'guideline').length, cov.valueRows.length, sc.rows.length])
  console.log(`${id}: ${rulesFile.rules.length} rules | covered ${cov.counts.Covered} | partial ${cov.counts['Partially covered']} | not covered ${cov.counts['Not covered']} | generated scenarios ${sc.rows.length}`)
}
fs.writeFileSync(path.join(outDir, 'summary.csv'), toCsv(['Message', 'Rules + guidelines', 'Covered', 'Partially covered', 'Not covered', 'Of which guidelines', 'Value constraints listed', 'Generated scenario rows'], summary))
console.log('Reports written to', outDir)
