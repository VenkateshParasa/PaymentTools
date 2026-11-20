// Interpreter for the Java-like code in a VMF: validation formulas and the functions they call.
//   IsISOCurrencyCode($value)
//   if(!IsISOCurrencyCode($value.Ccy)) { return false; } return IsValidDecimals($value.Ccy, toText($value.Value, false));
// Supported: if/else, for, while, break, continue, return, typed or `var` locals, = += -= *= /= ++ --, && || ! == != < > <= >= + - * / %,
// ?:, member access, array index, calls to functions defined in the VMF or built in, String/Character/Math/Integer helpers.
// Anything else (new, try, switch, generics, ...) throws Unsupported, so a formula is never guessed at.
import { FUNCTIONS, STRING_METHODS, STATICS, Char } from './functions.js'

export class Unsupported extends Error {}

const OPS2 = ['&&', '||', '==', '!=', '<=', '>=', '++', '--', '+=', '-=', '*=', '/=']
const SINGLE = '+-*/%<>!?:.,;(){}[]='
const KW_STOP = new Set(['switch', 'try', 'new', 'throw', 'import', 'class', 'do', 'catch', 'finally', 'synchronized', 'instanceof'])
const MODIFIERS = new Set(['public', 'private', 'protected', 'static', 'final', 'function'])
const NOT_TYPE = new Set(['if', 'else', 'for', 'while', 'return', 'break', 'continue', 'true', 'false', 'null', 'new'])
const STEP_LIMIT = 200000

function tokenize(src) {
  const t = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue }
    if (src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue }
    if (c === '"' || c === "'") {
      let s = '', j = i + 1
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') { j++; s += { n: '\n', t: '\t' }[src[j]] ?? src[j] } else s += src[j]; j++ }
      if (j >= src.length) throw new Unsupported('unterminated string literal')
      t.push(c === "'" && [...s].length === 1 ? { k: 'chr', v: s } : { k: 'str', v: s }); i = j + 1; continue
    }
    const num = /^\d+(\.\d+)?/.exec(src.slice(i))
    if (num) { t.push({ k: 'num', v: Number(num[0]) }); i += num[0].length; continue }
    const id = /^[$A-Za-z_][\w$]*/.exec(src.slice(i))
    if (id) { t.push({ k: 'id', v: id[0] }); i += id[0].length; continue }
    const two = src.slice(i, i + 2)
    if (OPS2.includes(two)) { t.push({ k: 'op', v: two }); i += 2; continue }
    if (SINGLE.includes(c)) { t.push({ k: 'op', v: c }); i++; continue }
    throw new Unsupported(`character "${c}"`)
  }
  return t
}

