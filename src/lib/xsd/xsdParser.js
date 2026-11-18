// XSD -> normalised schema model. The core works on a tiny generic tree
// ({ name, attrs, children, text }) so it is DOM-independent; parseXsdText()
// builds that tree with the browser's DOMParser (no libraries needed).
//
// Model node kinds:
//   element: { kind:'element', id, name, min, max, doc, typeName, simple, attrs[], children[], recursive? }
//   group:   { kind:'choice'|'sequence'|'all', id, min, max, children[] }
// simple = { builtin, enums[], patterns[], minLength, maxLength, length, minInclusive,
//            maxInclusive, totalDigits, fractionDigits } | null

const local = (n) => (n || '').replace(/^.*:/, '')
const kids = (n, name) => n.children.filter((c) => c.name === name)
const kid = (n, name) => n.children.find((c) => c.name === name)

export function domToTree(el) {
  const attrs = {}
  for (const a of Array.from(el.attributes)) attrs[local(a.name)] = a.value
  // keep default-namespace attribute separately
  const children = Array.from(el.children).map(domToTree)
  return {
    name: el.localName || local(el.nodeName),
    attrs,
    children,
    text: children.length ? '' : (el.textContent || '').trim(),
    docText: undefined,
  }
}

export function parseXsdText(text) {
  if (!text || !text.trim()) return { ok: false, error: 'Load or paste an XSD to begin.' }
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const err = doc.querySelector('parsererror')
  if (err) return { ok: false, error: 'Invalid XML: ' + err.textContent.split('\n')[0] }
  if (local(doc.documentElement.nodeName) !== 'schema') return { ok: false, error: 'Root element is not an XSD <schema>.' }
  return parseXsdTree(domToTree(doc.documentElement))
}

export function parseXsdTree(root) {
  const schema = { elements: {}, complexTypes: {}, simpleTypes: {}, targetNamespace: root.attrs.targetNamespace || '' }
  for (const c of root.children) {
    const n = c.attrs.name
    if (!n) continue
    if (c.name === 'element') schema.elements[n] = c
    else if (c.name === 'complexType') schema.complexTypes[n] = c
    else if (c.name === 'simpleType') schema.simpleTypes[n] = c
  }
  const roots = Object.keys(schema.elements)
  if (!roots.length) return { ok: false, error: 'No global <element> found in this XSD.' }
  return { ok: true, schema, roots }
}

export function buildModel(schema, rootName, maxRecursion = 1) {
  const el = schema.elements[rootName]
  if (!el) throw new Error(`Unknown root element: ${rootName}`)
  const node = buildElement(schema, el, [], maxRecursion)
  node.min = 1
  node.max = 1
  assignIds(node, '')
  return { targetNamespace: schema.targetNamespace, root: node }
}

function docOf(n) {
  const d = kid(n, 'annotation') && kid(kid(n, 'annotation'), 'documentation')
  return d ? d.text.replace(/\s+/g, ' ').trim() : ''
}

const occ = (n) => {
  const min = n.attrs.minOccurs === undefined ? 1 : Number(n.attrs.minOccurs)
  const max = n.attrs.maxOccurs === undefined ? 1 : n.attrs.maxOccurs === 'unbounded' ? Infinity : Number(n.attrs.maxOccurs)
  return { min, max }
}

function buildElement(schema, n, stack, maxRec) {
  const target = n.attrs.ref ? schema.elements[local(n.attrs.ref)] : n
  if (!target) return { kind: 'element', name: local(n.attrs.ref), ...occ(n), attrs: [], children: [], simple: null, unresolved: true }
  const { min, max } = occ(n)
  const node = { kind: 'element', name: target.attrs.name, min, max, doc: docOf(target), typeName: local(target.attrs.type) || '', attrs: [], children: [], simple: null }

  const typeName = local(target.attrs.type)
  const inlineCT = kid(target, 'complexType')
  const inlineST = kid(target, 'simpleType')

  if (typeName && schema.complexTypes[typeName]) {
    if (stack.filter((s) => s === typeName).length >= maxRec) { node.recursive = true; return node }
    fillComplex(schema, schema.complexTypes[typeName], node, [...stack, typeName], maxRec)
  } else if (typeName) {
    node.simple = resolveSimple(schema, typeName)
  } else if (inlineCT) {
    fillComplex(schema, inlineCT, node, stack, maxRec)
  } else if (inlineST) {
    node.simple = resolveSimple(schema, inlineST)
  } else {
    node.simple = { builtin: 'string', enums: [], patterns: [] }
  }
  return node
}

