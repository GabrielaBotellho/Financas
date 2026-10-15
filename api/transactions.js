// api/transactions.js
// GET /api/transactions?itemId=xxxx&from=2026-08-01&to=2026-08-31
//
// Busca todas as contas do item conectado, puxa as transações de cada
// uma no período pedido, e devolve já com uma sugestão de categoria
// (você confirma/ajusta no app antes de salvar).

const { fetchAccounts, fetchTransactions } = require("../lib/pluggy");
const { suggestCategory } = require("../lib/categorize");

// Lançamentos que são mecânica interna do banco, não movimentação real sua
// — somem completamente da importação, nunca são mostrados nem salvos:
//   - Aplicação Automática do Itaú: varre o saldo ocioso da conta pra um
//     fundo todo dia e resgata de volta quando precisa de saldo (por isso
//     nem aparece no extrato simplificado do app do banco).
//   - "Pix no crédito" do Nubank: usa o limite do cartão pra completar um
//     Pix quando falta saldo — o valor "entrando" na conta é só esse
//     mecanismo, a cobrança real já aparece na fatura do cartão.
const NOISE_DESCRIPTION_PATTERNS = [/aplic\s*aut\s*mais/i, /valor adicionado/i];
const isNoiseTransaction = (tx) =>
  NOISE_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(tx.description || ""));

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
    // Só conta corrente (BANK) entra na importação geral. Cartão de crédito
    // (CREDIT) tem aba própria (api/credit-cards.js) com as faturas — além
    // disso a Pluggy inverte o sinal do amount em contas CREDIT (positivo =
    // compra), o que faria compras do cartão aparecerem como entrada aqui.
    const bankAccounts = accounts.filter((account) => account.type === "BANK");

    const all = [];
    for (const account of bankAccounts) {
      const txs = await fetchTransactions(account.id, { from, to });
      for (const tx of txs) {
        if (isNoiseTransaction(tx)) continue;
        const isExpense = tx.amount < 0;
        // Sugestão automática de categoria de despesa só vale pra saídas —
        // pra entradas (salário, PIX recebido, etc.) o usuário categoriza na
        // mão, EXCETO no caso específico de "Investimentos": um resgate que
        // volta pra conta é uma entrada, mas ainda assim queremos detectar
        // e mandar pra aba de Investimentos automaticamente.
        const raw = suggestCategory(tx);
        let suggestedCategory = null;
        let confidence = "nenhuma";
        if (isExpense) {
          suggestedCategory = raw.suggestedCategory;
          confidence = raw.confidence;
        } else if (raw.suggestedCategory === "Investimentos") {
          suggestedCategory = raw.suggestedCategory;
          confidence = raw.confidence;
        }
        all.push({
          id: tx.id,
          date: tx.date,
          description: tx.description,
          amount: Math.abs(tx.amount),
          isExpense,
          accountName: account.name,
          suggestedCategory,
          confidence,
        });
      }
    }

    res.status(200).json({ transactions: all });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