// -> { body: statements, decls: [{ name, params, body }], calls: [names], lits: { strings, regexes, numbers } }
export function parse(src) {
  const tok = tokenize(src)
  let p = 0
  let calls = new Set()
  const newLits = () => ({ strings: new Set(), regexes: new Set(), numbers: new Set() })
  let lits = newLits()
  const peek = (o = 0) => tok[p + o]
  const isOp = (v, o = 0) => peek(o)?.k === 'op' && peek(o).v === v
  const isId = (v, o = 0) => peek(o)?.k === 'id' && peek(o).v === v
  const eat = (v) => { if (!isOp(v)) throw new Unsupported(`expected "${v}"`); p++ }
  const semi = () => { if (isOp(';')) p++ }

  // [modifiers] [ReturnType] name ( [Type] p, ... ) { body }   (Java or "function name(a, b) { }")
  function tryDeclaration() {
    const save = p
    let q = 0
    while (peek(q)?.k === 'id' && MODIFIERS.has(peek(q).v)) q++
    const hadModifier = q > 0
    const a = peek(q), b = peek(q + 1)
    let nameTok, after
    if (a?.k === 'id' && !NOT_TYPE.has(a.v) && b?.k === 'id' && !NOT_TYPE.has(b.v) && isOp('(', q + 2)) { nameTok = b; after = q + 3 }
    else if (a?.k === 'id' && !NOT_TYPE.has(a.v) && isOp('(', q + 1) && hadModifier) { nameTok = a; after = q + 2 }
    else return null
    p = save + after
    const params = []
    while (!isOp(')')) {
      if (!peek()) { p = save; return null }
      if (isId('final')) p++
      let t1 = peek(); if (t1?.k !== 'id') { p = save; return null }
      p++
      while (isOp('[') && isOp(']', 1)) p += 2
      if (peek()?.k === 'id') { params.push(peek().v); p++ } else params.push(t1.v)
      if (isOp(',')) p++
    }
    p++
    if (isId('throws')) { p += 2 }
    if (!isOp('{')) { p = save; return null }
    // calls and literals inside a function body belong to that function only
    const outer = { calls, lits }
    calls = new Set(); lits = newLits()
    const body = statement()
    const mine = { name: nameTok.v, params, body, calls: [...calls], lits }
    calls = outer.calls; lits = outer.lits
    return mine
  }

  const decls = []
  function statement() {
    if (isOp('{')) { p++; const body = []; while (!isOp('}')) { if (!peek()) throw new Unsupported('missing }'); body.push(statement()) } p++; return { t: 'block', body } }
    const first = peek()
    if (first?.k === 'id' && KW_STOP.has(first.v)) throw new Unsupported(`"${first.v}"`)
    if (isId('if')) {
      p++; eat('('); const cond = expr(); eat(')')
      const then = statement()
      let otherwise = null
      if (isId('else')) { p++; otherwise = statement() }
      return { t: 'if', cond, then, otherwise }
    }
    if (isId('while')) { p++; eat('('); const cond = expr(); eat(')'); return { t: 'while', cond, body: statement() } }
    if (isId('for')) {
      p++; eat('(')
      const init = isOp(';') ? (p++, null) : statement()
      const cond = isOp(';') ? null : expr(); eat(';')
      const upd = isOp(')') ? null : expr(); eat(')')
      return { t: 'for', init, cond, upd, body: statement() }
    }
    if (isId('break')) { p++; semi(); return { t: 'break' } }
    if (isId('continue')) { p++; semi(); return { t: 'continue' } }
    if (isId('return')) { p++; const e = isOp(';') || !peek() ? null : expr(); semi(); return { t: 'return', e } }
    // typed local: [final] Type[] name [= expr];
    let q = 0
    if (isId('final')) q++
    if (peek(q)?.k === 'id' && !NOT_TYPE.has(peek(q).v)) {
      let r = q + 1
      while (isOp('[', r) && isOp(']', r + 1)) r += 2
      if (peek(r)?.k === 'id' && !NOT_TYPE.has(peek(r).v) && (isOp('=', r + 1) || isOp(';', r + 1))) {
        const name = peek(r).v
        if (isOp('=', r + 1)) { p += r + 2; const e = expr(); semi(); return { t: 'let', name, e } }
        p += r + 2; return { t: 'let', name, e: { t: 'lit', v: null } }
      }
    }
    const e = expr(); semi()
    return { t: 'expr', e }
  }
  const expr = () => assign()
  function assign() {
    const l = ternary()
    if (peek()?.k === 'op' && ['=', '+=', '-=', '*=', '/='].includes(peek().v)) {
      if (l.t !== 'var') throw new Unsupported('assignment target')
      const o = peek().v; p++
      return { t: 'assign', o, name: l.name, r: assign() }
    }
    return l
  }
  function ternary() {
    const c = or()
    if (isOp('?')) { p++; const a = ternary(); eat(':'); const b = ternary(); return { t: 'cond', c, a, b } }
    return c
  }
  const bin = (next, ops) => () => { let l = next(); while (peek()?.k === 'op' && ops.includes(peek().v)) { const o = peek().v; p++; l = { t: 'bin', o, l, r: next() } } return l }
  const unary = () => {
    if (isOp('!') || isOp('-')) { const o = peek().v; p++; return { t: 'un', o, e: unary() } }
    if (isOp('++') || isOp('--')) { const d = peek().v === '++' ? 1 : -1; p++; const e = unary(); if (e.t !== 'var') throw new Unsupported('++/-- target'); return { t: 'inc', name: e.name, d, pre: true } }
    return postfix()
  }
  const mul = bin(unary, ['*', '/', '%'])
  const add = bin(mul, ['+', '-'])
  const rel = bin(add, ['<', '>', '<=', '>='])
  const eq = bin(rel, ['==', '!='])
  const and = bin(eq, ['&&'])
  const or = bin(and, ['||'])
  function postfix() {
    let e = primary()
    for (;;) {
      if (isOp('.')) {
        p++; const name = peek()?.v; if (peek()?.k !== 'id') throw new Unsupported('member name'); p++
        if (isOp('(')) {
          const args = argList(); calls.add(`.${name}`)
          if (name === 'matches' && args[0]?.t === 'lit' && typeof args[0].v === 'string') lits.regexes.add(args[0].v)
          e = { t: 'mcall', obj: e, name, args }
        } else e = { t: 'member', obj: e, name }
      } else if (isOp('[')) { p++; const i = expr(); eat(']'); e = { t: 'index', obj: e, i } }
      else if ((isOp('++') || isOp('--')) && e.t === 'var') { const d = peek().v === '++' ? 1 : -1; p++; e = { t: 'inc', name: e.name, d, pre: false } }
      else return e
    }
  }
  function argList() { eat('('); const a = []; if (!isOp(')')) { a.push(expr()); while (isOp(',')) { p++; a.push(expr()) } } eat(')'); return a }
  function primary() {
    const x = peek()
    if (!x) throw new Unsupported('unexpected end of formula')
    if (x.k === 'num') { p++; lits.numbers.add(x.v); return { t: 'lit', v: x.v } }
    if (x.k === 'str') { p++; lits.strings.add(x.v); return { t: 'lit', v: x.v } }
    if (x.k === 'chr') { p++; lits.strings.add(x.v); return { t: 'lit', v: new Char(x.v) } }
    if (x.k === 'id') {
      if (KW_STOP.has(x.v)) throw new Unsupported(`"${x.v}"`)
      p++
      if (x.v === 'true') return { t: 'lit', v: true }
      if (x.v === 'false') return { t: 'lit', v: false }
      if (x.v === 'null') return { t: 'lit', v: null }
      if (isOp('(')) { const args = argList(); calls.add(x.v); return { t: 'call', name: x.v, args } }
      return { t: 'var', name: x.v }
    }
    if (isOp('(')) { p++; const e = expr(); eat(')'); return e }
    throw new Unsupported(`token "${x.v}"`)
  }

  const body = []
  while (p < tok.length) {
    const d = tryDeclaration()
    if (d) decls.push(d)
    else body.push(statement())
  }
  return { body, decls, calls: [...calls], lits }
}

