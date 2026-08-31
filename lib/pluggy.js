// lib/pluggy.js
// Helper de autenticação com a API da Pluggy.
// As credenciais (CLIENT_ID / CLIENT_SECRET) nunca aparecem aqui —
// são lidas de variáveis de ambiente configuradas na Vercel.

const PLUGGY_BASE_URL = "https://api.pluggy.ai";

/**
 * Troca CLIENT_ID + CLIENT_SECRET por uma API Key válida por 2 horas.
 * Precisa ser chamada sempre em código server-side.
 */
async function getApiKey() {
  const clientId = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET não configurados nas variáveis de ambiente."
    );
  }

  const res = await fetch(`${PLUGGY_BASE_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Falha ao autenticar na Pluggy (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.apiKey;
}

/**
 * Cria um Connect Token (válido por 30 min) para o widget do Pluggy Connect
 * no front-end. Opcionalmente pode receber um itemId, para reconectar/atualizar
 * um item já existente (ex: quando a senha do banco expira).
 */
async function createConnectToken({ itemId } = {}) {
  const apiKey = await getApiKey();

  const body = {};
  if (itemId) body.itemId = itemId;

  const res = await fetch(`${PLUGGY_BASE_URL}/connect_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Falha ao criar connect token (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.accessToken;
}

/** Busca as contas (accounts) de um item já conectado. */
async function fetchAccounts(itemId) {
  const apiKey = await getApiKey();
  const res = await fetch(`${PLUGGY_BASE_URL}/accounts?itemId=${itemId}`, {
    headers: { "X-API-KEY": apiKey },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Falha ao buscar contas (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.results;
}

/**
 * Busca transações de uma conta usando o endpoint atual (v2, paginação por
 * cursor). O antigo GET /transactions com pageSize/page foi descontinuado
 * pela Pluggy. Aqui seguimos o cursor `next` até acabarem as páginas, com
 * um limite de segurança pra nunca ficar em loop.
 */
async function fetchTransactions(accountId, { from, to } = {}) {
  const apiKey = await getApiKey();

  const all = [];
  let nextQuery = null;
  const MAX_PAGES = 10; // 10 x 500 = até 5.000 transações, mais que suficiente

  for (let page = 0; page < MAX_PAGES; page++) {
    let url;
    if (nextQuery) {
      // `next` já vem como querystring pronta (ex: "?accountId=...&after=...")
      url = `${PLUGGY_BASE_URL}/v2/transactions${nextQuery}`;
    } else {
      const params = new URLSearchParams({ accountId });
      if (from) params.set("dateFrom", from);
      if (to) params.set("dateTo", to);
      url = `${PLUGGY_BASE_URL}/v2/transactions?${params.toString()}`;
    }

    const res = await fetch(url, { headers: { "X-API-KEY": apiKey } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Falha ao buscar transações (${res.status}): ${text}`);
    }
    const data = await res.json();
    all.push(...(data.results || []));

    if (!data.next) break;
    nextQuery = data.next.startsWith("?") ? data.next : `?${data.next}`;
  }

  return all;
}

/**
 * Busca as faturas (bills) de uma conta de cartão de crédito. Só existe
 * pra contas do tipo CREDIT — chamar isso numa conta BANK não retorna nada
 * útil. Vem sem paginação por cursor (lista simples).
 */
async function fetchBills(accountId) {
  const apiKey = await getApiKey();
  const res = await fetch(`${PLUGGY_BASE_URL}/bills?accountId=${accountId}`, {
    headers: { "X-API-KEY": apiKey },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Falha ao buscar faturas (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.results || [];
}

module.exports = { getApiKey, createConnectToken, fetchAccounts, fetchTransactions, fetchBills };
