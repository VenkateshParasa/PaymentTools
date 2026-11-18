// Tiny XML reader for Node (no DOM, no libraries). Produces the same generic tree as domToTree():
// { name, attrs, children, text }. Good enough for XSDs and the XML this project generates.
export function xmlToTree(xml) {
  xml = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  const re = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g
  const stack = [{ children: [] }]
  let m
  while ((m = re.exec(xml))) {
    if (m[5] !== undefined) { const t = stack.at(-1); if (m[5].trim()) t.text = (t.text || '') + m[5].trim(); continue }
    const [, close, name, rawAttrs, self] = m
    if (close) { stack.pop(); continue }
    const attrs = {}
    for (const a of rawAttrs.matchAll(/([\w:.-]+)="([^"]*)"/g)) attrs[a[1].replace(/^.*:/, '')] = a[2]
    const node = { name: name.replace(/^.*:/, ''), attrs, children: [], text: '' }
    stack.at(-1).children.push(node)
    if (!self) stack.push(node)
  }
  return stack[0].children[0]
}
