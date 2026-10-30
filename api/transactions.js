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

// No cartão de crédito, um "Saldo em rotativo"/"Juros de rotativo"/etc não é
// uma compra de verdade (ver api/credit-cards.js e computeCardCycleData no
// front-end, que tratam disso com mais detalhe pro cálculo de fatura) — e um
// "Pagamento recebido"/estorno de fatura não é algo que a usuária comprou
// naquele dia. Nenhum dos dois deve aparecer na revisão diária de Realizado.
const CARD_NOISE_PATTERNS = [
  /saldo em rotativo/i,
  /juros de rotativo/i,
  /iof de rotativo/i,
  /juros de divida encerrada|juros de dívida encerrada/i,
  /encerramento de divida|encerramento de dívida/i,
  /pagamento recebido/i,
  /devolucao saldo credor|devolução saldo credor/i,
];
const isCardNoiseTransaction = (tx) =>
  CARD_NOISE_PATTERNS.some((pattern) => pattern.test(tx.description || ""));

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
    const bankAccounts = accounts.filter((account) => account.type === "BANK");
    // Conta de cartão de crédito entra também, pra compra aparecer na mesma
    // revisão diária de Realizado que o extrato bancário — datada pela data
    // real da compra, não pela fatura (isso continua calculado à parte, em
    // api/credit-cards.js / computeCardCycleData, pro lado Previsto).
    const creditAccounts = accounts.filter((account) => account.type === "CREDIT");

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
          source: "banco",
          suggestedCategory,
          confidence,
        });
      }
    }

    for (const account of creditAccounts) {
      let txs;
      try {
        txs = await fetchTransactions(account.id, { from, to });
      } catch (err) {
        // Uma conta de cartão com erro não deve derrubar o extrato bancário
        // inteiro — segue sem as compras desse cartão.
        console.error(`Falha ao buscar compras do cartão ${account.id}:`, err.message);
        continue;
      }
      for (const tx of txs) {
        if (isCardNoiseTransaction(tx)) continue;
        // Na Pluggy, pra conta de cartão de crédito, o sinal é invertido:
        // positivo é compra, negativo é pagamento/estorno — oposto da conta
        // corrente. Pagamento/estorno de fatura já foi filtrado acima por
        // descrição; o que sobrar de valor negativo é estorno de uma compra
        // específica, uma entrada de verdade no Realizado.
        const isExpense = tx.amount > 0;
        const raw = suggestCategory(tx);
        all.push({
          id: tx.id,
          date: tx.date,
          description: tx.description,
          amount: Math.abs(tx.amount),
          isExpense,
          accountName: account.name,
          // Mesmo id de conta usado em api/credit-cards.js — permite ligar
          // esse lançamento de volta a um cartão específico (ex: pra somar
          // "quanto já foi categorizado nesse ciclo" por cartão, no front-end).
          accountId: account.id,
          source: "cartao",
          suggestedCategory: isExpense ? raw.suggestedCategory : null,
          confidence: isExpense ? raw.confidence : "nenhuma",
        });
      }
    }

    res.status(200).json({ transactions: all });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
