import { useMemo, useState } from 'react'
import { Copy, Check, Download, FileUp } from 'lucide-react'
import { parseXsdText, buildModel, listChoices } from '../lib/xsd/xsdParser.js'
import { generateSample } from '../lib/xsd/sampleGenerator.js'
import { parseIso20022, lintIso20022 } from '../lib/xmlParser.js'
import { xmlToTree } from '../lib/mdrRules/domXml.js'
import { learnProfile, choicesFromProfile, describeRule, parseHints } from '../lib/xsd/baseProfile.js'

const card = (n) => `${n.min}..${n.max === Infinity ? 'n' : n.max}`

function Badge({ n }) {
  const mandatory = n.min >= 1
  return (
    <span className="ml-2 inline-flex items-center gap-1 align-middle text-[11px]">
      <span className={`rounded px-1.5 py-0.5 font-semibold ${mandatory ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
        {mandatory ? 'Mandatory' : 'Optional'}
      </span>
      <code className="text-slate-500">[{card(n)}]</code>
      {n.max > 1 && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">repeats</span>}
    </span>
  )
}

function simpleInfo(s) {
  if (!s) return ''
  const bits = [s.builtin]
  if (s.enums?.length) bits.push(`enum: ${s.enums.slice(0, 8).join(' | ')}${s.enums.length > 8 ? ' …' : ''}`)
  if (s.patterns?.length) bits.push(`pattern: ${s.patterns[0]}`)
  if (s.length !== undefined) bits.push(`len ${s.length}`)
  else if (s.minLength !== undefined || s.maxLength !== undefined) bits.push(`len ${s.minLength ?? 0}..${s.maxLength ?? 'n'}`)
  return bits.join(' · ')
}

function ValueInput({ id, ov, setOv, hint }) {
  return (
    <input
      value={ov[id] ?? ''}
      onChange={(e) => setOv(id, e.target.value)}
      placeholder={hint || 'custom value'}
      aria-label={`Custom value for ${id}`}
      className={`ml-2 w-52 rounded border px-1.5 py-0.5 text-xs ${ov[id] ? 'border-brand-500 bg-brand-50 dark:bg-slate-800' : 'border-slate-300 dark:border-slate-600 dark:bg-slate-900'}`}
    />
  )
}

function Tree({ n, ov, setOv, depth = 0 }) {
  if (n.kind !== 'element') {
    return (
      <div style={{ marginLeft: depth ? 14 : 0 }}>
        <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">
          {n.kind === 'choice' ? 'one of' : n.kind}
          {n.min === 0 && <span className="ml-1 normal-case text-slate-500">(optional group)</span>}
        </div>
        {n.children.map((c, i) => <Tree key={i} n={c} ov={ov} setOv={setOv} depth={depth + 1} />)}
      </div>
    )
  }
  const isLeaf = !n.recursive && n.children.length === 0 && n.simple
  return (
    <div style={{ marginLeft: depth ? 14 : 0 }} className="border-l border-slate-200 pl-2 dark:border-slate-700">
      <div className="py-0.5 text-sm">
        <span className="font-mono font-medium">{n.name}</span>
        <Badge n={n} />
        {n.simple && <span className="ml-2 text-xs text-slate-500">{simpleInfo(n.simple)}</span>}
        {isLeaf && <ValueInput id={n.id} ov={ov} setOv={setOv} hint={n.simple.enums?.[0]} />}
        {n.recursive && <span className="ml-2 text-xs text-amber-600">recursive type</span>}
      </div>
      {n.doc && <div className="ml-1 text-xs text-slate-500">{n.doc}</div>}
      {n.attrs.map((a) => (
        <div key={a.name} className="ml-3 text-xs text-slate-500">
          @{a.name} <span className={a.use === 'required' ? 'font-semibold text-red-600' : ''}>{a.use}</span> · {simpleInfo(a.simple)}
          <ValueInput id={`${n.id}/@${a.name}`} ov={ov} setOv={setOv} hint={a.simple?.enums?.[0]} />
        </div>
      ))}
      {n.children.map((c, i) => <Tree key={i} n={c} ov={ov} setOv={setOv} depth={depth + 1} />)}
    </div>
  )
}

const inputCls = 'rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900'

export default function SchemaSamplePage() {
  const [xsd, setXsd] = useState('')
  const [rootName, setRootName] = useState('')
  const [mode, setMode] = useState('mandatory')
  const [repeat, setRepeat] = useState(1)
  const [annotate, setAnnotate] = useState(false)
  const [choices, setChoices] = useState({})
  const [tab, setTab] = useState('sample')
  const [copied, setCopied] = useState('')
  const [fileName, setFileName] = useState('')
  const [overrides, setOverrides] = useState({})
  const setOv = (id, v) => setOverrides((prev) => { const next = { ...prev }; if (v === '') delete next[id]; else next[id] = v; return next })
  const overrideCount = Object.keys(overrides).length
  // optional client base samples: the generator adapts to their data conventions
  const [baseTexts, setBaseTexts] = useState([])
  const [valueStyle, setValueStyle] = useState('realistic')
  const [adoptStructure, setAdoptStructure] = useState(true)
  const [iteration, setIteration] = useState(1)
  const [hintText, setHintText] = useState('')
  const hints = useMemo(() => parseHints(hintText), [hintText])

  const parsed = useMemo(() => parseXsdText(xsd), [xsd])
  const activeRoot = parsed.ok ? (parsed.roots.includes(rootName) ? rootName : parsed.roots[0]) : ''
  const built = useMemo(() => {
    if (!parsed.ok) return { error: parsed.error }
    try { return { model: buildModel(parsed.schema, activeRoot) } } catch (e) { return { error: e.message } }
  }, [parsed, activeRoot])
  const model = built.model
  const choiceList = useMemo(() => (model ? listChoices(model.root) : []), [model])
  const profile = useMemo(() => {
    if (!model || !baseTexts.length) return null
    try { return learnProfile(baseTexts.map((b) => xmlToTree(b.text)), { model }) } catch { return null }
  }, [model, baseTexts])
  const baseError = baseTexts.length && model && !profile ? 'A base sample is not well-formed XML.' : ''
  // the client's choice branch is the default; a selection made here wins
  const effChoices = useMemo(() => ({ ...(profile ? choicesFromProfile(model, profile) : {}), ...choices }), [profile, model, choices])
  const result = useMemo(
    () => (model ? generateSample(model, { mode, repeat, annotate, choices: effChoices, overrides, profile, valueStyle, hints, iteration, adoptStructure: !!profile && adoptStructure }) : null),
    [model, mode, repeat, annotate, effChoices, overrides, profile, valueStyle, hints, iteration, adoptStructure],
  )
  const learned = useMemo(() => (profile ? Object.entries(profile.byPath).filter(([, e]) => e.rule).map(([path, e]) => [path, e.rule]) : []), [profile])
  const check = useMemo(() => {
    if (!result) return null
    const p = parseIso20022(result.xml)
    return p.ok ? { ok: true, type: p.messageType, findings: lintIso20022(p.tree, p.messageType) } : p
  }, [result])

  const loadFile = async (e) => {
    const f = e.target.files?.[0]
    if (f) { setXsd(await f.text()); setChoices({}); setOverrides({}) }
  }
  const loadBase = async (e) => {
    const files = Array.from(e.target.files || [])
    setBaseTexts(await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))))
    e.target.value = ''
  }
  const copy = async (what, text) => {
    await navigator.clipboard.writeText(text)
    setCopied(what)
    setTimeout(() => setCopied(''), 1500)
  }
  const defaultName = `${activeRoot || 'sample'}-${mode}.xml`
  // user-typed name wins; strip characters not allowed in file names; default to .xml
  const cleaned = fileName.trim().replace(/[\\/:*?"<>|]/g, '_')
  const downloadName = cleaned ? (/\.[A-Za-z0-9]+$/.test(cleaned) ? cleaned : `${cleaned}.xml`) : defaultName
  const download = () => {
    const url = URL.createObjectURL(new Blob([result.xml], { type: 'application/xml' }))
    const a = document.createElement('a')
    a.href = url
    a.download = downloadName
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Schema → Sample Generator</h1>
        <p className="mt-1 text-sm text-slate-500">
          Load an ISO 20022 XSD to see every element with its mandatory / optional status, then generate a sample message.
          A base XSD gives ISO cardinality only: usage guidelines such as CBPR+ can make more fields mandatory. Values are placeholders, not business-valid data.
        </p>

        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white">
                <FileUp size={15} /> Load XSD
                <input type="file" accept=".xsd,.xml" className="hidden" onChange={loadFile} />
              </label>
              {parsed.ok && parsed.roots.length > 1 && (
                <select className={inputCls} value={activeRoot} onChange={(e) => { setRootName(e.target.value); setChoices({}); setOverrides({}) }}>
                  {parsed.roots.map((r) => <option key={r}>{r}</option>)}
                </select>
              )}
            </div>
            <textarea
              value={xsd}
              onChange={(e) => { setXsd(e.target.value); setChoices({}); setOverrides({}) }}
              spellCheck={false}
              placeholder="Paste XSD here or use Load XSD…"
              className="h-72 w-full rounded-xl border border-slate-300 bg-white p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
            />
            {xsd.trim() && !parsed.ok && <p className="mt-2 text-sm text-red-600">{parsed.error}</p>}
            {built.error && parsed.ok && <p className="mt-2 text-sm text-red-600">{built.error}</p>}

            {model && (
              <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
                <label className="flex flex-col gap-1">Fields
                  <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value)}>
                    <option value="mandatory">Mandatory only</option>
                    <option value="full">Everything (mandatory + optional)</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">Repeat count (for repeating elements)
                  <input type="number" min="1" max="5" className={inputCls} value={repeat} onChange={(e) => setRepeat(Math.max(1, Math.min(5, Number(e.target.value) || 1)))} />
                </label>
                <label className="col-span-2 flex items-center gap-2">
                  <input type="checkbox" checked={annotate} onChange={(e) => setAnnotate(e.target.checked)} /> Add cardinality comments
                </label>
                <div className="col-span-2 rounded-lg border border-dashed border-slate-300 p-2 dark:border-slate-600">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-600">
                      <FileUp size={13} /> Client base sample(s) <span className="text-slate-500">(optional)</span>
                      <input type="file" multiple accept=".xml" className="hidden" onChange={loadBase} />
                    </label>
                    {baseTexts.length > 0 && (
                      <>
                        <span className="text-xs text-slate-500">{baseTexts.map((b) => b.name).join(', ')}</span>
                        <button onClick={() => setBaseTexts([])} className="rounded border border-slate-300 px-1.5 text-xs dark:border-slate-600">Remove</button>
                      </>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                    <label className="flex items-center gap-1">Sample no. <input type="number" min="1" max="999" className={`${inputCls} w-16`} value={iteration} onChange={(e) => setIteration(Math.max(1, Number(e.target.value) || 1))} /></label>
                    <label className="flex items-center gap-1">Values
              <select className={inputCls} value={valueStyle} onChange={(e) => setValueStyle(e.target.value)}>
                <option value="realistic">Realistic</option>
                <option value="sequence">Sequence of tag names (NmNm.., AdrLine1AdrLine1..)</option>
              </select>
            </label>
                    {profile && <label className="flex items-center gap-1"><input type="checkbox" checked={adoptStructure} onChange={(e) => setAdoptStructure(e.target.checked)} /> Follow client's optional fields / repeats</label>}
                  </div>
                  <textarea
                    value={hintText}
                    onChange={(e) => setHintText(e.target.value)}
                    spellCheck={false}
                    rows={2}
                    placeholder={'Optional hints, one per line:  BICFI length=8   |   Nm lengthPolicy=max   |   * lengthPolicy=mid'}
                    className="mt-2 w-full rounded border border-slate-300 bg-white p-1.5 font-mono text-xs dark:border-slate-600 dark:bg-slate-900"
                  />
                  {baseError && <p className="mt-1 text-xs text-red-600">{baseError}</p>}
                  {learned.length > 0 && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-slate-600 dark:text-slate-300">{learned.length} field conventions learned from the base sample</summary>
                      <ul className="mt-1 max-h-40 overflow-auto font-mono text-[11px] text-slate-500">
                        {learned.map(([path, r]) => <li key={path}>{path.split('/').slice(-3).join('/')}: {describeRule(r)}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
                {choiceList.map((c) => (
                  <label key={c.id} className="col-span-2 flex flex-col gap-1 text-xs">
                    <span className="truncate text-slate-500" title={c.id}>Choice at {c.id.replace(/\/#\w+(~\d+)?/g, '').replace(/\/#?choice.*/, '') || '/'}</span>
                    <select className={inputCls} value={effChoices[c.id] ?? 0} onChange={(e) => setChoices({ ...choices, [c.id]: Number(e.target.value) })}>
                      {c.options.map((o, i) => <option key={i} value={i}>{o}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            {model && (
              <>
                <div className="mb-2 flex gap-2">
                  {['sample', 'structure'].map((t) => (
                    <button key={t} onClick={() => setTab(t)} className={`rounded-full border px-3 py-1 text-sm ${tab === t ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                      {t === 'sample' ? 'Generated sample' : `Structure & custom values${overrideCount ? ` (${overrideCount})` : ''}`}
                    </button>
                  ))}
                </div>
                {tab === 'sample' ? (
                  <>
                    <div className="mb-2 flex flex-wrap gap-2 text-sm">
                      <button onClick={() => copy('xml', result.xml)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-600">
                        {copied === 'xml' ? <Check size={14} /> : <Copy size={14} />} Copy XML
                      </button>
                      <input
                        value={fileName}
                        onChange={(e) => setFileName(e.target.value)}
                        placeholder={defaultName}
                        aria-label="Download file name"
                        className={`${inputCls} w-52`}
                      />
                      <button onClick={download} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-600" title={`Saves as ${downloadName}`}><Download size={14} /> Download</button>
                    </div>
                    <pre className="max-h-[32rem] overflow-auto rounded-xl bg-slate-900 p-3 text-xs text-slate-100">{result.xml}</pre>
                    {check && (
                      <p className="mt-2 text-xs text-slate-500">
                        {check.ok ? `Well-formed XML${check.type ? ` · ${check.type}` : ''} · ${check.findings.map((f) => f.level).join(', ')}` : check.error}
                      </p>
                    )}
                    {result.warnings.length > 0 && (
                      <ul className="mt-2 list-disc pl-5 text-xs text-amber-600">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                    )}
                  </>
                ) : (
                  <>
                    <p className="mb-2 text-xs text-slate-500">
                      Type into any field box to use your own value in the sample (e.g. under the postal address). The XML itself is never edited by hand:
                      a field with a custom value is included even if optional, and the choice branch that contains it is selected automatically.
                      {overrideCount > 0 && (
                        <button onClick={() => setOverrides({})} className="ml-2 rounded border border-slate-300 px-2 py-0.5 dark:border-slate-600">Clear {overrideCount} custom value{overrideCount > 1 ? 's' : ''}</button>
                      )}
                    </p>
                    <div className="max-h-[36rem] overflow-auto rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                      <Tree n={model.root} ov={overrides} setOv={setOv} />
                    </div>
                  </>
                )}
              </>
            )}
            {!model && <p className="text-sm text-slate-500">Load an XSD to see its structure and generate a sample.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
