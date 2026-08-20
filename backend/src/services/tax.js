/** Arrondi monétaire CAD (2 décimales). */
export function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * TPS / TVQ : chaque taxe est arrondie séparément avant d’être additionnée.
 * Évite l’écart d’un cent (ex. 2834,63 → 3259,11 et non 3259,12).
 */
export function calcDocTaxes(subtotal, rates = { gstRate: 0.05, qstRate: 0.09975 }) {
  const base = roundMoney(subtotal);
  const gst = roundMoney(base * (rates.gstRate ?? 0.05));
  const qst = roundMoney(base * (rates.qstRate ?? 0.09975));
  return {
    subtotal: base,
    gst,
    qst,
    total: roundMoney(base + gst + qst),
    tax_rate: 14.975,
  };
}

/**
 * Sous-total taxable : ignore les lignes marquées tax_exempt
 * (ex. montant déjà TTC refacturé tel quel — à éviter ; préférer le HT).
 */
export function taxableSubtotalFromLines(lines) {
  return (lines || []).reduce((s, l) => {
    if (l?.tax_exempt) return s;
    return s + (Number(l.qty) || 0) * (Number(l.price) || 0);
  }, 0);
}

export function lineAmount(line) {
  return roundMoney((Number(line?.qty) || 0) * (Number(line?.price) || 0));
}
