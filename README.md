# Payments Tools

Developer utilities for ISO 20022 message work, split out of the Payments Academy app.

| Tool | Route | What it does |
|---|---|---|
| **Schema to Sample** | `/schema` | Load an XSD, see every element as mandatory / optional with its type and limits, and generate a sample XML (mandatory only or everything, repeat counts, choices, custom values). |
| **Rules & Scenarios** | `/rules` | Load an XSD and the MDR Part 2 PDF: see which business rules are covered by automation, get valid / invalid / not-applicable scenarios with sample XML, and download CSVs. |
| **Scenario Pack** | `/pack` | XSD + MDR PDF (+ optional client base sample): one Excel with every rule scenario, a pairwise set of structural combinations, rule coverage and base-sample usage, plus a ZIP with a complete XML per row and `ALL_Fields_sample.xml`. Every sample is re-checked with the rule engine. |
| **Sample Analytics** | `/analytics` | Load many client samples (any messages): field usage, value shapes, lengths vs XSD max, repeats, choice branches. Descriptive only, no recommendations. |

Scenario samples contain all fields and sections (rule values applied on top, collateral rule violations repaired); choose "mandatory only" on the page if preferred. `ALL_Fields_sample.xml` only satisfies the XSD, rules are not applied. An XSD choice allows one branch, so it uses the first (or the client's) branch.

Everything runs in the browser; the files you load are not uploaded. Plain JavaScript, React, Vite and Tailwind. No backend.

## Setup
```bash
npm install or npm install --registry https://registry.npmjs.org       # once
npm run dev        # http://localhost:5174
npm run build
```
Node 20 or newer (`.nvmrc`).

## Command line (no install needed, plain Node)
```bash
node docs/fixtures/run-test.mjs                                   # XSD generator + base-sample self-test
node docs/fixtures/run-pack-test.mjs                              # Scenario Pack self-test (npm run test:pack)
node tools/mdr-rules/coverage_report.mjs <xsd-or-folder>          # coverage + scenarios CSV into docs/rule-coverage
node tools/mdr-rules/verify_all.mjs <MDR-Part2.pdf> <xsd-folder>  # re-checks every generated scenario
```

## Layout
```
src/
  pages/            SchemaSamplePage, RulesScenariosPage
  lib/xsd/          XSD parser, pattern generator, sample generator, value hints
  lib/scenarioPack/ pack builder, pairwise, xlsx/zip export, input loader
  lib/xsd/baseProfile.js, profileStats.js   client-sample learning and analytics
  lib/mdrRules/     PDF text, rule extraction, rule engine, coverage, scenarios, CSV
  lib/xmlParser.js  XML to annotated tree (used to check generated samples)
  content/          fieldDictionary.js, schemas/rules/ (local rule JSON, gitignored)
tools/mdr-rules/    command-line scripts and the legacy Python extractor
docs/               schema-sample-generator.md, scenarios/, rule-coverage/, fixtures/
```

## Notes
- `src/content/schemas/rules/*.json` is derived from the MDR PDF and is gitignored. Create it from the Rules & Scenarios page ("Rules JSON") or `python3 tools/mdr-rules/extract_rules.py <pdf>`.
- Docs: `docs/schema-sample-generator.md`, `tools/mdr-rules/README.md`.
- Origin: copied from `payments-academy/v2` (the academy app still has its own copies until you ask to remove them).
