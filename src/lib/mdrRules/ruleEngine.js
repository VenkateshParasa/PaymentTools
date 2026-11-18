// MDR constraint engine: binds rules (long element names, from the extractor JSON) to a parsed XSD
// model, then evaluates them on a generic XML tree ({ name, attrs, children, text }).
//
// Rule paths are relative to the component the rule is defined on. We find that component without
// reading the PDF's "defined at" text: a context is any model element from which every path in the
// rule can be resolved (long name -> XML tag via the rule file's tag table).

const ATTR = { Currency: 'Ccy' }

export function parsePath(path) {
  const segs = path.split('/').filter(Boolean)
  let attr = null
  if (segs.length && segs[segs.length - 1].startsWith('attribute::')) {
    const a = segs.pop().slice('attribute::'.length)
    attr = ATTR[a] || a
  }
  return { segs: segs.map((s) => s.replace(/\[.*\]$/, '')), attr }
}

export function childElements(node) {
  const out = []
  for (const c of node.children || []) {
    if (c.kind === 'element') out.push(c)
    else out.push(...childElements(c))
  }
  return out
}

function resolve(start, segs, tags) {
  let cur = start
  const chain = []
  for (const seg of segs) {
    const cands = tags[seg] || [seg]
    const next = childElements(cur).find((c) => cands.includes(c.name))
    if (!next) return null
    chain.push(next.name)
    cur = next
  }
  return { node: cur, chain }
}

function collectPaths(expr, out = new Set()) {
  if (!expr) return out
  if (expr.path) out.add(expr.path)
  if (expr.path2) out.add(expr.path2)
  for (const a of expr.args || []) collectPaths(a, out)
  return out
}

function walk(node, fn) {
  if (node.kind === 'element') fn(node)
  for (const c of node.children || []) walk(c, fn)
}

const tagPathOf = (id) => id.split('/').filter((s) => s && !s.startsWith('#')).map((s) => s.replace(/~\d+$/, ''))

// -> [{ rule, contexts: [{ node, tagPath, targets: { [path]: { node, chain, attr } } }] }]
export function bindRules(rulesFile, model) {
  const tags = rulesFile.tags || {}
  const bound = []
  for (const rule of rulesFile.rules) {
    const b = { rule, contexts: [] }
    if (rule.condition) {
      const paths = [...collectPaths(rule.condition.when), ...collectPaths(rule.condition.then)]
      const uniq = [...new Set(paths)]
      walk(model.root, (node) => {
        const targets = {}
        for (const p of uniq) {
          const { segs, attr } = parsePath(p)
          const r = resolve(node, segs, tags)
          if (!r) return
          targets[p] = { ...r, attr }
        }
        b.contexts.push({ node, tagPath: tagPathOf(node.id), targets })
      })
    }
    bound.push(b)
  }
  return bound
}

export function findInstances(tree, tagPath) {
  if (!tree || tree.name !== tagPath[0]) return []
  let cur = [tree]
  for (const t of tagPath.slice(1)) cur = cur.flatMap((e) => e.children.filter((c) => c.name === t))
  return cur
}

const elementsAt = (el, chain) => chain.reduce((acc, t) => acc.flatMap((e) => e.children.filter((c) => c.name === t)), [el])

function evalExpr(expr, el, ctx, codes) {
  switch (expr.op) {
    case 'and': return expr.args.every((a) => evalExpr(a, el, ctx, codes))
    case 'or': return expr.args.some((a) => evalExpr(a, el, ctx, codes))
    case 'present': case 'mustPresent': return elementsAt(el, ctx.targets[expr.path].chain).length > 0
    case 'absent': case 'mustAbsent': return elementsAt(el, ctx.targets[expr.path].chain).length === 0
    case 'equals': {
      const want = [expr.value, codes[expr.value]].filter(Boolean)
      return elementsAt(el, ctx.targets[expr.path].chain).some((e) => want.includes(e.text))
    }
    case 'anyEquals':
      return elementsAt(el, ctx.targets[expr.path].chain).some((e) => expr.values.includes(e.text))
    case 'ccyDiff': case 'ccyEq': {
      const a = elementsAt(el, ctx.targets[expr.path].chain)[0]
      const b = elementsAt(el, ctx.targets[expr.path2].chain)[0]
      const ca = a?.attrs?.[ctx.targets[expr.path].attr || 'Ccy']
      const cb = b?.attrs?.[ctx.targets[expr.path2].attr || 'Ccy']
      if (!ca || !cb) return false
      return expr.op === 'ccyEq' ? ca === cb : ca !== cb
    }
    default: return false
  }
}

const SUPPORTED_THEN = new Set(['mustPresent', 'mustAbsent', 'and', 'or'])
const supported = (e) => e && (e.args ? e.args.every(supported) : true) && (SUPPORTED_THEN.has(e.op) || ['present', 'absent', 'equals', 'anyEquals', 'ccyDiff', 'ccyEq'].includes(e.op))

// Validate a parsed sample. Returns { rules: [...], failures: [{ bound, ctx, index }] }.
export function validateTree(tree, bound, rulesFile) {
  const codes = rulesFile.codes || {}
  const out = []
  const failures = []
  for (const b of bound) {
    const r = b.rule
    const base = { id: r.id, name: r.name, kind: r.kind, automation: r.automation, text: r.text }
    if (!r.condition) {
      // guidelines are advisory by nature; a hard rule written only as free text cannot be checked automatically
      out.push({ ...base, status: r.kind === 'guideline' ? 'advisory' : 'notchecked', detail: r.kind === 'guideline' ? [] : ['Written as free text only; not machine-checkable.'] })
      continue
    }
    if (!supported(r.condition.then) || (r.condition.when && !supported(r.condition.when))) {
      out.push({ ...base, status: 'notchecked', detail: ['Condition uses an operator this engine does not support.'] }); continue
    }
    if (!b.contexts.length) { out.push({ ...base, status: 'notchecked', detail: ['Elements of this rule were not found in the loaded XSD.'] }); continue }
    let pass = 0, fail = 0
    const detail = []
    for (const ctx of b.contexts) {
      const instances = findInstances(tree, ctx.tagPath)
      instances.forEach((el, index) => {
        const applies = r.condition.when ? evalExpr(r.condition.when, el, ctx, codes) : true
        if (!applies) return
        if (evalExpr(r.condition.then, el, ctx, codes)) pass++
        else {
          fail++
          detail.push(`Violated at /${ctx.tagPath.join('/')}${instances.length > 1 ? ` #${index + 1}` : ''}`)
          failures.push({ bound: b, ctx, index })
        }
      })
    }
    out.push({ ...base, status: fail ? 'fail' : pass ? 'pass' : 'na', detail })
  }
  return { rules: out, failures }
}

// Actions that would satisfy the "then" part of a failed rule.
export function planFix(expr, ctx, exclude) {
  const act = (op, path) => ({ type: op === 'mustPresent' ? 'include' : 'exclude', id: ctx.targets[path].node.id, min: ctx.targets[path].node.min, label: ctx.targets[path].node.name, chain: ctx.targets[path].chain })
  switch (expr.op) {
    case 'mustPresent': case 'mustAbsent': return [act(expr.op, expr.path)]
    case 'and': return expr.args.flatMap((a) => planFix(a, ctx, exclude))
    case 'or': {
      const options = expr.args.map((a) => planFix(a, ctx, exclude))
      const free = options.find((o) => o.every((a) => !(a.type === 'include' && exclude.has(a.id))))
      return free || options[0] || []
    }
    default: return []
  }
}
