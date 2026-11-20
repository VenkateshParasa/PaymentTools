// VMF (XML "externalmessage" definition) -> { info, model, rules, warnings }
//   model: same shape as lib/xsd/xsdParser.js buildModel(), so the existing sample generator works on it.
//   rules: every <fieldvalidation> (several <validationrules> blocks are merged).
// Field layout read from the VMF:
//   <field xsi:type="XMLSectionType|XMLFieldType"> name, datatype, detailed-name, minoccurs, maxoccurs, required,
//     xml-name[@namespace], xmltype, node-type (element|attribute), facets (minLength, maxLength, pattern, ...),
//     field-attributes/field-attribute[@name="xmlType"], fields (model + child fields)
import { parseXmlTree } from './xmlTree.js'
import { assignIds } from '../xsd/xsdParser.js'

const kid = (n, name) => n.children.find((c) => c.name === name)
const kids = (n, name) => n.children.filter((c) => c.name === name)
const txt = (n, name) => kid(n, name)?.text ?? ''
const BUILTIN = { string: 'string', text: 'string', decimal: 'decimal', amount: 'decimal', number: 'decimal', integer: 'integer', int: 'integer', long: 'integer', boolean: 'boolean', date: 'date', datetime: 'dateTime', time: 'time' }
const NUM_FACETS = ['minLength', 'maxLength', 'length', 'totalDigits', 'fractionDigits', 'minInclusive', 'maxInclusive', 'minExclusive', 'maxExclusive']

function occurs(v, dflt) {
  const t = String(v ?? '').trim().toLowerCase()
  if (t === '') return dflt
  if (['unbounded', '-1', '*', 'n'].includes(t)) return Infinity
  const n = Number(t)
  return Number.isNaN(n) ? dflt : n
}

function simpleOf(f) {
  const out = { builtin: 'string', enums: [], patterns: [] }
  const xt = (txt(f, 'xmltype') || txt(f, 'datatype') || 'string').replace(/^.*:/, '')
  out.builtin = BUILTIN[xt.toLowerCase()] || (BUILTIN[txt(f, 'datatype').toLowerCase()] ?? 'string')
  const facets = kid(f, 'facets')
  const lowerNum = Object.fromEntries(NUM_FACETS.map((k) => [k.toLowerCase(), k]))
  const visit = (n) => {
    for (const c of n.children) {
      const key = c.name.toLowerCase()
      const value = c.attrs.value
      if (value !== undefined) {
        if (key === 'pattern') out.patterns.push(value)
        else if (key === 'enumeration' || key === 'enum') out.enums.push(value)
        else if (lowerNum[key]) out[lowerNum[key]] = Number.isNaN(Number(value)) ? value : Number(value)
      }
      if (c.children.length) visit(c)
    }
  }
  if (facets) visit(facets)
  return out
}

function metaOf(f, scope = 'data') {
  const fa = {}
  for (const a of kids(kid(f, 'field-attributes') || { children: [] }, 'field-attribute')) fa[a.attrs.name] = a.text
  return {
    name: txt(f, 'name'),
    datatype: txt(f, 'datatype'),
    xmlType: fa.xmlType || '',
    fieldAttributes: fa,
    scope,
  }
}

function nodeOf(f, warnings, ctx) {
  const meta = metaOf(f, ctx.scope)
  const xmlName = kid(f, 'xml-name')
  const tag = (xmlName?.text || meta.name || '').trim()
  if (!tag) { warnings.push('A field without a name was skipped.'); return null }
  if (xmlName?.attrs.namespace && !ctx.ns) ctx.ns = xmlName.attrs.namespace
  const required = txt(f, 'required').toLowerCase() === 'true'
  const min = occurs(txt(f, 'minoccurs'), required ? 1 : 0)
  const max = occurs(txt(f, 'maxoccurs'), 1)
  const fieldsNode = kid(f, 'fields')
  const sub = fieldsNode ? kids(fieldsNode, 'field') : []
  const isAttr = (x) => txt(x, 'node-type').toLowerCase() === 'attribute'
  const subEls = sub.filter((x) => !isAttr(x))
  const attrs = sub.filter(isAttr).map((a) => {
    const m = metaOf(a, ctx.scope)
    return { name: (kid(a, 'xml-name')?.text || m.name).trim(), use: txt(a, 'required').toLowerCase() === 'true' ? 'required' : 'optional', simple: simpleOf(a), vmf: m }
  })
  const node = { kind: 'element', name: tag, min, max, doc: txt(f, 'detailed-name'), typeName: meta.xmlType || txt(f, 'xmltype'), attrs, children: [], simple: null, vmf: meta }
  if (subEls.length) {
    const model = (txt(fieldsNode, 'model') || 'sequence').toLowerCase()
    const group = { kind: ['choice', 'all'].includes(model) ? model : 'sequence', min: 1, max: 1, children: [] }
    for (const x of subEls) {
      if ((x.attrsFull['xsi:type'] || '').toLowerCase().includes('choice')) warnings.push(`${meta.name}: a choice-type field "${txt(x, 'name')}" was read as a plain field.`)
      const c = nodeOf(x, warnings, ctx)
      if (c) group.children.push(c)
    }
    node.children = [group]
  } else node.simple = simpleOf(f)
  return node
}

