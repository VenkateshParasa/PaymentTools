// Descriptive analytics over many client samples, possibly of different messages.
// It only REPORTS what the samples contain (how often a field is used, which value shapes and
// lengths occur, which choice branches clients take). It never recommends anything.
//
// analyzeSamples([{ name, tree }], { models: { 'pacs.008.001.14': model } }) ->
//   { messages: [{ type, files, fields[], choices[] }], byName[] }
import { counterOf, repeatUnitOf, leafSimples, tagPathOf, groupPresentInProfile } from './baseProfile.js'

const typeOf = (tree) => (tree.attrs?.xmlns || '').match(/([a-z]+\.\d{3}\.\d{3}\.\d{2})$/)?.[1] || '(unknown message)'

export function shapeOf(v) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'date'
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return 'date-time'
  if (/^-?\d+\.\d+$/.test(v)) return 'decimal'
  if (/^\d+$/.test(v)) return 'digits'
  if (repeatUnitOf(v)) return 'repeated unit (e.g. NmNmNm)'
  if (counterOf(v)) return 'text + running number (e.g. AdrLine1)'
  if (/^[A-Z0-9]{2,12}$/.test(v)) return 'upper-case code / id'
  return 'free text'
}

const inc = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by)
const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n)
const fmtMap = (m, n = 5) => top(m, n).map(([k, c]) => `${k} (${c})`).join('; ')

function findRoot(t) { return t }

