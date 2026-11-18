import { domToTree } from '../xsd/xsdParser.js'
// Browser XML text -> generic tree used by the rule engine.
export function xmlToTree(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('XML is not well-formed')
  return domToTree(doc.documentElement)
}