export function parseVmfTree(tree) {
  const warnings = []
  if (tree.name !== 'externalmessage') warnings.push(`Root element is <${tree.name}>, expected <externalmessage>; reading it anyway.`)
  const xf = kid(tree, 'xmlfields')
  if (!xf) throw new Error('No <xmlfields> section found: this does not look like an XML-format VMF.')
  const data = kid(xf, 'datafields')
  const top = data ? kids(data, 'field') : []
  if (!top.length) throw new Error('No field found under <datafields>.')
  if (top.length > 1) warnings.push(`<datafields> has ${top.length} top-level fields; the first (${txt(top[0], 'name')}) is used as the message root.`)
  const ctx = { ns: '', scope: 'data' }
  const root = nodeOf(top[0], warnings, ctx)
  root.min = 1; root.max = 1
  assignIds(root, '')
  // header and trailer fields use the same layout as data fields; each top-level field becomes its own part (own root element)
  // partInfo records what was found vs what could be built, so the UI can say "no fields" / "ok" / "incomplete"
  const parts = { header: [], trailer: [] }
  const partInfo = { header: { found: 0, built: 0 }, trailer: { found: 0, built: 0 }, issues: [] }
  for (const [key, secName] of [['header', 'headerfields'], ['trailer', 'trailerfields']]) {
    const sec = kid(xf, secName)
    for (const f of sec ? kids(sec, 'field') : []) {
      partInfo[key].found++
      try {
        const c = { ns: '', scope: key }
        const before = warnings.length
        const node = nodeOf(f, warnings, c)
        if (warnings.length > before) partInfo.issues.push(...warnings.slice(before).map((w) => `${key}: ${w}`))
        if (!node) { partInfo.issues.push(`${key}: a field could not be read`); continue }
        node.min = 1; node.max = 1
        assignIds(node, '')
        parts[key].push({ targetNamespace: c.ns || ctx.ns, root: node })
        partInfo[key].built++
      } catch (e) { partInfo.issues.push(`${key}: ${e.message}`) }
    }
  }

  const rules = []
  const walk = (n, set, scope) => {
    for (const c of n.children) {
      if (c.name === 'fieldvalidation') rules.push(ruleOf(c, set, scope))
      else walk(c, set, /^hdr/.test(c.name) ? 'header' : /^trl|^trailer/.test(c.name) ? 'trailer' : /^data/.test(c.name) ? 'data' : scope)
    }
  }
  for (const vr of kids(tree, 'validationrules')) walk(vr, vr.attrs.name || '(unnamed)', '')
  for (const vr of tree.children.filter((c) => c.name !== 'validationrules' && c.name !== 'xmlfields')) if (/validation/.test(vr.name)) walk(vr, vr.name, '')

  const functions = extractFunctions(tree)
  const info = {
    standardName: txt(tree, 'standard-name') || kid(tree, 'standard')?.text || '',
    version: txt(tree, 'standard-version'),
    detailedName: txt(tree, 'standard-detailed-name'),
    namespace: ctx.ns,
    root: root.name,
  }
  const diagnostics = { topLevel: [...new Set(tree.children.map((c) => c.name))] }
  return { info, model: { targetNamespace: ctx.ns, root }, parts, partInfo, rules, functions, diagnostics, warnings }
}

export function parseVmfText(text) {
  if (!text || !text.trim()) throw new Error('Load a VMF file first.')
  return parseVmfTree(parseXmlTree(text))
}

