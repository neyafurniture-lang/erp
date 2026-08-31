/**
 * Retenues à la source Québec / Canada — taux 2025 (salarié).
 * Référence talon QuickBooks : 560 $ brut, 28 h × 20 $, période bihebdomadaire (26 paies/an).
 */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function round2(n) {
  return Math.round(num(n) * 100) / 100;
}

/** Taux et plafonds annuels par année fiscale. */
export const PAYROLL_RATES = {
  2025: {
    qppEmployeeRate: 0.064,
    qpp2EmployeeRate: 0,
    qpipEmployeeRate: 0.00494,
    eiEmployeeRate: 0.0164,
    eiEmployerRate: 0.02296, // 1.4 × 1.64 %
    eiMaxInsurable: 65700,
    qppMaxPensionable: 71300,
    qpipMaxInsurable: 91000,
    basicExemption: 3500,
  },
  2026: {
    qppEmployeeRate: 0.064,
    qpp2EmployeeRate: 0,
    qpipEmployeeRate: 0.00494,
    eiEmployeeRate: 0.0164,
    eiEmployerRate: 0.02296,
    eiMaxInsurable: 68900,
    qppMaxPensionable: 74600,
    qpipMaxInsurable: 94000,
    basicExemption: 3500,
  },
};

export function ratesForYear(year) {
  return PAYROLL_RATES[year] || PAYROLL_RATES[2026];
}

/** 26 = bihebdomadaire, 24 = bimensuel NEYA (1–15 / 16–fin). */
export function periodsPerYearFromDates(startDate, endDate) {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  const startDay = start.getDate();
  const endDay = end.getDate();
  const days = Math.round((end - start) / 86400000) + 1;
  if ((startDay === 1 && endDay === 15) || startDay === 16) return 24;
  if (days >= 12 && days <= 16) return 26;
  return 24;
}

function periodExemption(year, periodsPerYear) {
  const { basicExemption } = ratesForYear(year);
  return basicExemption / periodsPerYear;
}

/**
 * RRQ salarié — exemption de base répartie par période de paie.
 */
export function calcQppEmployee(gross, { year, periodsPerYear, ytdGross = 0, ytdQpp = 0 }) {
  const r = ratesForYear(year);
  const exempt = periodExemption(year, periodsPerYear);
  const pensionable = Math.max(0, gross - exempt);
  const maxRemaining = Math.max(0, r.qppMaxPensionable - ytdGross);
  const base = Math.min(pensionable, maxRemaining);
  return round2(base * r.qppEmployeeRate);
}

export function calcQpipEmployee(gross, { year, ytdGross = 0, ytdQpip = 0 }) {
  const r = ratesForYear(year);
  const maxRemaining = Math.max(0, r.qpipMaxInsurable - ytdGross);
  const base = Math.min(gross, maxRemaining);
  return round2(base * r.qpipEmployeeRate);
}

export function calcEiEmployee(gross, { year, ytdGross = 0, ytdEi = 0 }) {
  const r = ratesForYear(year);
  const maxRemaining = Math.max(0, r.eiMaxInsurable - ytdGross);
  const base = Math.min(gross, maxRemaining);
  const premium = round2(base * r.eiEmployeeRate);
  const maxPremium = round2(r.eiMaxInsurable * r.eiEmployeeRate);
  return round2(Math.min(premium, Math.max(0, maxPremium - ytdEi)));
}

export function calcEiEmployer(gross, { year, ytdGross = 0, ytdEiEmployer = 0 }) {
  const r = ratesForYear(year);
  const maxRemaining = Math.max(0, r.eiMaxInsurable - ytdGross);
  const base = Math.min(gross, maxRemaining);
  const premium = round2(base * r.eiEmployerRate);
  const maxPremium = round2(r.eiMaxInsurable * r.eiEmployerRate);
  return round2(Math.min(premium, Math.max(0, maxPremium - ytdEiEmployer)));
}

export function calcQppEmployer(employeeQpp) {
  return round2(employeeQpp);
}

/**
 * Impôt sur le revenu — retenue simplifiée (0 si revenu annuel projeté sous le seuil).
 * Pour une retenue exacte Revenu Canada / Québec, saisir manuellement dans le breakdown.
 */
export function calcIncomeTaxPlaceholder(gross, periodsPerYear) {
  const annualized = gross * periodsPerYear;
  if (annualized < 15000) return 0;
  return 0;
}

export const DEDUCTION_CODES = {
  FED_TAX: 'fed_tax',
  QC_TAX: 'qc_tax',
  EI: 'ei',
  QPP: 'qpp',
  QPP2: 'qpp2',
  QPIP: 'qpip',
  OTHER: 'other',
};

export const DEDUCTION_LABELS = {
  [DEDUCTION_CODES.FED_TAX]: 'Impôt sur le revenu',
  [DEDUCTION_CODES.QC_TAX]: 'Impôt sur le revenu du Québec',
  [DEDUCTION_CODES.EI]: 'Assurance-emploi',
  [DEDUCTION_CODES.QPP]: 'Régime de rentes du Québec',
  [DEDUCTION_CODES.QPP2]: '2e Régime de rentes du Québec',
  [DEDUCTION_CODES.QPIP]: 'Régime québécois d\'assurance parentale',
  [DEDUCTION_CODES.OTHER]: 'Autre retenue',
};