export function analyzeSamples(samples, opts = {}) {
  const byType = new Map()
  for (const s of samples) {
    const t = typeOf(s.tree)
    if (!byType.has(t)) byType.set(t, [])
    byType.get(t).push(s)
  }
  const nameAgg = new Map() // element name -> { types:Set, values:Map, shapes:Map, lens:Map, n }
  const messages = []

  for (const [type, list] of byType) {
    const F = new Map()
    const get = (path) => { if (!F.has(path)) F.set(path, { files: new Set(), occ: 0, values: new Map(), shapes: new Map(), lens: new Map(), perParent: new Map() }); return F.get(path) }
    list.forEach((smp, fi) => {
      const walk = (n, parent) => {
        const path = `${parent}/${n.name}`
        const f = get(path); f.files.add(fi); f.occ++
        for (const [k, v] of Object.entries(n.attrs || {})) {
          if (k.startsWith('xmlns')) continue
          const a = get(`${path}/@${k}`); a.files.add(fi); a.occ++; record(a, v, `${path}/@${k}`)
        }
        if (!n.children.length && n.text) record(f, n.text, path)
        const counts = {}
        for (const c of n.children) counts[c.name] = (counts[c.name] || 0) + 1
        for (const [name, k] of Object.entries(counts)) inc(get(`${path}/${name}`).perParent, k)
        for (const c of n.children) walk(c, path)
      }
      const record = (f, v, path) => {
        inc(f.values, v); inc(f.shapes, shapeOf(v)); inc(f.lens, v.length)
        const name = path.split('/').pop()
        if (!nameAgg.has(name)) nameAgg.set(name, { types: new Set(), values: new Map(), shapes: new Map(), lens: new Map(), n: 0, paths: new Set() })
        const a = nameAgg.get(name); a.types.add(type); a.paths.add(path); a.n++; inc(a.values, v); inc(a.shapes, shapeOf(v)); inc(a.lens, v.length)
      }
      walk(findRoot(smp.tree), '')
    })

    const model = opts.models?.[type]
    const simples = model ? leafSimples(model) : {}
    const N = list.length
    const fields = [...F.entries()].map(([path, f]) => {
      const lens = [...f.lens.entries()]
      const total = lens.reduce((a, [, c]) => a + c, 0)
      const min = lens.length ? Math.min(...lens.map(([l]) => l)) : ''
      const max = lens.length ? Math.max(...lens.map(([l]) => l)) : ''
      const avg = total ? (lens.reduce((a, [l, c]) => a + l * c, 0) / total).toFixed(1) : ''
      const maxLen = simples[path]?.maxLength ?? simples[path]?.length
      const atMax = maxLen !== undefined && total ? `${Math.round((100 * (f.lens.get(maxLen) || 0)) / total)}% of values at the XSD max (${maxLen})` : ''
      const perParentMax = Math.max(...f.perParent.keys(), 1)
      return {
        path, filesPresent: f.files.size, files: N, occurrences: f.occ,
        distinct: f.values.size, topValues: fmtMap(f.values, 5),
        shapes: fmtMap(f.shapes, 4), lenMin: min, lenAvg: avg, lenMax: max,
        lenHistogram: lens.length ? top(new Map(lens), 8).map(([l, c]) => `${l}: ${c}`).join('; ') : '', atMax,
        repeats: perParentMax > 1 ? `max ${perParentMax} per parent (${[...f.perParent.entries()].sort((a, b) => a[0] - b[0]).map(([k, c]) => `${k}x: ${c}`).join('; ')})` : '',
      }
    }).sort((a, b) => a.path.localeCompare(b.path))

    const choices = []
    if (model) {
      const present = {}
      for (const [path, f] of F) present[path] = f.files.size
      const prof = { present }
      const walkM = (n) => {
        if (n.kind === 'choice') {
          const counts = n.children.map((c) => [c.kind === 'element' ? c.name : `(${c.kind})`, groupPresentInProfile(prof, c) ? countFiles(F, c) : 0])
          choices.push({ path: tagPathOf(n.id).replace(/^\//, ''), counts, files: N })
        }
        for (const c of n.children || []) walkM(c)
      }
      walkM(model.root)
    }
    messages.push({ type, files: N, names: list.map((x) => x.name), fields, choices: choices.filter((c) => c.counts.some(([, k]) => k > 0)) })
  }

  const byName = [...nameAgg.entries()].map(([name, a]) => {
    const lens = [...a.lens.keys()]
    return { name, messageTypes: [...a.types].join(', '), places: a.paths.size, values: a.n, distinct: a.values.size, shapes: fmtMap(a.shapes, 4), topValues: fmtMap(a.values, 4),
      lenMin: Math.min(...lens), lenMax: Math.max(...lens), lenHistogram: top(a.lens, 6).map(([l, c]) => `${l}: ${c}`).join('; ') }
  }).sort((a, b) => a.name.localeCompare(b.name))
  return { messages, byName }
}

// files in which a choice option (element or group) appears
function countFiles(F, node) {
  if (node.kind === 'element') return F.get(tagPathOf(node.id))?.files.size || 0
  return Math.max(0, ...(node.children || []).map((c) => countFiles(F, c)))
}

export const FIELD_HEADER = ['Message', 'Field (path)', 'Files present', 'Files', 'Occurrences', 'Distinct values', 'Most used values', 'Value shapes', 'Length min', 'Length avg', 'Length max', 'Length histogram (length: count)', 'At XSD max length', 'Repeats']
export const fieldRows = (a) => a.messages.flatMap((m) => m.fields.map((f) => [m.type, f.path, f.filesPresent, f.files, f.occurrences, f.distinct, f.topValues, f.shapes, f.lenMin, f.lenAvg, f.lenMax, f.lenHistogram, f.atMax, f.repeats]))
export const NAME_HEADER = ['Element / attribute name', 'Message types', 'Places used', 'Values seen', 'Distinct values', 'Value shapes', 'Most used values', 'Length min', 'Length max', 'Length histogram (length: count)']
export const nameRows = (a) => a.byName.map((n) => [n.name, n.messageTypes, n.places, n.values, n.distinct, n.shapes, n.topValues, n.lenMin, n.lenMax, n.lenHistogram])
export const CHOICE_HEADER = ['Message', 'Choice at', 'Option', 'Files using it', 'Files']
export const choiceRows = (a) => a.messages.flatMap((m) => m.choices.flatMap((c) => c.counts.map(([o, k]) => [m.type, c.path, o, k, c.files])))
