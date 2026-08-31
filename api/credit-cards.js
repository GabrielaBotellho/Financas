// api/credit-cards.js
// GET /api/credit-cards?itemId=xxxx
//
// Busca todas as contas de cartão de crédito (type === "CREDIT") do item
// conectado, junto com as faturas (bills) e as transações de cada uma —
// pra alimentar a aba "Cartão de Crédito" do app.

const { fetchAccounts, fetchBills, fetchTransactions } = require("../lib/pluggy");

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

      // Cartão de crédito guarda ~12 meses de histórico na Pluggy; não
      // limitamos por data aqui pra trazer isso tudo de uma vez.
      const transactions = await fetchTransactions(account.id, {});

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

    res.status(200).json({ cards });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