// <fieldname> is "xmlType=X & designerType=Y" (type based) or a plain field name / path
function ruleOf(c, set, scope) {
  const fieldname = txt(c, 'fieldname')
  const match = {}
  for (const part of fieldname.split('&')) {
    const m = /^\s*([A-Za-z]+)\s*=\s*(.+?)\s*$/.exec(part)
    if (m) match[m[1]] = m[2]
  }
  return {
    set, scope, name: txt(c, 'name'), fieldname, match: Object.keys(match).length ? match : { path: fieldname.trim() },
    formula: txt(c, 'formula'), severity: txt(c, 'severity') || 'error', cascade: txt(c, 'cascade'),
    errorCode: txt(c, 'error-code'), message: txt(c, 'actionmessage').replace(/^"|"$/g, ''),
  }
}

const normType = (t) => String(t || '').replace(/---copy\d*$/i, '').trim()
// does the rule apply to a field/attribute with these VMF details?
export function ruleApplies(rule, meta, tag) {
  if (rule.scope && meta.scope && rule.scope !== meta.scope) return false // hdrvalidationrules -> header fields only, etc.
  const m = rule.match
  if (m.xmlType !== undefined) {
    if (normType(m.xmlType) !== normType(meta.xmlType)) return false
    if (m.designerType !== undefined && meta.datatype && m.designerType.toLowerCase() !== meta.datatype.toLowerCase()) return false
    return true
  }
  if (m.path) { const last = m.path.split(/[/.]/).filter(Boolean).pop(); return !!last && (last === tag || last === meta.name) }
  return false
}

// ---- functions defined in the VMF ----
// The VMF stores function code that validation formulas call. Because the exact element layout can vary, this looks for:
//   * function-like elements: <function>/<userfunction>/<udf>/<routine>/<method> with a name, parameters and a body
//     (body in <body>, <code>, <formula>, <implementation>, <script>, <source>, <definition>, <expression> or <content>)
//   * any text block outside the field definitions and the validations that holds Java-like declarations
//     ("boolean IsX(String v) { ... }"), several per block allowed.
// -> [{ name, params, source, where }]
const FN_NODE = /^(user|custom)?functions?$|^udf$|^routine$|^method$/i
const FN_BODY = ['body', 'code', 'formula', 'implementation', 'script', 'source', 'definition', 'expression', 'content']
const KEYWORDS = new Set(['if', 'else', 'for', 'while', 'return', 'switch', 'catch', 'new', 'do'])

function hasDeclaration(text) {
  const re = /(?:^|[\s;}])(?:(?:public|private|protected|static|final)\s+)*([A-Za-z_][\w<>\[\]]*)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g
  let m
  while ((m = re.exec(text))) if (!KEYWORDS.has(m[1]) && !KEYWORDS.has(m[2])) return true
  return /(?:^|[\s;}])function\s+[A-Za-z_]\w*\s*\(/.test(text)
}

function paramsOf(n) {
  const holder = n.children.find((c) => /^(params?|parameters|arguments|args)$/i.test(c.name))
  if (holder) {
    if (holder.children.length) return holder.children.map((c) => (c.children.find((x) => x.name === 'name')?.text || c.attrs.name || c.text || '').trim()).filter(Boolean)
    return holder.text.split(',').map((x) => x.trim().split(/\s+/).pop()).filter(Boolean)
  }
  if (n.attrs.params || n.attrs.parameters) return (n.attrs.params || n.attrs.parameters).split(',').map((x) => x.trim().split(/\s+/).pop()).filter(Boolean)
  return []
}

export function extractFunctions(tree) {
  const defs = []
  const walk = (n, path) => {
    if (n.name === 'xmlfields' || n.name === 'fieldvalidation') return
    const here = `${path}/${n.name}`
    if (FN_NODE.test(n.name) && !/s$/i.test(n.name.replace(/functions$/i, '')) && (n.children.length || n.text)) {
      const name = (n.children.find((c) => c.name === 'name')?.text || n.attrs.name || '').trim()
      const bodyNode = FN_BODY.map((k) => n.children.find((c) => c.name === k)).find((c) => c && c.text)
      const source = bodyNode ? bodyNode.text : (!n.children.length ? n.text : '')
      if (source && (name || hasDeclaration(source))) { defs.push({ name, params: paramsOf(n), source, where: here }); return }
    }
    if (!n.children.length && n.text && n.text.includes('{') && hasDeclaration(n.text) && !/^\s*(if|return)\b/.test(n.text)) {
      defs.push({ name: '', params: [], source: n.text, where: here })
      return
    }
    for (const c of n.children) walk(c, here)
  }
  for (const c of tree.children) walk(c, '')
  return defs
}