const code = (v) => (v instanceof Char ? v.valueOf() : v)
const num = (v) => { const x = code(v); return typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' && !Number.isNaN(Number(x)) ? Number(x) : NaN }
const truthy = (v) => v === true || (v !== false && v !== null && v !== undefined && v !== '' && v !== 0)
const same = (a, b) => {
  if (a instanceof Char || b instanceof Char) {
    const x = a instanceof Char ? a.c : a, y = b instanceof Char ? b.c : b
    if (typeof x === 'string' && typeof y === 'string') return x === y
    return num(a) === num(b)
  }
  return a === b || (a == null && b == null)
}
const tick = (env) => { if (++env.steps.n > STEP_LIMIT) throw new Unsupported('too many steps (possible endless loop)') }

// statement result: { r: true, value } for return, { b: true } for break, { c: true } for continue
const NEXT = {}
function run(stmt, env, last) {
  tick(env)
  switch (stmt.t) {
    case 'block': for (const s of stmt.body) { const r = run(s, env, last); if (r !== NEXT) return r } return NEXT
    case 'if': return truthy(ev(stmt.cond, env)) ? run(stmt.then, env, last) : stmt.otherwise ? run(stmt.otherwise, env, last) : NEXT
    case 'while': {
      while (truthy(ev(stmt.cond, env))) { tick(env); const r = run(stmt.body, env, last); if (r.b) break; if (r.r) return r }
      return NEXT
    }
    case 'for': {
      if (stmt.init) run(stmt.init, env, last)
      while (stmt.cond ? truthy(ev(stmt.cond, env)) : true) {
        tick(env)
        const r = run(stmt.body, env, last)
        if (r.b) break
        if (r.r) return r
        if (stmt.upd) ev(stmt.upd, env)
      }
      return NEXT
    }
    case 'break': return { b: true }
    case 'continue': return { c: true }
    case 'return': return { r: true, value: stmt.e ? ev(stmt.e, env) : undefined }
    case 'let': env.vars[stmt.name] = ev(stmt.e, env); return NEXT
    case 'expr': last.value = ev(stmt.e, env); return NEXT
    default: throw new Unsupported(`statement ${stmt.t}`)
  }
}

function callUser(u, args, env) {
  if (env.depth > 40) throw new Unsupported('recursion too deep')
  const vars = {}
  u.params.forEach((p, i) => { vars[p] = args[i] })
  const inner = { ...env, vars, depth: env.depth + 1 }
  const last = { value: undefined }
  for (const s of u.body) { const r = run(s, inner, last); if (r.r) return r.value }
  return last.value
}

function ev(n, env) {
  tick(env)
  switch (n.t) {
    case 'lit': return n.v
    case 'var':
      if (n.name in env.vars) return env.vars[n.name]
      throw new Unsupported(`variable ${n.name}`)
    case 'member': { const o = ev(n.obj, env); return o === null || o === undefined ? undefined : o[n.name] }
    case 'index': { const o = ev(n.obj, env); return o === null || o === undefined ? undefined : o[num(ev(n.i, env))] }
    case 'assign': {
      const v = ev(n.r, env)
      const cur = env.vars[n.name]
      env.vars[n.name] = n.o === '=' ? v : n.o === '+=' ? (typeof cur === 'string' || typeof v === 'string' ? `${cur ?? 'null'}${v ?? 'null'}` : num(cur) + num(v)) : n.o === '-=' ? num(cur) - num(v) : n.o === '*=' ? num(cur) * num(v) : num(cur) / num(v)
      return env.vars[n.name]
    }
    case 'inc': {
      if (!(n.name in env.vars)) throw new Unsupported(`variable ${n.name}`)
      const old = num(env.vars[n.name]); env.vars[n.name] = old + n.d
      return n.pre ? old + n.d : old
    }
    case 'call': {
      const args = n.args.map((a) => ev(a, env))
      if (env.user[n.name]) return callUser(env.user[n.name], args, env)
      const f = env.fns[n.name]
      if (!f) throw new Unsupported(`function ${n.name}`)
      return f(...args)
    }
    case 'mcall': {
      if (n.obj.t === 'var' && STATICS[n.obj.name] && !(n.obj.name in env.vars)) {
        const f = STATICS[n.obj.name][n.name]
        if (!f) throw new Unsupported(`${n.obj.name}.${n.name}()`)
        return f(...n.args.map((a) => ev(a, env)))
      }
      const o = ev(n.obj, env)
      const self = o instanceof Char ? o.c : o
      if (typeof self !== 'string' || !STRING_METHODS[n.name]) throw new Unsupported(`method .${n.name}()`)
      return STRING_METHODS[n.name](self, ...n.args.map((a) => ev(a, env)))
    }
    case 'un': { const v = ev(n.e, env); return n.o === '!' ? !truthy(v) : -num(v) }
    case 'cond': return truthy(ev(n.c, env)) ? ev(n.a, env) : ev(n.b, env)
    case 'bin': {
      if (n.o === '&&') return truthy(ev(n.l, env)) && truthy(ev(n.r, env))
      if (n.o === '||') return truthy(ev(n.l, env)) || truthy(ev(n.r, env))
      const a = ev(n.l, env), b = ev(n.r, env)
      switch (n.o) {
        case '==': return same(a, b)
        case '!=': return !same(a, b)
        case '+': return typeof a === 'string' || typeof b === 'string' ? `${a ?? 'null'}${b ?? 'null'}` : num(a) + num(b)
        case '-': return num(a) - num(b)
        case '*': return num(a) * num(b)
        case '/': return num(a) / num(b)
        case '%': return num(a) % num(b)
        case '<': return num(a) < num(b)
        case '>': return num(a) > num(b)
        case '<=': return num(a) <= num(b)
        case '>=': return num(a) >= num(b)
      }
    }
  }
  throw new Unsupported(`expression ${n.t}`)
}

// ---- functions defined in the VMF ----
// defs: [{ name, params: string[], source }]  (source = a whole declaration "boolean f(String v) { ... }" or just the body)
// -> { table: { name: { params, body: [stmts], calls, lits } }, notes: string[] }
export function compileFunctionDefs(defs) {
  const table = {}, notes = []
  const add = (name, params, body, p) => { table[name] = { name, params, body: Array.isArray(body) ? body : [body], calls: p.calls, lits: p.lits } }
  for (const d of defs) {
    try {
      const p = parse(d.source)
      if (p.decls.length) {
        // a source with whole declarations: every function in it is registered (the one named like the definition included)
        for (const f of p.decls) add(f.name, f.params, f.body, f)
        if (d.name && !table[d.name] && p.decls.length === 1) add(d.name, p.decls[0].params, p.decls[0].body, p.decls[0])
      } else if (d.name) add(d.name, d.params || [], p.body, p)
    } catch (e) { notes.push(`${d.name || '(unnamed)'}: ${e instanceof Unsupported ? 'unsupported code: ' + e.message : e.message}`) }
  }
  // a VMF definition that depends on something we cannot run falls back to the built-in function of that name, if any
  const unresolved = (fn, seen = new Set()) => {
    if (seen.has(fn.name)) return []
    seen.add(fn.name)
    return fn.calls.filter((c) => !c.startsWith('.')).flatMap((c) => (table[c] ? unresolved(table[c], seen) : FUNCTIONS[c] ? [] : [c]))
  }
  for (const name of Object.keys(table)) {
    const bad = unresolved(table[name])
    if (bad.length && FUNCTIONS[name]) { notes.push(`${name}: the VMF definition calls ${[...new Set(bad)].join(', ')} which is unknown here; the built-in ${name} is used instead`); delete table[name] }
  }
  return { table, notes }
}

// compileFormula(src, user?) -> { calls, unknown, lits(), evaluate(value) -> boolean }
export function compileFormula(src, user = {}) {
  const text = String(src || '').trim()
  if (!text) throw new Unsupported('empty formula')
  const prog = parse(text)
  const table = { ...user }
  for (const d of prog.decls) table[d.name] = { name: d.name, params: d.params, body: [d.body], calls: d.calls, lits: d.lits }
  const seen = new Set()
  const unknown = new Set(), strings = new Set(prog.lits.strings), regexes = new Set(prog.lits.regexes), numbers = new Set(prog.lits.numbers)
  const visit = (calls) => {
    for (const c of calls) {
      if (c.startsWith('.')) continue
      const u = table[c]
      if (u) {
        if (seen.has(c)) continue
        seen.add(c)
        u.lits.strings.forEach((x) => strings.add(x)); u.lits.regexes.forEach((x) => regexes.add(x)); u.lits.numbers.forEach((x) => numbers.add(x))
        visit(u.calls)
      } else if (!FUNCTIONS[c]) unknown.add(c)
    }
  }
  visit(prog.calls)
  return {
    calls: prog.calls,
    unknown: [...unknown],
    usedUser: [...seen],
    lits: { strings: [...strings], regexes: [...regexes], numbers: [...numbers] },
    evaluate(value) {
      const env = { vars: { $value: value }, fns: FUNCTIONS, user: table, steps: { n: 0 }, depth: 0 }
      const last = { value: undefined }
      for (const s of prog.body) { const r = run(s, env, last); if (r.r) return truthy(r.value) }
      if (last.value === undefined) throw new Unsupported('formula returns no value')
      return truthy(last.value)
    },
  }
}
