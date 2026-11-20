import { Fragment, useMemo, useState } from 'react'
import { Download, FileUp, Loader2, ListChecks } from 'lucide-react'
import { parseXsdText, buildModel } from '../lib/xsd/xsdParser.js'
import { generateSample } from '../lib/xsd/sampleGenerator.js'
import { extractPdfPages, browserInflate } from '../lib/mdrRules/pdfText.js'
import { extractAllMessages } from '../lib/mdrRules/extractRules.js'
import { analyseCoverage, COVERAGE_HEADER, VALUE_HEADER } from '../lib/mdrRules/coverage.js'
import { generateScenarios, scenarioCounts } from '../lib/mdrRules/scenarios.js'
import { xmlToTree } from '../lib/mdrRules/domXml.js'
import { toCsv } from '../lib/mdrRules/csv.js'

const COV_STYLE = {
  Covered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  'Partially covered': 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'Not covered': 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}
const RES_STYLE = { Pass: 'text-emerald-600', Fail: 'text-red-600' }
const inputCls = 'rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900'

function download(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
const messageId = (ns) => (ns || '').match(/([a-z]+\.\d{3}\.\d{3}\.\d{2})$/)?.[1] || null

export default function RulesScenariosPage() {
  const [xsdFile, setXsdFile] = useState(null)
  const [pdfFile, setPdfFile] = useState(null)
  const [rulesFileInput, setRulesFileInput] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [tab, setTab] = useState('coverage')
  const [covFilter, setCovFilter] = useState('all')
  const [ruleFilter, setRuleFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [open, setOpen] = useState(null)

  const analyse = async () => {
    setError(''); setResult(null); setOpen(null)
    try {
      if (!xsdFile) throw new Error('Choose the message XSD first.')
      setBusy('Reading the XSD…')
      const parsed = parseXsdText(await xsdFile.text())
      if (!parsed.ok) throw new Error(parsed.error)
      const model = buildModel(parsed.schema, parsed.roots[0])
      const id = messageId(model.targetNamespace)
      if (!id) throw new Error('Could not read the message id (for example pacs.008.001.14) from the XSD namespace.')

      let rulesFile = null
      if (rulesFileInput) {
        rulesFile = JSON.parse(await rulesFileInput.text())
        if (rulesFile.message !== id) throw new Error(`The rules JSON is for ${rulesFile.message}, but the XSD is ${id}.`)
      } else {
        if (!pdfFile) throw new Error('Choose the MDR Part 2 PDF (or a rules JSON you downloaded earlier).')
        setBusy('Reading the PDF (about a few seconds)…')
        const pages = await extractPdfPages(await pdfFile.arrayBuffer(), browserInflate, (p) => setBusy(`Reading the PDF… ${Math.round(p * 100)}%`))
        const all = extractAllMessages(pages, [id])
        rulesFile = all[id]
        if (!rulesFile) throw new Error(`This PDF has no constraints section for ${id}. Use the MDR Part 2 PDF that matches the XSD version.`)
      }

      setBusy('Checking rules and building scenarios…')
      await new Promise((r) => setTimeout(r, 30))
      const plainXml = (mode) => generateSample(model, { mode }).xml
      let cov = analyseCoverage(rulesFile, model, { plainXml, parseXml: xmlToTree })
      const sc = generateScenarios(rulesFile, model, cov.rows)
      cov = analyseCoverage(rulesFile, model, { plainXml, parseXml: xmlToTree, scenarioCounts: scenarioCounts(sc.rows) })
      setResult({ id, rulesFile, cov, sc })
      setTab('coverage')
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy('')
    }
  }

  const covRows = useMemo(() => (result ? result.cov.rows.filter((r) => covFilter === 'all' || r.coverage === covFilter) : []), [result, covFilter])
  const scRows = useMemo(() => (result ? result.sc.rows.filter((r) => (ruleFilter === 'all' || r[2] === ruleFilter) && (typeFilter === 'all' || r[5] === typeFilter)) : []), [result, ruleFilter, typeFilter])
  const ruleNames = useMemo(() => (result ? [...new Set(result.sc.rows.map((r) => r[2]))] : []), [result])
  const types = useMemo(() => (result ? [...new Set(result.sc.rows.map((r) => r[5]))] : []), [result])

  const files = result && {
    cov: [`${result.id}-rule-coverage.csv`, toCsv(COVERAGE_HEADER, result.cov.rows.map((r) => r.cells))],
    sc: [`${result.id}-rule-scenarios.csv`, toCsv(result.sc.header, result.sc.rows)],
    val: [`${result.id}-value-constraints.csv`, toCsv(VALUE_HEADER, result.cov.valueRows.map((r) => r.cells))],
    json: [`${result.id}.rules.json`, JSON.stringify(result.rulesFile, null, 1)],
  }
  const dl = (k) => download(files[k][0], files[k][1], k === 'json' ? 'application/json' : 'text/csv')

  const picker = (label, accept, file, setFile) => (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600">
      <FileUp size={15} /> <span className="font-medium">{label}</span>
      <span className="truncate text-slate-500">{file ? file.name : 'choose file'}</span>
      <input type="file" accept={accept} className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
    </label>
  )

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800 dark:text-slate-100"><ListChecks className="text-brand-600" /> Rules &amp; Scenarios</h1>
        <p className="mt-1 text-sm text-slate-500">
          Load a message XSD and the ISO 20022 MDR Part 2 PDF. The tool reads that message's constraints, tells you which ones can be checked and fixed automatically,
          and builds valid / invalid scenarios with sample XML. Everything runs in your browser; files are not uploaded.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {picker('XSD', '.xsd,.xml', xsdFile, setXsdFile)}
          {picker('MDR PDF', '.pdf', pdfFile, setPdfFile)}
          {picker('or rules JSON', '.json', rulesFileInput, setRulesFileInput)}
          <button onClick={analyse} disabled={!!busy} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : null} Analyse
          </button>
        </div>
        {busy && <p className="mt-2 text-sm text-slate-500">{busy}</p>}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        {result && (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[['Message', result.id], ['Rules + guidelines', result.rulesFile.rules.length], ['Covered', result.cov.counts.Covered], ['Partially covered', result.cov.counts['Partially covered']], ['Not covered', result.cov.counts['Not covered']]].map(([l, v]) => (
                <div key={l} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-bold">{v}</div></div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-500">{result.sc.rows.length} scenario rows ({result.sc.stats.manual} rules need manual scenarios, {result.sc.stats.guidelines} guidelines noted only). Download:</span>
              {[['cov', 'Coverage CSV'], ['sc', 'Scenarios CSV'], ['val', 'Value constraints CSV'], ['json', 'Rules JSON']].map(([k, l]) => (
                <button key={k} onClick={() => dl(k)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-600"><Download size={14} /> {l}</button>
              ))}
            </div>

            <div className="mt-4 flex gap-2">
              {[['coverage', 'Coverage'], ['scenarios', 'Scenarios'], ['values', 'Value constraints']].map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} className={`rounded-full border px-3 py-1 text-sm ${tab === k ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-slate-600'}`}>{l}</button>
              ))}
            </div>

            {tab === 'coverage' && (
              <div className="mt-3">
                <select className={inputCls} value={covFilter} onChange={(e) => setCovFilter(e.target.value)}>
                  <option value="all">All coverage</option><option>Covered</option><option>Partially covered</option><option>Not covered</option>
                </select>
                <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800"><tr><th className="p-2">Rule</th><th className="p-2">Type</th><th className="p-2">Coverage</th><th className="p-2">Reason</th><th className="p-2">Scenarios</th><th className="p-2">Manual action</th></tr></thead>
                    <tbody>
                      {covRows.map((r) => (
                        <tr key={r.rule} className="border-t border-slate-200 align-top dark:border-slate-700">
                          <td className="p-2"><div className="font-mono text-xs">{r.rule}</div><div className="mt-1 text-xs text-slate-500">{r.cells[3]}</div></td>
                          <td className="p-2 text-xs">{r.cells[2]}</td>
                          <td className="p-2"><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${COV_STYLE[r.coverage]}`}>{r.coverage}</span></td>
                          <td className="p-2 text-xs">{r.reason}</td>
                          <td className="p-2 text-xs">{r.cells[15]}</td>
                          <td className="p-2 text-xs">{r.manual}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'scenarios' && (
              <div className="mt-3">
                <div className="flex flex-wrap gap-2">
                  <select className={inputCls} value={ruleFilter} onChange={(e) => setRuleFilter(e.target.value)}><option value="all">All rules</option>{ruleNames.map((n) => <option key={n}>{n}</option>)}</select>
                  <select className={inputCls} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="all">All types</option>{types.map((n) => <option key={n}>{n}</option>)}</select>
                  <span className="self-center text-xs text-slate-500">{scRows.length} rows. Click a row for the sample XML and the reason.</span>
                </div>
                <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800"><tr><th className="p-2">ID</th><th className="p-2">Rule</th><th className="p-2">Type</th><th className="p-2">Fields/sections included</th><th className="p-2">Expected</th></tr></thead>
                    <tbody>
                      {scRows.map((r) => (
                        <Fragment key={r[0]}>
                          <tr onClick={() => setOpen(open === r[0] ? null : r[0])} className="cursor-pointer border-t border-slate-200 align-top hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                            <td className="p-2 text-xs">{r[0]}</td><td className="p-2 font-mono text-xs">{r[2]}</td><td className="p-2 text-xs">{r[5]}</td>
                            <td className="p-2 text-xs">{r[9] || r[6]}</td><td className={`p-2 text-xs font-semibold ${RES_STYLE[r[11]] || ''}`}>{r[11]}</td>
                          </tr>
                          {open === r[0] && (
                            <tr className="bg-slate-50 dark:bg-slate-800/50">
                              <td colSpan={5} className="p-3 text-xs">
                                <div><b>Fields:</b> {r[6]}</div>
                                <div className="mt-1"><b>Rule text:</b> {r[8]}</div>
                                <div className="mt-1"><b>Expected outcome, why?</b> {r[10]}</div>
                                {r[14] && r[14] !== 'none' && <div className="mt-1"><b>Generator action:</b> {r[14]}</div>}
                                {r[7] && <pre className="mt-2 overflow-auto rounded bg-slate-900 p-2 text-slate-100">{r[7]}</pre>}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'values' && (
              <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800"><tr><th className="p-2">Constraint</th><th className="p-2">Coverage</th><th className="p-2">XSD already checks</th><th className="p-2">Not checked</th><th className="p-2">Manual action</th></tr></thead>
                  <tbody>
                    {result.cov.valueRows.map((r) => (
                      <tr key={r.name} className="border-t border-slate-200 align-top dark:border-slate-700">
                        <td className="p-2 font-mono text-xs">{r.name}</td>
                        <td className="p-2"><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${COV_STYLE[r.coverage]}`}>{r.coverage}</span></td>
                        <td className="p-2 text-xs">{r.cells[4]}</td><td className="p-2 text-xs">{r.cells[5]}</td><td className="p-2 text-xs">{r.cells[6]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
