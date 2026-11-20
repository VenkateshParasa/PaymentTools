import { useMemo, useState } from 'react'
import { Check, Copy, Download, FileCog, FileUp, Loader2 } from 'lucide-react'
import { parseVmfText } from '../lib/vmf/vmfParser.js'
import { generateVmfSample } from '../lib/vmf/vmfSample.js'
import { buildHybrid, compareStructures, parseXsdModel } from '../lib/vmf/hybrid.js'
import { downloadBlob } from '../lib/download.js'

const inputCls = 'rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900'
const btn = 'inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600'
const STATUS = {
  Pass: 'text-emerald-600', FAIL: 'font-semibold text-red-600', 'Not evaluated': 'text-amber-600', 'Not used': 'text-slate-500',
}

export default function VmfSamplePage() {
  const [file, setFile] = useState(null)
  const [vmf, setVmf] = useState(null)
  const [xsdFile, setXsdFile] = useState(null)
  const [xsdModel, setXsdModel] = useState(null)
  const [structure, setStructure] = useState('vmf')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('mandatory')
  const [wrap, setWrap] = useState(false)
  const [repeat, setRepeat] = useState(1)
  const [valueStyle, setValueStyle] = useState('realistic')
  const [filter, setFilter] = useState('all')
  const [copied, setCopied] = useState(false)
  const [part, setPart] = useState('Data')
  const [includeHT, setIncludeHT] = useState(false)

  const load = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setError(''); setVmf(null); setBusy(true); setFile(f)
    try {
      await new Promise((r) => setTimeout(r, 20))
      setVmf(parseVmfText(await f.text()))
    } catch (err) { setError(err.message || String(err)) } finally { setBusy(false) }
  }

  const loadXsd = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setError('')
    try { setXsdModel(parseXsdModel(await f.text())); setXsdFile(f); setStructure('xsd') } catch (err) { setError(`${f.name}: ${err.message || err}`) }
  }
  const clearXsd = () => { setXsdFile(null); setXsdModel(null); setStructure('vmf') }

  // structure from the XSD (hybrid) or from the VMF itself; the rules always come from the VMF
  const source = useMemo(() => {
    if (!vmf) return null
    try {
      if (xsdModel && structure === 'xsd') return buildHybrid(vmf, xsdModel)
      return xsdModel ? { ...vmf, hybrid: { compare: compareStructures(vmf, xsdModel) } } : vmf
    } catch (e) { return { error: e.message } }
  }, [vmf, xsdModel, structure])

  const out = useMemo(() => {
    if (!source) return null
    if (source.error) return { error: source.error }
    try { return generateVmfSample(source, { mode, wrapDocument: wrap, repeat, valueStyle, includeHeaderTrailer: includeHT }) } catch (e) { return { error: e.message } }
  }, [source, mode, wrap, repeat, valueStyle, includeHT])

  const rows = useMemo(() => (out?.report ? out.report.rules.filter((r) => filter === 'all' || r.status === filter) : []), [out, filter])
  const t = out?.report?.totals
  const shown = out?.parts?.find((x) => x.label === part) || out?.parts?.find((x) => x.label === 'Data')
  const rep = out?.report
  const name = `${vmf?.info.standardName || 'vmf'}-${mode === 'full' ? 'all-fields' : 'mandatory'}-sample.xml`
  const copy = async () => { await navigator.clipboard.writeText(shown.xml); setCopied(true); setTimeout(() => setCopied(false), 1500) }

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800 dark:text-slate-100"><FileCog className="text-brand-600" /> VMF → Base Sample</h1>
        <p className="mt-1 text-sm text-slate-500">
          Load a VMF file (the XML message definition with its validation formulas). The tool builds a sample from its sections, fields and facets, chooses values that
          satisfy the validation formulas, then runs every formula on the finished sample and reports the result. Nothing is uploaded.
        </p>

        <div className="mt-5 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white">
              <FileUp size={15} /> Load VMF
              <input type="file" accept=".vmf,.xml" className="hidden" onChange={load} />
            </label>
            <span className="text-xs text-slate-500">{file ? file.name : 'required'}</span>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600">
              <FileUp size={15} /> Load XSD <span className="text-xs text-slate-500">(optional)</span>
              <input type="file" accept=".xsd,.xml" className="hidden" onChange={loadXsd} />
            </label>
            {xsdFile && <><span className="text-xs text-slate-500">{xsdFile.name}</span><button onClick={clearXsd} className="rounded border border-slate-300 px-1.5 text-xs dark:border-slate-600">Remove</button></>}
            {busy && <Loader2 size={15} className="animate-spin" />}
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          {vmf && (
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-1">Structure from
                <select className={inputCls} value={structure} onChange={(e) => setStructure(e.target.value)}>
                  <option value="vmf">VMF</option>
                  <option value="xsd" disabled={!xsdModel}>XSD (rules from VMF)</option>
                </select>
              </label>
              <label className="flex items-center gap-1">Fields
                <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="mandatory">Mandatory only</option>
                  <option value="full">All fields and sections</option>
                </select>
              </label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} /> Wrap in &lt;Document&gt;</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={includeHT} onChange={(e) => { setIncludeHT(e.target.checked); setPart('Data') }} /> Include header and trailer fields</label>
              <label className="flex items-center gap-1">Repeat <input type="number" min="1" max="5" className={`${inputCls} w-16`} value={repeat} onChange={(e) => setRepeat(Math.max(1, Math.min(5, Number(e.target.value) || 1)))} /></label>
              <label className="flex items-center gap-1">Values
                <select className={inputCls} value={valueStyle} onChange={(e) => setValueStyle(e.target.value)}>
                  <option value="realistic">Realistic</option>
                  <option value="sequence">Sequence of tag names</option>
                </select>
              </label>
            </div>
          )}
        </div>

        {vmf && (
          <div className="mt-4 text-xs text-slate-500">
            <span className="font-semibold text-slate-700 dark:text-slate-200">{vmf.info.standardName || '(unnamed)'}</span> · root <code>{(source?.info || vmf.info).root}</code> · {(source?.info || vmf.info).namespace} · {vmf.rules.length} validation rule(s)
            {vmf.warnings.length > 0 && <ul className="mt-1 list-disc pl-5 text-amber-600">{vmf.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          </div>
        )}

        {source?.hybrid && (
          <details className="mt-2 text-xs text-slate-600 dark:text-slate-300">
            <summary className="cursor-pointer">
              {structure === 'xsd' && source.hybrid.path !== undefined
                ? `Structure from the XSD. VMF rule types found for ${source.hybrid.path} fields by path, ${source.hybrid.name} by name, ${source.hybrid.type} by the XSD's own type name. `
                : 'Structure from the VMF. '}
              VMF vs XSD: {source.hybrid.compare.common} fields in both, {source.hybrid.compare.onlyVmf.length} only in the VMF, {source.hybrid.compare.onlyXsd.length} only in the XSD.
            </summary>
            <div className="mt-1 grid gap-3 sm:grid-cols-2">
              {[['Only in the VMF', source.hybrid.compare.onlyVmf], ['Only in the XSD', source.hybrid.compare.onlyXsd]].map(([h, list]) => (
                <div key={h}><b>{h}</b><ul className="mt-1 max-h-40 overflow-auto font-mono text-[11px] text-slate-500">{list.slice(0, 200).map((p) => <li key={p}>{p}</li>)}{list.length > 200 && <li>… {list.length - 200} more</li>}</ul></div>
              ))}
            </div>
          </details>
        )}
        {out?.error && <p className="mt-3 text-sm text-red-600">{out.error}</p>}
        {out?.report && (
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <div>
              <div className="mb-2 flex flex-wrap gap-2">
                <button onClick={copy} className={btn}>{copied ? <Check size={14} /> : <Copy size={14} />} Copy XML</button>
                <button onClick={() => downloadBlob(shown.label === 'Data' ? name : name.replace('-sample.xml', `-${shown.label.toLowerCase()}-sample.xml`), shown.xml, 'application/xml')} className={btn}><Download size={14} /> Download</button>
              </div>
              {rep.headerTrailer.state !== 'off' && (
                <div className={`mb-2 rounded-lg border p-2 text-xs ${rep.headerTrailer.state === 'incomplete' ? 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300' : 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}>
                  {rep.headerTrailer.message}
                  {rep.headerTrailer.issues && <ul className="mt-1 list-disc pl-5">{rep.headerTrailer.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>}
                </div>
              )}
              {out.parts.length > 1 && (
                <div className="mb-2 flex gap-2">
                  {out.parts.map((x) => (
                    <button key={x.label + x.name} onClick={() => setPart(x.label)} className={`rounded-full border px-3 py-1 text-sm ${shown.label === x.label ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-slate-600'}`}>{x.label} ({x.name})</button>
                  ))}
                </div>
              )}
              <pre className="max-h-[36rem] overflow-auto rounded-xl bg-slate-900 p-3 text-xs text-slate-100">{shown.xml}</pre>
              {out.warnings.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-amber-600">{out.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            </div>
            <div>
              <div className={`rounded-xl border p-3 text-sm ${t.fail === 0 && out.report.unsolved.length === 0 ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30' : 'border-red-300 bg-red-50 dark:bg-red-950/30'}`}>
                <b>{t.fail === 0 && out.report.unsolved.length === 0 ? 'No validation failures' : `${t.fail} rule(s) fail`}</b>
                {' '}· {t.checks} field checks · {t.pass} rules pass · {t.notEvaluated} not evaluated · {t.notUsed} not used in this sample
                {out.report.unsolved.length > 0 && <div className="mt-1 text-red-600">No value satisfying all rules was found for: {out.report.unsolved.join(', ')}</div>}
              </div>
              <details className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                <summary className="cursor-pointer">{rep.userFunctions.length} function(s) from the VMF in use ({rep.functionsFound} definition block(s) found)</summary>
                <ul className="mt-1 list-disc pl-5">
                  {rep.userFunctions.map((f) => <li key={f.name}><code>{f.name}({f.params.join(', ')})</code> {f.usedBy.length ? `· used by ${f.usedBy.join(', ')}` : '· called only from other functions'}</li>)}
                  {rep.functionNotes.map((n, i) => <li key={i} className="text-amber-600">{n}</li>)}
                </ul>
                {rep.functionsFound === 0 && rep.unsupportedFunctions.length > 0 && (
                  <p className="mt-1 text-amber-600">No function definitions were recognised in this VMF. Top-level sections found: {vmf.diagnostics.topLevel.join(', ')}. If the functions are stored under one of these, tell me its layout.</p>
                )}
              </details>
              {out.report.unsupportedFunctions.length > 0 && (
                <p className="mt-2 text-xs text-amber-600">
                  Functions called by formulas that are neither defined in the VMF nor built in (those rules are listed as "Not evaluated"): <b>{out.report.unsupportedFunctions.join(', ')}</b>
                </p>
              )}
              <select className={`${inputCls} mt-3`} value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">All rules</option>
                {['Pass', 'FAIL', 'Not evaluated', 'Not used'].map((s) => <option key={s}>{s}</option>)}
              </select>
              <div className="mt-2 max-h-[30rem] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800"><tr>{['Rule', 'Code', 'Applies to', 'Checked', 'Result'].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t border-slate-200 align-top dark:border-slate-700" title={r.formula}>
                        <td className="px-2 py-1">{r.name}<div className="text-[11px] text-slate-500">{r.set}{r.scope ? ` · ${r.scope}` : ''} · {r.severity}</div></td>
                        <td className="px-2 py-1">{r.errorCode}</td>
                        <td className="px-2 py-1 font-mono text-[11px]">{r.fieldname}<div className="text-slate-500">{r.matchedFields} field(s)</div></td>
                        <td className="px-2 py-1">{r.checked}</td>
                        <td className={`px-2 py-1 ${STATUS[r.status]}`}>{r.status}{r.note && <div className="font-normal text-slate-500">{r.note}</div>}{r.examples.map((x, j) => <div key={j} className="font-normal text-red-600">{x}</div>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
