// XSD (+ MDR PDF or a rules JSON) -> { id, model, rulesFile, coverage }. Same steps as the Rules & Scenarios page.
import { parseXsdText, buildModel } from '../xsd/xsdParser.js'
import { generateSample } from '../xsd/sampleGenerator.js'
import { extractPdfPages, browserInflate } from '../mdrRules/pdfText.js'
import { extractAllMessages } from '../mdrRules/extractRules.js'
import { analyseCoverage } from '../mdrRules/coverage.js'
import { generateScenarios, scenarioCounts } from '../mdrRules/scenarios.js'
import { xmlToTree } from '../mdrRules/domXml.js'

export const messageIdOf = (ns) => (ns || '').match(/([a-z]+\.\d{3}\.\d{3}\.\d{2})$/)?.[1] || null

export async function loadInputs({ xsdFile, pdfFile, rulesJsonFile, onStatus = () => {} }) {
  if (!xsdFile) throw new Error('Choose the message XSD first.')
  onStatus('Reading the XSD…')
  const parsed = parseXsdText(await xsdFile.text())
  if (!parsed.ok) throw new Error(parsed.error)
  const model = buildModel(parsed.schema, parsed.roots[0])
  const id = messageIdOf(model.targetNamespace)
  if (!id) throw new Error('Could not read the message id (for example pacs.008.001.14) from the XSD namespace.')

  let rulesFile
  if (rulesJsonFile) {
    rulesFile = JSON.parse(await rulesJsonFile.text())
    if (rulesFile.message !== id) throw new Error(`The rules JSON is for ${rulesFile.message}, but the XSD is ${id}.`)
  } else {
    if (!pdfFile) throw new Error('Choose the MDR Part 2 PDF (or a rules JSON you downloaded earlier).')
    onStatus('Reading the PDF…')
    const pages = await extractPdfPages(await pdfFile.arrayBuffer(), browserInflate, (p) => onStatus(`Reading the PDF… ${Math.round(p * 100)}%`))
    rulesFile = extractAllMessages(pages, [id])[id]
    if (!rulesFile) throw new Error(`This PDF has no constraints section for ${id}. Use the MDR Part 2 PDF that matches the XSD version.`)
  }
  onStatus('Checking rules…')
  await new Promise((r) => setTimeout(r, 30))
  const plainXml = (mode) => generateSample(model, { mode }).xml
  let coverage = analyseCoverage(rulesFile, model, { plainXml, parseXml: xmlToTree })
  const sc = generateScenarios(rulesFile, model, coverage.rows)
  coverage = analyseCoverage(rulesFile, model, { plainXml, parseXml: xmlToTree, scenarioCounts: scenarioCounts(sc.rows) })
  return { id, model, rulesFile, coverage }
}
