// api/credit-cards.js
// GET /api/credit-cards?itemId=xxxx
//
// Busca todas as contas de cartão de crédito (type === "CREDIT") do item
// conectado, junto com as faturas (bills) e as transações de cada uma —
// pra alimentar a aba "Cartão de Crédito" do app.

const { fetchAccounts, fetchBills, fetchTransactions, fetchItem } = require("../lib/pluggy");

function offsetDaysISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Método não permitido" });
    return;
  }

  const { itemId } = req.query || {};
  if (!itemId) {
    res.status(400).json({ error: "Parâmetro itemId é obrigatório" });
    return;
  }

  try {
    const accounts = await fetchAccounts(itemId);
    const creditAccounts = accounts.filter((a) => a.type === "CREDIT");

    // Status da conexão em si (não da conta) — quando sincronizou de
    // verdade pela última vez. Se essa chamada falhar, seguimos sem essa
    // informação em vez de derrubar a resposta inteira.
    let itemStatus = null;
    try {
      const item = await fetchItem(itemId);
      itemStatus = {
        status: item.status,
        executionStatus: item.executionStatus,
        lastUpdatedAt: item.lastUpdatedAt,
      };
    } catch (err) {
      console.error(`Falha ao buscar status do item ${itemId}:`, err.message);
    }

    const cards = [];
    for (const account of creditAccounts) {
      const cd = account.creditData || {};

      let bills = [];
      let billsError = null;
      try {
        bills = await fetchBills(account.id);
      } catch (err) {
        // Nem toda instituição retorna faturas via Open Finance Direct —
        // se falhar, seguimos só com as transações da conta, mas avisamos
        // o front-end do motivo (em vez de simplesmente sumir com o erro).
        console.error(`Falha ao buscar faturas da conta ${account.id}:`, err.message);
        billsError = err.message;
      }

      // Sem dateFrom/dateTo explícitos, a Pluggy parece devolver um
      // snapshot mais cacheado/desatualizado pra contas de cartão (ao
      // contrário da conta corrente em api/transactions.js, que sempre
      // manda intervalo de data e sincroniza certinho). Passar um
      // intervalo bem largo força uma consulta atualizada, cobrindo os
      // ~12 meses de histórico que a Pluggy guarda pra cartão, com folga
      // pra parcelas futuras já lançadas.
      const transactions = await fetchTransactions(account.id, {
        from: offsetDaysISO(-400),
        to: offsetDaysISO(180),
      });

      cards.push({
        id: account.id,
        name: account.name,
        brand: cd.brand || null,
        level: cd.level || null,
        last4: account.number || null,
        balance: account.balance,
        creditLimit: cd.creditLimit ?? null,
        availableCreditLimit: cd.availableCreditLimit ?? null,
        minimumPayment: cd.minimumPayment ?? null,
        balanceCloseDate: cd.balanceCloseDate || null,
        balanceDueDate: cd.balanceDueDate || null,
        billsError,
        bills: bills
          .map((b) => ({
            id: b.id,
            dueDate: b.dueDate,
            billClosingDate: b.billClosingDate || null,
            totalAmount: b.totalAmount,
            minimumPaymentAmount: b.minimumPaymentAmount ?? null,
          }))
          .sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate)),
        transactions: transactions
          .map((tx) => ({
            id: tx.id,
            date: tx.date,
            description: tx.description,
            amount: tx.amount,
            billId: tx.billId || null,
            installmentNumber: tx.creditCardMetadata?.installmentNumber ?? null,
            totalInstallments: tx.creditCardMetadata?.totalInstallments ?? null,
          }))
          .sort((a, b) => new Date(b.date) - new Date(a.date)),
      });
    }

    res.status(200).json({ cards, itemStatus });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
