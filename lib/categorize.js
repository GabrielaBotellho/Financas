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
  "Compras",
  "Uber - Dia a Dia",
  "Uber - Lazer",
];

// Regras simples por palavra-chave no nome do estabelecimento (merchant)
// ou na descrição bruta da transação. Ajustaremos isso junto com você
// conforme forem aparecendo lançamentos reais do Itaú/Nubank.
const RULES = [
  { test: /spotify/i, category: "Assinaturas", confidence: "alta" },
  { test: /apple\.com|itunes/i, category: "Assinaturas", confidence: "alta" },
  { test: /uber\s*\*?trip|uber\s*br/i, category: "Uber - Dia a Dia", confidence: "baixa" },
  { test: /99app|99 app|99pop/i, category: "Uber - Dia a Dia", confidence: "baixa" },
  { test: /academia|smartfit|smart fit/i, category: "Academia", confidence: "alta" },
  { test: /ifood|rappi/i, category: "Comida Lazer", confidence: "baixa" },
  { test: /supermercado|mercado|hortifruti|pao de acucar|carrefour/i, category: "Comida Dia a Dia", confidence: "media" },
  { test: /zara|renner|riachuelo|c&a|shein/i, category: "Roupa", confidence: "media" },
];

/**
 * @param {object} tx - transação no formato retornado pela Pluggy
 * @returns {{ suggestedCategory: string|null, confidence: "alta"|"media"|"baixa"|"nenhuma" }}
 */
function suggestCategory(tx) {
  const haystack = `${tx.description || ""} ${tx.merchant?.name || ""}`.trim();

  for (const rule of RULES) {
    if (rule.test.test(haystack)) {
      return { suggestedCategory: rule.category, confidence: rule.confidence };
    }
  }

  return { suggestedCategory: null, confidence: "nenhuma" };
}

module.exports = { CATEGORY_LIST, suggestCategory };
