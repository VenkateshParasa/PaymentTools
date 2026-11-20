import { useMemo, useState } from 'react'
import { Download, FileUp, Loader2, PackageCheck } from 'lucide-react'
import { loadInputs } from '../lib/scenarioPack/loadInputs.js'
import { buildPack, packSheets } from '../lib/scenarioPack/buildPack.js'
import { buildXlsx, buildZip } from '../lib/scenarioPack/export.js'
import { COVERAGE_HEADER } from '../lib/mdrRules/coverage.js'
import { toCsv } from '../lib/mdrRules/csv.js'
import { xmlToTree } from '../lib/mdrRules/domXml.js'
import { learnProfile, parseHints } from '../lib/xsd/baseProfile.js'
import { downloadBlob } from '../lib/download.js'

const inputCls = 'rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900'
const btn = 'inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600'
const RES = { Pass: 'text-emerald-600', Fail: 'text-red-600' }

function FilePick({ label, accept, multiple, files, onPick, optional }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white">
        <FileUp size={15} /> {label}
        <input type="file" accept={accept} multiple={multiple} className="hidden" onChange={(e) => { onPick(Array.from(e.target.files || [])); e.target.value = '' }} />
      </label>
      <span className="text-xs text-slate-500">{files.length ? files.map((f) => f.name).join(', ') : optional ? 'optional' : 'required'}</span>
    </div>
  )
}

