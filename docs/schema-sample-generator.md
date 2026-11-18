# Schema → Sample generator

Route: `/schema` (page `src/pages/SchemaSamplePage.jsx`). Core code: `src/lib/xsd/`.

## What it does
1. **Load an XSD** (file or paste). Nothing is uploaded anywhere; parsing happens in the browser with `DOMParser`.
2. **Structure (M / O) tab:** every element with *Mandatory* / *Optional*, cardinality `[min..max]`, repeating flag, data type, enumerations, patterns, length limits, required attributes and the XSD documentation text.
3. **Generated sample tab:** produces XML in *mandatory only* or *everything* mode, with a repeat count for repeating elements, a selector for every `choice`, and optional `<!-- 1..1 -->` cardinality comments. It checks the result for well-formedness and offers Copy and Download (with an optional file name).

## Modules
| File | Role |
|---|---|
| `lib/xsd/xsdParser.js` | XSD → model (`sequence`/`choice`/`all`, `complexContent`/`simpleContent` extensions, attributes, simpleType facets, global element refs, recursion cap) |
| `lib/xsd/patternGen.js` | Builds a string matching an XSD `pattern` (classes, groups, alternation, quantifiers); returns null if unsupported |
| `lib/xsd/valueHints.js` | Realistic values by element name (BIC, IBAN, UETR, currency, dates…). Used only if they satisfy the XSD facets |
| `lib/xsd/sampleGenerator.js` | Model → XML. Value order: name hint → first enumeration → pattern generator → typed default |

## Getting XSDs
You supply them (e.g. from the ISO 20022 message catalogue or your scheme's MyStandards download). None are stored in this repo. Single-file XSDs work; XSDs that `import`/`include` other files are not resolved yet.

## Limits (be aware)
- A base ISO XSD has **ISO cardinality only**. Usage guidelines (CBPR+, HVPS+, SEPA) make additional fields mandatory; those rules are not in the XSD.
- Cross-field business rules (Schematron-style) are not enforced; samples are structurally valid, not business-meaningful.
- Patterns using `\p{…}`, `\i`, `\c` or class subtraction fall back to a placeholder and are listed as warnings.
- Recursive types are cut at one level and marked with a comment.

## Test
Without installing anything: `cd v2 && node docs/fixtures/run-test.mjs` runs the core against `docs/fixtures/mini-pacs.xsd`, a hand-written fixture (not an official schema). It uses a tiny XML reader instead of `DOMParser`, so the browser wrapper `parseXsdText` is checked only by `npm run build` plus a manual click-through.

## MDR rules (business constraints): Rules & Scenarios page
The XSD does not hold rules such as "If ChargesInformation is present, then InstructedAmount must be present". They are in the ISO 20022 MDR Part 2 PDF. **The generator does not apply them yet.** The separate **Rules & Scenarios** page (`/rules`) reads the XSD and the PDF, reports which rules are covered, and builds valid/invalid scenarios as CSV. See `tools/mdr-rules/README.md`. A rule-aware generator (applying the rules while generating) is a possible next step and is not built.
