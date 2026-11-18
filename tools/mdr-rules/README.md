# MDR rules module (Rules & Scenarios)

Answers two questions for an ISO 20022 message: **which MDR constraints can the project check and fix automatically**, and **what valid / invalid scenarios does each rule need**.

## In the app: `/rules` ("Rules & Scenarios")
1. Choose the message **XSD** and the **MDR Part 2 PDF** (or a rules JSON downloaded earlier) and press **Analyse**.
2. The page reads that message's constraints from the PDF (in your browser, nothing is uploaded), checks each rule against the XSD, and builds scenarios.
3. Tabs: **Coverage** (Covered / Partially covered / Not covered, reason, manual action), **Scenarios** (fields, sample XML, rule text, expected result and why), **Value constraints**.
4. Download: coverage CSV, scenarios CSV, value-constraints CSV and the rules JSON (re-use it later instead of the PDF).

## Command line (same code, writes files to `docs/rule-coverage/`)
- `node tools/mdr-rules/coverage_report.mjs <xsd-or-folder>`: needs rules JSON in `src/content/schemas/rules/` (gitignored). Create it with the page ("Rules JSON") or `python3 tools/mdr-rules/extract_rules.py <pdf>` (legacy; produces identical JSON).
- `node tools/mdr-rules/verify_all.mjs <pdf> <xsd-folder>`: self-check. Extracts rules through the browser code path, generates scenarios, and re-checks every scenario with the rule engine.

## How scenarios are made
For each rule with a machine-readable condition (formal block in the PDF, or a simple sentence): a valid case, an invalid case per requirement, a not-applicable case, either-or variants, one case per value of an OR condition (for example INDA and INGA), and repeat variants (3 occurrences) when an element repeats. Fragments use real values from the XSD. Guidelines and free-text rules get a **Manual needed** row so nothing is dropped.

## Meaning of Coverage
- **Covered**: formal condition read, bound to elements in the XSD, self-test passes and an automatic fix exists.
- **Partially covered**: detected, but not fully fixable or the rule text describes cases that are not enforced.
- **Not covered**: guideline (advisory), free-text rule, unsupported operator, or elements not found in the XSD.

## Limits
Rule text comes from the PDF edition you supply; version mismatches show as "elements not found". Sums, currency lists (ISO 4217/3166), IBAN check digits and CBPR+/HVPS+ guidelines are not covered. pain/camt need their own MDR PDFs.

## Files
- `src/lib/mdrRules/`: `pdfText.js` (PDF to text), `extractRules.js` (text to rules), `ruleEngine.js` (bind/evaluate/fix), `coverage.js`, `scenarios.js`, `csv.js`, `domXml.js`.
- `src/pages/RulesScenariosPage.jsx`: the page.
- `coverage_report.mjs`, `verify_all.mjs`, `extract_rules.py` (legacy), `engine/nodeXml.js` (Node-only XML reader).