/**
 * Calcule le breakdown complet pour une période.
 * @param {object} opts
 * @param {number} opts.gross
 * @param {number} opts.hours
 * @param {number} opts.rate
 * @param {number} opts.year
 * @param {number} opts.periodsPerYear
 * @param {object} opts.ytd - cumuls avant cette période (même année)
 * @param {object} [opts.overrides] - montants manuels par code
 */
export function computePayrollDeductions({
  gross,
  hours,
  rate,
  year,
  periodsPerYear,
  ytd = {},
  overrides = {},
}) {
  const g = round2(gross);
  const ytdGross = num(ytd.gross);
  const ytdMap = ytd.deductions || {};

  const qpp = overrides.qpp ?? calcQppEmployee(g, {
    year, periodsPerYear, ytdGross, ytdQpp: num(ytdMap.qpp),
  });
  const qpip = overrides.qpip ?? calcQpipEmployee(g, {
    year, ytdGross, ytdQpip: num(ytdMap.qpip),
  });
  const ei = overrides.ei ?? calcEiEmployee(g, {
    year, ytdGross, ytdEi: num(ytdMap.ei),
  });
  const fedTax = overrides.fed_tax ?? calcIncomeTaxPlaceholder(g, periodsPerYear);
  const qcTax = overrides.qc_tax ?? 0;
  const qpp2 = overrides.qpp2 ?? 0;

  const earnings = [{
    code: 'regular',
    label: 'Paie normale',
    hours: round2(hours),
    rate: round2(rate),
    amount: g,
  }];

  const deductions = [
    { code: DEDUCTION_CODES.FED_TAX, label: DEDUCTION_LABELS[DEDUCTION_CODES.FED_TAX], employee: round2(fedTax) },
    { code: DEDUCTION_CODES.EI, label: DEDUCTION_LABELS[DEDUCTION_CODES.EI], employee: round2(ei) },
    { code: DEDUCTION_CODES.QC_TAX, label: DEDUCTION_LABELS[DEDUCTION_CODES.QC_TAX], employee: round2(qcTax) },
    { code: DEDUCTION_CODES.QPP, label: DEDUCTION_LABELS[DEDUCTION_CODES.QPP], employee: round2(qpp) },
    { code: DEDUCTION_CODES.QPIP, label: DEDUCTION_LABELS[DEDUCTION_CODES.QPIP], employee: round2(qpip) },
    { code: DEDUCTION_CODES.QPP2, label: DEDUCTION_LABELS[DEDUCTION_CODES.QPP2], employee: round2(qpp2) },
  ];

  const employer = [
    { code: 'ei_er', label: 'Assurance-emploi (employeur)', amount: calcEiEmployer(g, { year, ytdGross, ytdEiEmployer: num(ytd.employer?.ei) }) },
    { code: 'qpp_er', label: 'RRQ (employeur)', amount: calcQppEmployer(qpp) },
  ];

  const totalDeductions = round2(deductions.reduce((s, d) => s + num(d.employee), 0));
  const net = round2(Math.max(0, g - totalDeductions));

  return {
    earnings,
    deductions,
    employer,
    gross: g,
    totalDeductions,
    net,
    periodsPerYear,
    year,
  };
}

/** Fusionne les cumuls YTD avec la période courante. */
export function mergeYtd(ytdBefore, currentBreakdown) {
  const out = {
    gross: round2(num(ytdBefore.gross) + num(currentBreakdown.gross)),
    deductions: {},
    net: round2(num(ytdBefore.net) + num(currentBreakdown.net)),
    hours: round2(num(ytdBefore.hours) + num(currentBreakdown.earnings?.[0]?.hours)),
  };
  for (const d of currentBreakdown.deductions || []) {
    out.deductions[d.code] = round2(num(ytdBefore.deductions?.[d.code]) + num(d.employee));
  }
  for (const e of currentBreakdown.earnings || []) {
    out.earnings = round2(num(ytdBefore.earnings) + num(e.amount));
  }
  if (!out.earnings) out.earnings = out.gross;
  return out;
}

/** Extrait les cumuls depuis une liste de breakdowns passés. */
export function sumYtdFromBreakdowns(breakdowns) {
  const out = { gross: 0, net: 0, hours: 0, deductions: {}, earnings: 0 };
  for (const b of breakdowns) {
    if (!b) continue;
    out.gross = round2(out.gross + num(b.gross));
    out.net = round2(out.net + num(b.net));
    out.hours = round2(out.hours + num(b.earnings?.[0]?.hours));
    out.earnings = out.gross;
    for (const d of b.deductions || []) {
      out.deductions[d.code] = round2(num(out.deductions[d.code]) + num(d.employee));
    }
  }
  return out;
}
