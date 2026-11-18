const q = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
// UTF-8 BOM so Excel opens accents correctly.
export const toCsv = (header, rows) => '﻿' + [header, ...rows].map((r) => r.map(q).join(',')).join('\n') + '\n'
