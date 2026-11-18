// Extract text from a text-based PDF with no library: inflate every FlateDecode stream and read
// the text operators (Tj / TJ). Works for the ISO 20022 MDR PDFs. `inflate` is injected so the same
// code runs in the browser (DecompressionStream) and in Node (zlib) for tests and CLI.

export async function browserInflate(bytes) {
  try {
    const ds = new DecompressionStream('deflate')
    const w = ds.writable.getWriter()
    w.write(bytes).catch(() => {})
    w.close().catch(() => {})
    return new Uint8Array(await new Response(ds.readable).arrayBuffer())
  } catch {
    return null
  }
}

function latin1(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 32768) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768))
  return out
}

function textOf(content) {
  const out = []
  const re = /\[([\s\S]*?)\]\s*TJ|\(([\s\S]*?)(?<!\\)\)\s*Tj/g
  let m
  while ((m = re.exec(content))) {
    if (m[1] !== undefined) {
      let s = ''
      for (const x of m[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)) s += x[1]
      out.push(s)
    } else out.push(m[2])
  }
  return out.join(' ').replace(/\\\(/g, '(').replace(/\\\)/g, ')')
}

// -> array of page-like text blocks (one per content stream that has text)
export async function extractPdfPages(buffer, inflate, onProgress) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const s = latin1(bytes)
  const marks = [...s.matchAll(/stream\r?\n/g)]
  const pages = []
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index + marks[i][0].length
    const end = s.indexOf('endstream', start)
    if (end < 0) continue
    const dict = s.slice(Math.max(0, marks[i].index - 400), marks[i].index)
    const d = dict.slice(dict.lastIndexOf('<<'))
    if (!/FlateDecode/.test(d) || /\/Subtype\s*\/Image|\/Length1|\/Type\s*\/XRef|\/Type\s*\/ObjStm|\/FontFile/.test(d)) continue
    // The end-of-line before "endstream" is not part of the data, but a legitimate checksum byte can look
    // like one, and DecompressionStream rejects trailing bytes: try as-is, then without LF, then without CRLF.
    let raw = null
    for (const cut of [0, 1, 2]) {
      if (cut && !(bytes[end - 1] === 10 || bytes[end - 1] === 13)) break
      raw = await inflate(bytes.subarray(start, end - cut))
      if (raw) break
    }
    if (!raw) continue
    const content = latin1(raw)
    if (!content.includes('BT')) continue
    const t = textOf(content)
    if (t) pages.push(t)
    if (onProgress && i % 100 === 0) onProgress(i / marks.length)
  }
  return pages
}
