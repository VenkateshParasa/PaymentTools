// Small dependency-free XML reader (browser and Node): handles CDATA, entities, comments, DOCTYPE, namespaces prefixes.
// Result nodes: { name (local), qname, attrs (by local name), attrsFull (by qualified name), children, text }
// text is only kept for leaf nodes (trimmed), like domToTree() in lib/xsd/xsdParser.js.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e]))
const local = (n) => n.replace(/^.*:/, '')

function tagEnd(src, from) {
  let q = ''
  for (let i = from; i < src.length; i++) {
    const c = src[i]
    if (q) { if (c === q) q = '' } else if (c === '"' || c === "'") q = c
    else if (c === '>') return i
  }
  throw new Error('XML is not well-formed: unterminated tag')
}

export function parseXmlTree(src) {
  const root = { name: '#root', qname: '#root', attrs: {}, attrsFull: {}, children: [], text: '' }
  const stack = [root]
  const n = src.length
  let i = 0
  const cur = () => stack[stack.length - 1]
  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt < 0) { cur().text += decode(src.slice(i)); break }
    if (lt > i) cur().text += decode(src.slice(i, lt))
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); if (e < 0) throw new Error('XML is not well-formed: unterminated comment'); i = e + 3; continue }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt + 9); if (e < 0) throw new Error('XML is not well-formed: unterminated CDATA'); cur().text += src.slice(lt + 9, e); i = e + 3; continue }
    if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt); if (e < 0) throw new Error('XML is not well-formed: unterminated declaration'); i = e + 2; continue }
    if (src.startsWith('<!', lt)) {
      let d = lt + 2, depth = 0
      for (; d < n; d++) { const c = src[d]; if (c === '[') depth++; else if (c === ']') depth--; else if (c === '>' && depth <= 0) break }
      i = d + 1; continue
    }
    const gt = tagEnd(src, lt + 1)
    const body = src.slice(lt + 1, gt)
    if (body[0] === '/') {
      const node = stack.pop()
      if (stack.length === 0 || node.qname !== body.slice(1).trim()) throw new Error(`XML is not well-formed: </${body.slice(1).trim()}> does not match <${node.qname}>`)
      node.text = node.children.length ? '' : node.text.trim()
    } else {
      const self = body.endsWith('/')
      const m = /^([^\s/>]+)/.exec(body)
      if (!m) throw new Error('XML is not well-formed: empty tag name')
      const node = { name: local(m[1]), qname: m[1], attrs: {}, attrsFull: {}, children: [], text: '' }
      const re = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
      let a
      const rest = body.slice(m[0].length)
      while ((a = re.exec(rest))) {
        const v = decode(a[2] ?? a[3])
        node.attrsFull[a[1]] = v
        node.attrs[local(a[1])] = v
      }
      cur().children.push(node)
      if (self) node.text = ''
      else stack.push(node)
    }
    i = gt + 1
  }
  if (stack.length !== 1) throw new Error(`XML is not well-formed: <${cur().qname}> is not closed`)
  if (root.children.length !== 1) throw new Error('XML is not well-formed: expected exactly one root element')
  return root.children[0]
}
