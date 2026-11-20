// Test helper: turn an ISO 20022 XSD into a VMF-style document (same field layout as the real VMF screenshots) so the VMF
// module can be tested on a full-size message. Mixed sequence/choice content is flattened (first choice member kept).
import { parseXsdTree, buildModel } from '../../src/lib/xsd/xsdParser.js'
import { parseXmlTree } from '../../src/lib/vmf/xmlTree.js'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const DT = { string: 'String', decimal: 'Decimal', dateTime: 'DateTime', date: 'Date', boolean: 'Boolean', integer: 'Integer' }
const ATTR_TYPE = { Ccy: 'ActiveCurrencyCode' }

function members(n) {
  // element children of a model node, with the group kind
  const g = n.children[0]
  if (!g) return { model: 'sequence', list: [] }
  if (g.kind === 'choice') return { model: 'choice', list: g.children.filter((c) => c.kind === 'element') }
  const list = []
  const take = (grp) => { for (const c of grp.children) { if (c.kind === 'element') list.push(c); else if (c.kind === 'choice') { const f = c.children.find((x) => x.kind === 'element'); if (f) list.push({ ...f, min: 0 }) } else take(c) } }
  take(g)
  return { model: 'sequence', list }
}
function facets(s) {
  if (!s) return ''
  const out = []
  for (const k of ['minLength', 'maxLength', 'length', 'totalDigits', 'fractionDigits', 'minInclusive', 'maxInclusive']) if (s[k] !== undefined) out.push(`<${k} value="${s[k]}"/>`)
  for (const p of s.patterns || []) out.push(`<pattern value="${esc(p)}"/>`)
  for (const e of s.enums || []) out.push(`<enumeration value="${esc(e)}"/>`)
  return `<facets>${out.join('')}</facets>`
}
function emit(n, ns, d = 0) {
  const { model, list } = members(n)
  const section = list.length > 0
  const attrs = (n.attrs || []).map((a) => `<field xsi:type="XMLFieldType"><name>${a.name}</name><datatype>String</datatype><required>${a.use === 'required'}</required><xml-name namespace="${ns}">${a.name}</xml-name><xmltype>${a.simple?.builtin || 'string'}</xmltype><node-type>attribute</node-type>${facets(a.simple)}<field-attributes><field-attribute name="xmlType" runtime="false">${ATTR_TYPE[a.name] || a.name}</field-attribute></field-attributes></field>`)
  const kids = section ? list.map((c) => emit(c, ns, d + 1)) : []
  const fields = kids.length || attrs.length ? `<fields><model>${model}</model>${[...attrs, ...kids].join('')}</fields>` : ''
  const occ = section
    ? `<minoccurs>${n.min}</minoccurs><maxoccurs>${n.max === Infinity ? 'unbounded' : n.max}</maxoccurs>`
    : `<required>${n.min >= 1}</required>${n.max > 1 ? `<maxoccurs>${n.max === Infinity ? 'unbounded' : n.max}</maxoccurs>` : ''}`
  const b = n.simple?.builtin || 'string'
  return `<field xsi:type="${section ? 'XMLSectionType' : 'XMLFieldType'}"><name>${n.name}</name><datatype>${section ? 'Section' : DT[b] || 'String'}</datatype><detailed-name><![CDATA[${n.name}]]></detailed-name>${occ}<xml-name namespace="${ns}">${n.name}</xml-name>${section ? '' : `<xmltype>${b}</xmltype>`}<node-type>element</node-type>${section ? '' : facets(n.simple)}<field-attributes><field-attribute name="xmlType" runtime="false">${n.typeName || n.name}</field-attribute></field-attributes>${fields}</field>`
}

export function xsdToVmf(xsdText, rules = '') {
  const parsed = parseXsdTree(parseXmlTree(xsdText))
  const model = buildModel(parsed.schema, parsed.roots[0])
  const ns = model.targetNamespace
  const msg = members(model.root).list[0]
  return `<?xml version="1.0" encoding="UTF-8"?>
<externalmessage xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="XMLFormat"><standard-name>${ns.split(':').pop()}_CORE</standard-name><xmlfields id="x"><headerfields/><datafields><model>sequence</model>${emit(msg, ns)}</datafields><trailerfields/></xmlfields>${rules}</externalmessage>`
}