export default function ScenarioPackPage() {
  const [xsd, setXsd] = useState([])
  const [pdf, setPdf] = useState([])
  const [rulesJson, setRulesJson] = useState([])
  const [bases, setBases] = useState([])
  const [valueStyle, setValueStyle] = useState('realistic')
  const [scenarioMode, setScenarioMode] = useState('full')
  const [hintText, setHintText] = useState('')
  const [maxCombos, setMaxCombos] = useState(200)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [out, setOut] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [openFile, setOpenFile] = useState('')

  const build = async () => {
    setError(''); setOut(null); setOpenFile('')
    try {
      const inputs = await loadInputs({ xsdFile: xsd[0], pdfFile: pdf[0], rulesJsonFile: rulesJson[0], onStatus: setBusy })
      let profile = null
      if (bases.length) {
        setBusy('Learning from the base sample(s)…')
        profile = learnProfile(await Promise.all(bases.map(async (f) => xmlToTree(await f.text()))), { model: inputs.model })
      }
      const pack = await buildPack({
        ...inputs, parseXml: xmlToTree, profile, hints: parseHints(hintText), valueStyle, scenarioMode, maxCombos,
        onProgress: (i, n, label) => setBusy(`${label}… ${Math.min(i, n)}/${n}`),
      })
      setOut({ ...inputs, pack })
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy('')
    }
  }

  const types = useMemo(() => (out ? [...new Set(out.pack.scenarioRows.map((r) => r[5]))] : []), [out])
  const rows = useMemo(() => (out ? out.pack.scenarioRows.filter((r) => typeFilter === 'all' || r[5] === typeFilter) : []), [out, typeFilter])
  const fileMap = useMemo(() => new Map((out?.pack.files || []).map((f) => [f.name, f.xml])), [out])

  const base = out ? out.id : 'pack'
  const dlXlsx = async () => downloadBlob(`${base}-scenario-pack.xlsx`, await buildXlsx(packSheets(out.pack, out.coverage, { coverage: COVERAGE_HEADER })), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  const dlZip = async () => downloadBlob(`${base}-samples.zip`, await buildZip(out.pack.files), 'application/zip')
  const dlCsv = () => downloadBlob(`${base}-scenarios.csv`, toCsv(out.pack.scenarioHeader, out.pack.scenarioRows), 'text/csv;charset=utf-8')
  const s = out?.pack.summary

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800 dark:text-slate-100"><PackageCheck className="text-brand-600" /> Scenario Pack</h1>
        <p className="mt-1 text-sm text-slate-500">
          Load the XSD and the MDR Part 2 PDF. You get an Excel file with every rule scenario and a pairwise set of structural combinations, plus a ZIP with one
          complete XML message per row. Each sample is re-checked with the rule engine. A client base sample is optional: if given, values follow its conventions.
        </p>

        <div className="mt-5 grid gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <FilePick label="Message XSD" accept=".xsd,.xml" files={xsd} onPick={setXsd} />
          <FilePick label="MDR Part 2 PDF" accept=".pdf" files={pdf} onPick={setPdf} />
          <FilePick label="…or rules JSON" accept=".json" files={rulesJson} onPick={setRulesJson} optional />
          <FilePick label="Client base sample(s)" accept=".xml" multiple files={bases} onPick={setBases} optional />
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-1">Values
              <select className={inputCls} value={valueStyle} onChange={(e) => setValueStyle(e.target.value)}>
                <option value="realistic">Realistic</option>
                <option value="sequence">Sequence of tag names (NmNm.., AdrLine1AdrLine1..)</option>
              </select>
            </label>
            <label className="flex items-center gap-1">Scenario samples contain
              <select className={inputCls} value={scenarioMode} onChange={(e) => setScenarioMode(e.target.value)}>
                <option value="full">All fields and sections (rule values applied on top)</option>
                <option value="mandatory">Mandatory fields only</option>
              </select>
            </label>
            <label className="flex items-center gap-1">Max combinations <input type="number" min="10" max="2000" className={`${inputCls} w-24`} value={maxCombos} onChange={(e) => setMaxCombos(Math.max(10, Math.min(2000, Number(e.target.value) || 200)))} /></label>
          </div>
          <textarea value={hintText} onChange={(e) => setHintText(e.target.value)} rows={2} spellCheck={false}
            placeholder={'Optional hints, one per line:  BICFI length=8   |   Nm lengthPolicy=max   |   * lengthPolicy=mid'}
            className="w-full rounded border border-slate-300 bg-white p-1.5 font-mono text-xs dark:border-slate-600 dark:bg-slate-900" />
          <div>
            <button onClick={build} disabled={!!busy} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <PackageCheck size={15} />} Build scenario pack
            </button>
            {busy && <span className="ml-3 text-sm text-slate-500">{busy}</span>}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        {out && (
          <div className="mt-6">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {[
                ['Rule scenarios', `${s.scenarios} (${s.withSample} with a sample)`],
                ['Confirmed by rule engine', s.confirmed],
                ['Mismatches', s.mismatches],
                ['Manual needed', s.manual],
                ['Guidelines (note only)', s.guidelines],
                ['Combinations', `${s.combinations} from ${s.factors} factors`],
                ['Pairs covered', s.capped ? `capped at ${maxCombos}` : `all ${s.pairs}`],
                ['Sample files', `${s.files} (incl. ALL_Fields_sample.xml)`],
                ['Base samples used', s.baseSamples],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <div className="text-xs text-slate-500">{k}</div>
                  <div className={`text-lg font-semibold ${k === 'Mismatches' && v > 0 ? 'text-red-600' : ''}`}>{v}</div>
                </div>
              ))}
            </div>
            {s.factorsCut > 0 && <p className="mt-2 text-xs text-amber-600">{s.factorsCut} structural factors were left out of the pairwise set (limit reached).</p>}

            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={dlXlsx} className={btn}><Download size={14} /> Excel (.xlsx)</button>
              <button onClick={dlZip} className={btn}><Download size={14} /> Samples (.zip)</button>
              <button onClick={dlCsv} className={btn}><Download size={14} /> Scenarios (.csv)</button>
              <select className={inputCls} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="all">All scenario types</option>
                {types.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>

            <div className="mt-3 max-h-[28rem] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800"><tr>{['ID', 'Rule', 'Type', 'Expected', 'Engine check', 'Sample'].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r[0]} className="border-t border-slate-200 align-top dark:border-slate-700">
                      <td className="px-2 py-1 font-mono">{r[0]}</td><td className="px-2 py-1">{r[2]}</td><td className="px-2 py-1">{r[5]}</td>
                      <td className={`px-2 py-1 font-semibold ${RES[r[11]] || ''}`}>{r[11]}</td>
                      <td className={`px-2 py-1 ${/MISMATCH/.test(r[17]) ? 'font-semibold text-red-600' : ''}`}>{r[17]}</td>
                      <td className="px-2 py-1">{r[16] ? <button className="text-brand-600 underline" onClick={() => setOpenFile(r[16])}>{r[16]}</button> : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {openFile && (
              <div className="mt-3">
                <div className="mb-1 flex items-center gap-2 text-sm"><code>{openFile}</code><button className={btn} onClick={() => setOpenFile('')}>Close</button></div>
                <pre className="max-h-[28rem] overflow-auto rounded-xl bg-slate-900 p-3 text-xs text-slate-100">{fileMap.get(openFile)}</pre>
              </div>
            )}
            <p className="mt-3 text-xs text-slate-500">
              Usage guidelines that are not in the XSD or MDR PDF (CBPR+, HVPS+, SEPA) are not generated. Rules the engine cannot read are listed as "Manual needed".
              The Excel file also has the combinations, rule coverage, base-sample usage and summary sheets.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
