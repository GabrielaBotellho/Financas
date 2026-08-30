// lib/categorize.js
// Mapeia uma transação vinda da Pluggy para uma sugestão de categoria
// do app (as mesmas usadas no financas.jsx). Isso é só um PONTO DE PARTIDA:
// a Pluggy não sabe distinguir "dia a dia" de "lazer" — isso é uma escolha
// pessoal sua, então a sugestão fica marcada como `confidence: "baixa"`
// sempre que depender dessa distinção, para você confirmar no app antes
// de salvar.

const CATEGORY_LIST = [
  "Assinaturas",
  "Transporte - Carona",
  "Transporte - Ônibus",
  "Academia",
  "Roupa",
  "Comida Dia a Dia",
  "Comida Lazer",
  "Ifood - Dia a Dia",
  "Ifood - Lazer",
  "Compras",
  "Uber - Dia a Dia",
  "Uber - Lazer",
  "Cartão de Crédito Nubank",
  "Investimentos",
  "Farmácia",
  "Médico",
];

// Regras ensinadas por você a partir de lançamentos reais. Regras mais
// específicas (nomes de estabelecimento, etc.) ficam antes das genéricas,
// já que a primeira regra que bater "ganha".
//
// `test`: regex aplicada à descrição/estabelecimento do lançamento.
// `amountEquals`: opcional — valor exato em reais (com tolerância de 1 centavo).
// `amountBetween`: opcional — [min, max] em reais, pra regras por faixa de valor.
const RULES = [
  // --- regras ensinadas por você ---
  { test: /marcelly brisk santos/i, category: "Assinaturas", confidence: "alta" },
  { test: /pix/i, amountEquals: 7, category: "Transporte - Carona", confidence: "alta" },
  { test: /bilhete digital/i, category: "Transporte - Ônibus", confidence: "alta" },
  { test: /nu\s*pagamentos.*cart[aã]o de cr[ée]dito|cart[aã]o de cr[ée]dito nubank/i, category: "Cartão de Crédito Nubank", confidence: "alta" },
  { test: /dilcinha/i, category: "Comida Dia a Dia", confidence: "alta" },
  { test: /batista.?s?\s*lanches/i, category: "Comida Dia a Dia", confidence: "alta" },
  { test: /karigracas/i, category: "Comida Dia a Dia", confidence: "alta" },
  { test: /aplica[cç][aã]o/i, category: "Investimentos", confidence: "alta" },
  { test: /ifood/i, category: "Ifood - Lazer", confidence: "baixa" },

  // --- regras genéricas de partida ---
  { test: /spotify/i, category: "Assinaturas", confidence: "alta" },
  { test: /apple\.com|itunes/i, category: "Assinaturas", confidence: "alta" },
  { test: /uber\s*\*?trip|uber\s*br/i, category: "Uber - Dia a Dia", confidence: "baixa" },
  { test: /99app|99 app|99pop/i, category: "Uber - Dia a Dia", confidence: "baixa" },
  { test: /academia|smartfit|smart fit/i, category: "Academia", confidence: "alta" },
  { test: /rappi/i, category: "Comida Lazer", confidence: "baixa" },
  { test: /supermercado|mercado|hortifruti|pao de acucar|carrefour/i, category: "Comida Dia a Dia", confidence: "media" },
  { test: /zara|renner|riachuelo|c&a|shein/i, category: "Roupa", confidence: "media" },
  { test: /farmacia|drogaria|drogasil|droga\s*raia|pacheco|pague\s*menos/i, category: "Farmácia", confidence: "media" },
];

/**
 * @param {object} tx - transação no formato retornado pela Pluggy
 * @returns {{ suggestedCategory: string|null, confidence: "alta"|"media"|"baixa"|"nenhuma" }}
 */
function suggestCategory(tx) {
  const haystack = `${tx.description || ""} ${tx.merchant?.name || ""}`.trim();
  const amount = Math.abs(tx.amount || 0);

  for (const rule of RULES) {
    if (!rule.test.test(haystack)) continue;
    if (rule.amountEquals !== undefined && Math.abs(amount - rule.amountEquals) > 0.01) continue;
    if (rule.amountBetween) {
      const [min, max] = rule.amountBetween;
      if (amount < min || amount > max) continue;
    }
    return { suggestedCategory: rule.category, confidence: rule.confidence };
  }

  return { suggestedCategory: null, confidence: "nenhuma" };
}

module.exports = { CATEGORY_LIST, suggestCategory };