function fillComplex(schema, ct, node, stack, maxRec) {
  if (!node.doc) node.doc = docOf(ct)
  const cc = kid(ct, 'complexContent')
  const sc = kid(ct, 'simpleContent')
  if (cc) {
    const ext = kid(cc, 'extension') || kid(cc, 'restriction')
    const baseName = local(ext.attrs.base)
    if (schema.complexTypes[baseName]) fillComplex(schema, schema.complexTypes[baseName], node, stack, maxRec)
    readParticles(schema, ext, node, stack, maxRec)
    return
  }
  if (sc) {
    const ext = kid(sc, 'extension') || kid(sc, 'restriction')
    node.simple = resolveSimple(schema, local(ext.attrs.base), ext)
    readAttributes(schema, ext, node)
    return
  }
  readParticles(schema, ct, node, stack, maxRec)
  readAttributes(schema, ct, node)
}

function readParticles(schema, holder, node, stack, maxRec) {
  for (const c of holder.children) {
    if (c.name === 'sequence' || c.name === 'choice' || c.name === 'all') node.children.push(buildGroup(schema, c, stack, maxRec))
    else if (c.name === 'element') node.children.push(buildElement(schema, c, stack, maxRec))
  }
  readAttributes(schema, holder, node)
}

function buildGroup(schema, g, stack, maxRec) {
  const group = { kind: g.name, ...occ(g), children: [] }
  for (const c of g.children) {
    if (c.name === 'element') group.children.push(buildElement(schema, c, stack, maxRec))
    else if (c.name === 'sequence' || c.name === 'choice' || c.name === 'all') group.children.push(buildGroup(schema, c, stack, maxRec))
  }
  return group
}

function readAttributes(schema, holder, node) {
  for (const a of kids(holder, 'attribute')) {
    const t = local(a.attrs.type)
    const inline = kid(a, 'simpleType')
    node.attrs.push({
      name: a.attrs.name,
      use: a.attrs.use === 'required' ? 'required' : 'optional',
      simple: inline ? resolveSimple(schema, inline) : resolveSimple(schema, t || 'string'),
    })
  }
}

// typeOrNode: a type name string, or an inline <simpleType>; extra = restriction/extension holder with facets
export function resolveSimple(schema, typeOrNode, extra) {
  const out = { builtin: 'string', enums: [], patterns: [] }
  let st = null
  if (typeof typeOrNode === 'string') {
    if (schema.simpleTypes[typeOrNode]) st = schema.simpleTypes[typeOrNode]
    else out.builtin = typeOrNode || 'string'
  } else st = typeOrNode

  if (st) {
    const r = kid(st, 'restriction')
    if (r) {
      const inherited = resolveSimple(schema, local(r.attrs.base) || (kid(r, 'simpleType') || ''), null)
      Object.assign(out, inherited)
      applyFacets(out, r)
    }
  }
  if (extra) applyFacets(out, extra)
  return out
}

function applyFacets(out, r) {
  const en = kids(r, 'enumeration').map((e) => e.attrs.value)
  if (en.length) out.enums = en
  const pt = kids(r, 'pattern').map((e) => e.attrs.value)
  if (pt.length) out.patterns = pt
  for (const f of ['minLength', 'maxLength', 'length', 'minInclusive', 'maxInclusive', 'minExclusive', 'maxExclusive', 'totalDigits', 'fractionDigits']) {
    const e = kid(r, f)
    if (e) out[f] = Number.isNaN(Number(e.attrs.value)) ? e.attrs.value : Number(e.attrs.value)
  }
}

function assignIds(node, parentId, suffix = '') {
  node.id = `${parentId}/${node.kind === 'element' ? node.name : '#' + node.kind}${suffix}`
  const key = (c) => (c.kind === 'element' ? c.name : c.kind)
  const total = {}
  for (const c of node.children || []) total[key(c)] = (total[key(c)] || 0) + 1
  const seen = {}
  for (const c of node.children || []) {
    seen[key(c)] = (seen[key(c)] || 0) + 1
    assignIds(c, node.id, total[key(c)] > 1 ? `~${seen[key(c)]}` : '')
  }
}

export function listChoices(node, out = []) {
  if (node.kind === 'choice') out.push({ id: node.id, options: node.children.map((c) => (c.kind === 'element' ? c.name : `(${c.kind})`)) })
  for (const c of node.children || []) listChoices(c, out)
  return out
}
