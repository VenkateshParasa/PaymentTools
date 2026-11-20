// Hybrid mode: message structure (sections, fields, facets, choices) from an XSD, validation rules from the VMF.
// Each XSD field is tied to a VMF field to find out which rules apply to it, in this order:
//   1. same tag path in the VMF (e.g. /FICdtTrf/GrpHdr/MsgId)           -> uses that field's xmlType
//   2. same element name in the VMF, when all its occurrences share one xmlType
//   3. the XSD's own type name (works when a rule names a plain ISO type)
// VMF and XSD may be different versions: compareStructures() lists the fields that exist on one side only.
import { parseXsdTree, buildModel, assignIds } from '../xsd/xsdParser.js'
import { parseXmlTree } from './xmlTree.js'
import { tagPathOf } from '../xsd/baseProfile.js'

function elementsOf(root, fn) {
  const walk = (n) => { if (n.kind === 'element') fn(n); for (const c of n.children || []) walk(c) }
  walk(root)
}
const find = (n, name) => {
  if (n.kind === 'element' && n.name === name) return n
  for (const c of n.children || []) { const f = find(c, name); if (f) return f }
  return null
}
const pathsOf = (root) => {
  const out = new Set()
  elementsOf(root, (n) => { const p = tagPathOf(n.id); out.add(p); for (const a of n.attrs || []) out.add(`${p}/@${a.name}`) })
  return out
}

export function parseXsdModel(xsdText) {
  const parsed = parseXsdTree(parseXmlTree(xsdText))
  if (!parsed.ok) throw new Error(parsed.error)
  return buildModel(parsed.schema, parsed.roots[0])
}

// root of the XSD model that corresponds to the VMF root (FICdtTrf inside Document), cloned and re-numbered
function xsdRootFor(xsdModel, vmfRootName, warnings) {
  let root = find(xsdModel.root, vmfRootName)
  if (!root) { warnings.push(`The XSD has no <${vmfRootName}> element; its own root <${xsdModel.root.name}> is used and paths will not line up with the VMF.`); root = xsdModel.root }
  root = structuredClone(root)
  root.min = 1; root.max = 1
  assignIds(root, '')
  return root
}

export function compareStructures(vmf, xsdModel) {
  const warnings = []
  const root = xsdRootFor(xsdModel, vmf.info.root, warnings)
  const v = pathsOf(vmf.model.root), x = pathsOf(root)
  const onlyVmf = [...v].filter((p) => !x.has(p)), onlyXsd = [...x].filter((p) => !v.has(p))
  return { common: [...v].filter((p) => x.has(p)).length, vmfFields: v.size, xsdFields: x.size, onlyVmf, onlyXsd }
}

export function buildHybrid(vmf, xsdModel) {
  const warnings = []
  const root = xsdRootFor(xsdModel, vmf.info.root, warnings)
  const byPath = new Map(), byName = new Map()
  const noteName = (key, meta) => {
    const t = String(meta.xmlType || '').replace(/---copy\d*$/i, '')
    const m = byName.get(key) || new Map()
    if (!m.has(t)) m.set(t, meta)
    byName.set(key, m)
  }
  elementsOf(vmf.model.root, (n) => {
    const p = tagPathOf(n.id)
    byPath.set(p, n.vmf); noteName(n.name, n.vmf)
    for (const a of n.attrs) { byPath.set(`${p}/@${a.name}`, a.vmf); noteName(`@${a.name}`, a.vmf) }
  })
  const stats = { path: 0, name: 0, type: 0 }
  const pick = (path, key, fallbackType, name) => {
    if (byPath.has(path)) { stats.path++; return byPath.get(path) }
    const m = byName.get(key)
    if (m && m.size === 1) { stats.name++; return [...m.values()][0] }
    stats.type++
    return { name, datatype: '', xmlType: fallbackType || '', fieldAttributes: {}, scope: 'data' }
  }
  elementsOf(root, (n) => {
    const p = tagPathOf(n.id)
    n.vmf = pick(p, n.name, n.typeName, n.name)
    for (const a of n.attrs) a.vmf = pick(`${p}/@${a.name}`, `@${a.name}`, a.typeName, a.name)
  })
  return {
    info: { ...vmf.info, namespace: xsdModel.targetNamespace || vmf.info.namespace, root: root.name, structure: 'XSD' },
    model: { targetNamespace: xsdModel.targetNamespace, root },
    parts: vmf.parts,
    partInfo: vmf.partInfo,
    functions: vmf.functions,
    rules: vmf.rules,
    warnings: [...vmf.warnings, ...warnings],
    hybrid: { ...stats, compare: compareStructures(vmf, xsdModel) },
  }
}
