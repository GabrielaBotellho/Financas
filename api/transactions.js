// api/transactions.js
// GET /api/transactions?itemId=xxxx&from=2026-08-01&to=2026-08-31
//
// Busca todas as contas do item conectado, puxa as transações de cada
// uma no período pedido, e devolve já com uma sugestão de categoria
// (você confirma/ajusta no app antes de salvar).

const { fetchAccounts, fetchTransactions } = require("../lib/pluggy");
const { suggestCategory } = require("../lib/categorize");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Método não permitido" });
    return;
  }

  const { itemId, from, to } = req.query || {};
  if (!itemId) {
    res.status(400).json({ error: "Parâmetro itemId é obrigatório" });
    return;
  }

  try {
    const accounts = await fetchAccounts(itemId);

    const all = [];
    for (const account of accounts) {
      const txs = await fetchTransactions(account.id, { from, to });
      for (const tx of txs) {
        const { suggestedCategory, confidence } = suggestCategory(tx);
        all.push({
          id: tx.id,
          date: tx.date,
          description: tx.description,
          amount: Math.abs(tx.amount),
          // despesa = valor negativo na Pluggy (saída de conta);
          // ignoramos créditos/entradas por enquanto
          isExpense: tx.amount < 0,
          accountName: account.name,
          suggestedCategory,
          confidence,
        });
      }
    }

    // só devolve despesas — entradas (salário, PIX recebido, etc.) ficam de fora por ora
    const expenses = all.filter((t) => t.isExpense);

    res.status(200).json({ transactions: expenses });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
