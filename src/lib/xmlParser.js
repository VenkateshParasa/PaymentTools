import { explainElement, CODE_SETS } from '../content/fieldDictionary.js'

// Parse ISO 20022 XML into an annotated tree using the browser's DOMParser.
// Returns { ok, tree, error, namespace, messageType }.
export function parseIso20022(xmlString) {
  if (!xmlString || !xmlString.trim()) {
    return { ok: false, error: 'Paste an XML message to begin.' }
  }
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlString, 'application/xml')
  const parseErr = doc.querySelector('parsererror')
  if (parseErr) {
    return { ok: false, error: 'Invalid XML: ' + parseErr.textContent.split('\n')[0] }
  }
  const root = doc.documentElement
  const namespace = root.getAttribute('xmlns') || root.namespaceURI || ''
  const messageType = deriveType(namespace)

  return { ok: true, tree: toNode(root), namespace, messageType }
}

function deriveType(ns) {
  // e.g. urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08
  const m = ns.match(/([a-z]+\.\d{3}\.\d{3}\.\d{2})$/)
  return m ? m[1] : null
}

function localName(node) {
  return node.localName || node.nodeName.replace(/^.*:/, '')
}

function toNode(el) {
  const name = localName(el)
  const children = Array.from(el.children)
  const attrs = Array.from(el.attributes || [])
    .filter((a) => a.name !== 'xmlns' && !a.name.startsWith('xmlns:'))
    .map((a) => ({ name: a.name, value: a.value }))

  const node = {
    name,
    explanation: explainElement(name),
    attrs,
  }
  if (children.length === 0) {
    const text = el.textContent.trim()
    node.value = text
    node.codeMeaning = CODE_SETS[text] || null
  } else {
    node.children = children.map(toNode)
  }
  return node
}

// Lightweight structural checks that teach common pitfalls (not full XSD validation).
export function lintIso20022(tree, messageType) {
  const findings = []
  if (!tree) return findings

  const flat = []
  const walk = (n) => {
    flat.push(n)
    n.children?.forEach(walk)
  }
  walk(tree)

  const has = (name) => flat.some((n) => n.name === name)
  const get = (name) => flat.find((n) => n.name === name)

  if (!has('GrpHdr') && !messageType?.startsWith('camt.056')) {
    findings.push({ level: 'warn', msg: 'No GroupHeader (GrpHdr) found — most pacs/pain messages require one.' })
  }
  const uetr = get('UETR') || get('OrgnlUETR')
  if (uetr?.value && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uetr.value)) {
    findings.push({ level: 'warn', msg: `UETR "${uetr.value}" is not a valid UUID v4.` })
  }
  flat
    .filter((n) => n.name === 'ChrgBr' && n.value)
    .forEach((n) => {
      if (!['DEBT', 'CRED', 'SHAR'].includes(n.value)) {
        findings.push({ level: 'error', msg: `ChrgBr "${n.value}" is invalid — must be DEBT, CRED or SHAR.` })
      }
    })
  flat
    .filter((n) => n.name === 'BICFI' && n.value)
    .forEach((n) => {
      if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(n.value)) {
        findings.push({ level: 'warn', msg: `BICFI "${n.value}" doesn't look like a valid 8/11-char BIC.` })
      }
    })
  flat
    .filter((n) => n.name === 'IBAN' && n.value)
    .forEach((n) => {
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(n.value.replace(/\s/g, ''))) {
        findings.push({ level: 'warn', msg: `IBAN "${n.value}" doesn't match the expected pattern.` })
      }
    })

  if (findings.length === 0) findings.push({ level: 'ok', msg: 'No structural issues detected by the basic linter.' })
  return findings
}
