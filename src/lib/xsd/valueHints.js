// Realistic sample values keyed by element / attribute local name.
// A hint is only used when it satisfies the XSD facets (pattern, length, enumeration).
const HINTS = {
  BICFI: 'DEUTDEFFXXX', BIC: 'DEUTDEFFXXX', AnyBIC: 'DEUTDEFFXXX', BICOrBEI: 'DEUTDEFFXXX',
  IBAN: 'DE89370400440532013000',
  UETR: '97ed4827-7b6f-4491-a06f-b548d5a7512d', OrgnlUETR: '97ed4827-7b6f-4491-a06f-b548d5a7512d',
  LEI: '5493001KJTIIGC8Y1R12',
  MsgId: 'MSG-20261114-0001', InstrId: 'INSTR-0001', EndToEndId: 'E2E-0001', TxId: 'TX-0001',
  PmtInfId: 'PMT-0001', OrgnlMsgId: 'MSG-20261114-0001', OrgnlInstrId: 'INSTR-0001',
  OrgnlEndToEndId: 'E2E-0001', OrgnlTxId: 'TX-0001', Id: 'ID-0001', Ref: 'REF-0001',
  CreDtTm: '2026-11-14T10:00:00Z', CreDt: '2026-11-14T10:00:00Z',
  IntrBkSttlmDt: '2026-11-14', ReqdExctnDt: '2026-11-14', ReqdColltnDt: '2026-11-14',
  Dt: '2026-11-14', DtTm: '2026-11-14T10:00:00Z',
  NbOfTxs: '1', CtrlSum: '15250.00',
  Ccy: 'EUR', Amt: '15250.00', IntrBkSttlmAmt: '15250.00', InstdAmt: '15250.00', TtlIntrBkSttlmAmt: '15250.00',
  Nm: 'Sharma Textiles Pvt Ltd', StrtNm: 'Main Street', BldgNb: '10', PstCd: '60311', TwnNm: 'Frankfurt', Ctry: 'DE', CtryOfRes: 'DE',
  ChrgBr: 'SHAR', SttlmMtd: 'INDA', TxSts: 'ACSC', Cd: 'SALA', Ustrd: 'Invoice 2026-0042',
  PmtMtd: 'TRF', Prtry: 'PROPRIETARY', Purp: 'SUPP', MmbId: '12345', ClrSysMmbId: '12345', Authstn: 'AUTH',
}

export function hintFor(name) {
  return HINTS[name]
}
