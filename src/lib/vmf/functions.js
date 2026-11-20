// Built-in validation functions (the ones seen in the VMF) plus Java-like helpers for string handling.
// A function DEFINED in the VMF takes precedence over a built-in of the same name when it can be fully evaluated.
import { CURRENCIES, COUNTRIES } from './isoData.js'

export class Char { constructor(c) { this.c = c } toString() { return this.c } valueOf() { return this.c.codePointAt(0) } }
const str = (v) => (v === null || v === undefined ? '' : String(v))
const s = (v) => (v instanceof Char ? v.c : v)

export const FUNCTIONS = {
  IsISOCurrencyCode: (v) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(CURRENCIES, v),
  IsISOCountryCode: (v) => typeof v === 'string' && COUNTRIES.has(v),
  // structure of ISO 9362: 4 letters + country + 2 location chars + optional 3 branch chars. A BIC directory is not consulted.
  IsValidBIC: (v) => typeof v === 'string' && /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v) && COUNTRIES.has(v.slice(4, 6)),
  // number of fraction digits must not exceed the currency's minor units
  IsValidDecimals: (ccy, text) => {
    if (typeof ccy !== 'string' || !Object.prototype.hasOwnProperty.call(CURRENCIES, ccy)) return false
    const t = str(text)
    if (!/^-?\d+(\.\d+)?$/.test(t)) return false
    return (t.split('.')[1] || '').length <= CURRENCIES[ccy]
  },
  // second argument = use digit grouping (false in the VMF)
  toText: (v) => str(v),
}

// Java-style methods on strings, e.g. $value.length(), $value.startsWith("A")
export const STRING_METHODS = {
  length: (x) => x.length,
  isEmpty: (x) => x.length === 0,
  trim: (x) => x.trim(),
  toUpperCase: (x) => x.toUpperCase(),
  toLowerCase: (x) => x.toLowerCase(),
  equals: (x, o) => x === s(o),
  equalsIgnoreCase: (x, o) => x.toLowerCase() === str(s(o)).toLowerCase(),
  startsWith: (x, o) => x.startsWith(s(o)),
  endsWith: (x, o) => x.endsWith(s(o)),
  contains: (x, o) => x.includes(s(o)),
  substring: (x, a, b) => x.substring(a, b),
  matches: (x, re) => new RegExp(`^(?:${re})$`).test(x),
  charAt: (x, i) => { if (i < 0 || i >= x.length) throw new RangeError('index out of range'); return new Char(x[i]) },
  indexOf: (x, o) => x.indexOf(s(o)),
  lastIndexOf: (x, o) => x.lastIndexOf(s(o)),
  replace: (x, a, b) => x.split(s(a)).join(s(b)),
  replaceAll: (x, re, b) => x.replace(new RegExp(re, 'g'), s(b)),
  concat: (x, o) => x + s(o),
  split: (x, re) => x.split(new RegExp(re)),
  toCharArray: (x) => [...x].map((c) => new Char(c)),
}

// static helpers: Math.abs(...), Integer.parseInt(...), Character.isDigit(...), String.valueOf(...)
const n = (v) => (v instanceof Char ? v.valueOf() : Number(v))
export const STATICS = {
  Math: { abs: (a) => Math.abs(n(a)), floor: (a) => Math.floor(n(a)), ceil: (a) => Math.ceil(n(a)), round: (a) => Math.round(n(a)), max: (a, b) => Math.max(n(a), n(b)), min: (a, b) => Math.min(n(a), n(b)), pow: (a, b) => n(a) ** n(b) },
  Integer: { parseInt: (a) => { if (!/^[+-]?\d+$/.test(str(s(a)))) throw new RangeError('NumberFormatException'); return parseInt(s(a), 10) }, valueOf: (a) => parseInt(s(a), 10) },
  Long: { parseLong: (a) => { if (!/^[+-]?\d+$/.test(str(s(a)))) throw new RangeError('NumberFormatException'); return parseInt(s(a), 10) } },
  Double: { parseDouble: (a) => { const v = Number(s(a)); if (Number.isNaN(v)) throw new RangeError('NumberFormatException'); return v } },
  String: { valueOf: (a) => str(s(a)) },
  Character: {
    isDigit: (c) => /^\d$/.test(str(s(c))), isLetter: (c) => /^[A-Za-z]$/.test(str(s(c))), isLetterOrDigit: (c) => /^[A-Za-z0-9]$/.test(str(s(c))),
    isUpperCase: (c) => /^[A-Z]$/.test(str(s(c))), isLowerCase: (c) => /^[a-z]$/.test(str(s(c))),
    getNumericValue: (c) => { const x = str(s(c)); return /^\d$/.test(x) ? Number(x) : /^[A-Za-z]$/.test(x) ? x.toLowerCase().charCodeAt(0) - 87 : -1 },
    toUpperCase: (c) => (c instanceof Char ? new Char(c.c.toUpperCase()) : c),
  },
}
