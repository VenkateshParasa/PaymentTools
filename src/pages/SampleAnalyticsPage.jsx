import { useMemo, useState } from 'react'
import { BarChart3, Download, FileUp, Loader2 } from 'lucide-react'
import { parseXsdText, buildModel } from '../lib/xsd/xsdParser.js'
import { xmlToTree } from '../lib/mdrRules/domXml.js'
import { analyzeSamples, FIELD_HEADER, fieldRows, NAME_HEADER, nameRows, CHOICE_HEADER, choiceRows } from '../lib/xsd/profileStats.js'
import { buildXlsx } from '../lib/scenarioPack/export.js'
import { toCsv } from '../lib/mdrRules/csv.js'
import { downloadBlob } from '../lib/download.js'

const inputCls = 'rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900'
const btn = 'inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600'
const idOf = (ns) => (ns || '').match(/([a-z]+\.\d{3}\.\d{3}\.\d{2})$/)?.[1]

export default function SampleAnalyticsPage() {
  const [samples, setSamples] = useState([])
  const [xsds, setXsds] = useState([])
  const [res, setRes] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [filter, setFilter] = useState('')
  const [view, setView] = useState('fields')

  const run = async () => {
    setError(''); setBusy(true); setRes(null)
    try {
      if (!samples.length) throw new Error('Load at least one client sample (XML).')
      const parsed = []
      for (const f of samples) {
        try { parsed.push({ name: f.name, tree: xmlToTree(await f.text()) }) } catch { throw new Error(`${f.name} is not well-formed XML.`) }
      }
      const models = {}
      for (const f of xsds) {
        const p = parseXsdText(await f.text())
        if (!p.ok) throw new Error(`${f.name}: ${p.error}`)
        const m = buildModel(p.schema, p.roots[0])
        const id = idOf(m.targetNamespace)
        if (id) models[id] = m
      }
      const a = analyzeSamples(parsed, { models })
      setRes(a); setMsg(a.messages[0]?.type || '')
    } catch (e) { setError(e.message || String(e)) } finally { setBusy(false) }
  }

  const m = res?.messages.find((x) => x.type === msg)
  const fields = useMemo(() => (m ? m.fields.filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase())) : []), [m, filter])
  const names = useMemo(() => (res ? res.byName.filter((n) => !filter || n.name.toLowerCase().includes(filter.toLowerCase())) : []), [res, filter])
  const dlX = async () => downloadBlob('sample-analytics.xlsx', await buildXlsx([
    { name: 'Fields', header: FIELD_HEADER, rows: fieldRows(res) },
    { name: 'Across messages', header: NAME_HEADER, rows: nameRows(res) },
    { name: 'Choices', header: CHOICE_HEADER, rows: choiceRows(res) },
  ]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  const dlC = () => downloadBlob('sample-analytics-fields.csv', toCsv(FIELD_HEADER, fieldRows(res)), 'text/csv;charset=utf-8')

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800 dark:text-slate-100"><BarChart3 className="text-brand-600" /> Sample Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">
          Load client sample messages (any number, any mix of messages). The tool reports what the samples contain: how often each field is used, which value shapes and lengths occur,
          how many values sit at the XSD maximum, repeat counts and which choice branches are taken. It only describes the data, it makes no recommendations.
          Adding the XSDs (optional) enables the max-length and choice reports.
        </p>
        <div className="mt-5 grid gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          {[['Client samples (XML)', '.xml', samples, setSamples, false], ['XSDs (optional)', '.xsd,.xml', xsds, setXsds, true]].map(([label, accept, files, set, opt]) => (
            <div key={label} className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white">
                <FileUp size={15} /> {label}
                <input type="file" multiple accept={accept} className="hidden" onChange={(e) => { set(Array.from(e.target.files || [])); e.target.value = '' }} />
              </label>
              <span className="text-xs text-slate-500">{files.length ? `${files.length} file(s)` : opt ? 'optional' : 'required'}</span>
            </div>
          ))}
          <div><button onClick={run} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{busy && <Loader2 size={15} className="animate-spin" />} Analyse</button></div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        {res && (
          <div className="mt-6">
            <div className="flex flex-wrap items-center gap-2">
              {['fields', 'choices', 'names'].map((t) => (
                <button key={t} onClick={() => setView(t)} className={`rounded-full border px-3 py-1 text-sm ${view === t ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                  {t === 'fields' ? 'Fields' : t === 'choices' ? 'Choices' : 'Same name across messages'}
                </button>
              ))}
              {view !== 'names' && res.messages.length > 0 && (
                <select className={inputCls} value={msg} onChange={(e) => setMsg(e.target.value)}>
                  {res.messages.map((x) => <option key={x.type} value={x.type}>{x.type} ({x.files} file{x.files > 1 ? 's' : ''})</option>)}
                </select>
              )}
              <input className={`${inputCls} w-48`} placeholder="Filter by field name" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <button onClick={dlX} className={`${btn} ml-auto`}><Download size={14} /> Excel</button>
              <button onClick={dlC} className={btn}><Download size={14} /> CSV</button>
            </div>
            <div className="mt-3 max-h-[34rem] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              {view === 'fields' && m && (
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800"><tr>{['Field', 'Files', 'Distinct', 'Most used values', 'Value shapes', 'Length min/avg/max', 'Length histogram', 'At XSD max', 'Repeats'].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr></thead>
                  <tbody>
                    {fields.map((f) => (
                      <tr key={f.path} className="border-t border-slate-200 align-top dark:border-slate-700">
                        <td className="px-2 py-1 font-mono" title={f.path}>{f.path.split('/').slice(-3).join('/')}</td>
                        <td className="px-2 py-1">{f.filesPresent}/{f.files}</td><td className="px-2 py-1">{f.distinct}</td>
                        <td className="px-2 py-1">{f.topValues}</td><td className="px-2 py-1">{f.shapes}</td>
                        <td className="px-2 py-1">{f.lenMin !== '' ? `${f.lenMin} / ${f.lenAvg} / ${f.lenMax}` : ''}</td>
                        <td className="px-2 py-1">{f.lenHistogram}</td><td className="px-2 py-1">{f.atMax}</td><td className="px-2 py-1">{f.repeats}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {view === 'choices' && m && (
                m.choices.length ? (
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800"><tr><th className="px-2 py-1.5">Choice at</th><th className="px-2 py-1.5">Files using each option</th></tr></thead>
                    <tbody>{m.choices.filter((c) => !filter || c.path.toLowerCase().includes(filter.toLowerCase())).map((c) => (
                      <tr key={c.path} className="border-t border-slate-200 align-top dark:border-slate-700"><td className="px-2 py-1 font-mono">{c.path.split('/').slice(-3).join('/')}</td><td className="px-2 py-1">{c.counts.map(([o, k]) => `${o}: ${k}/${c.files}`).join('   ')}</td></tr>
                    ))}</tbody>
                  </table>
                ) : <p className="p-3 text-sm text-slate-500">No choice data. Load the XSD of this message to see which branches the samples use.</p>
              )}
              {view === 'names' && (
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800"><tr>{['Name', 'Messages', 'Places', 'Values', 'Distinct', 'Value shapes', 'Most used values', 'Length min..max', 'Length histogram'].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr></thead>
                  <tbody>{names.map((n) => (
                    <tr key={n.name} className="border-t border-slate-200 align-top dark:border-slate-700">
                      <td className="px-2 py-1 font-mono">{n.name}</td><td className="px-2 py-1">{n.messageTypes}</td><td className="px-2 py-1">{n.places}</td><td className="px-2 py-1">{n.values}</td><td className="px-2 py-1">{n.distinct}</td>
                      <td className="px-2 py-1">{n.shapes}</td><td className="px-2 py-1">{n.topValues}</td><td className="px-2 py-1">{n.lenMin}..{n.lenMax}</td><td className="px-2 py-1">{n.lenHistogram}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
