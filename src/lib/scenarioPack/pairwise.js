// Pairwise (all-pairs) covering set, greedy. factors: number[] (how many values each factor has).
// Returns tests: number[][] (one value index per factor) such that every pair of values of any two
// factors appears in at least one test (or the cap is reached: then `capped` is true).
export function pairwise(levels, max = 500) {
  const n = levels.length
  const tests = []
  if (n === 0) return { tests, capped: false, pairs: 0 }
  if (n === 1) return { tests: Array.from({ length: levels[0] }, (_, v) => [v]), capped: false, pairs: 0 }
  const key = (i, a, j, b) => ((i * 4096 + j) * 64 + a) * 64 + b // i < j
  const covered = new Set()
  let total = 0
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) total += levels[i] * levels[j]
  const mark = (t) => { for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) covered.add(key(i, t[i], j, t[j])) }
  const gain = (t, f, v, assigned) => {
    let g = 0
    for (const o of assigned) {
      const [i, a, j, b] = o < f ? [o, t[o], f, v] : [f, v, o, t[o]]
      if (!covered.has(key(i, a, j, b))) g++
    }
    return g
  }
  let capped = false
  while (covered.size < total) {
    if (tests.length >= max) { capped = true; break }
    // seed: first uncovered pair
    let seed = null
    outer: for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
      for (let a = 0; a < levels[i]; a++) for (let b = 0; b < levels[j]; b++)
        if (!covered.has(key(i, a, j, b))) { seed = [i, a, j, b]; break outer }
    const t = new Array(n).fill(0)
    t[seed[0]] = seed[1]; t[seed[2]] = seed[3]
    const assigned = [seed[0], seed[2]]
    const done = new Set(assigned)
    for (let f = 0; f < n; f++) {
      if (done.has(f)) continue
      let best = 0, bestG = -1
      for (let v = 0; v < levels[f]; v++) { const g = gain(t, f, v, assigned); if (g > bestG) { bestG = g; best = v } }
      t[f] = best; assigned.push(f)
    }
    tests.push(t); mark(t)
  }
  return { tests, capped, pairs: total }
}
