import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Plus,
  X,
  Trash2,
  ChevronRight,
  Home as HomeIcon,
  ListTree,
  Calendar,
  Settings as SettingsIcon,
  Wallet,
  Landmark,
  RefreshCw,
  Check,
  TrendingUp,
  CreditCard,
  Copy,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Design tokens — "caderneta" (bank passbook) theme                   */
/* ------------------------------------------------------------------ */
const INK = "#16231D";
const PAPER = "#EDE7D8";
const PAPER_LINE = "#DCD2B7";
const BRASS = "#B8863E";
const TEAL = "#3F6B58";
const CORAL = "#C1503D";
const MUTED = "#7A705F";
const CREAM_TEXT = "#EFE9DA";

// Categoria especial e fixa (não editável/apagável) pra marcar um
// lançamento do Realizado como "não é de verdade" — ex: duplicata de um
// parcelamento que a Pluggy reportou errado. Continua visível no Realizado
// pra manter o registro, mas é ignorado em todo cálculo de saldo/total das
// outras abas. É pré-cadastrada (em vez de pedir pra usuária criar) pra
// nunca depender de digitar o nome certinho.
const DISREGARD_CATEGORY = "Desconsiderar";

// CATEGORY_META/INCOME_META mapeiam categoria -> ícone (string). Começam só
// com as categorias fixas do app, mas são recalculadas (rebuildCategories)
// sempre que uma categoria personalizada é adicionada/removida — por isso
// são `let`, não `const`.
const BASE_CATEGORY_META = {
  [DISREGARD_CATEGORY]: "⊘",
  "Assinaturas": "♫",
  "Transporte - Carona": "→",
  "Transporte - Ônibus": "▭",
  "Academia": "↑",
  "Roupa": "◇",
  "Comida Dia a Dia": "○",
  "Comida Lazer": "○",
  "Ifood - Dia a Dia": "◎",
  "Ifood - Lazer": "◎",
  "Compras": "□",
  "Uber - Dia a Dia": "△",
  "Uber - Lazer": "△",
  "Cartão de Crédito Nubank": "▪",
  "Farmácia": "✚",
  "Médico": "♥",
};
let CATEGORY_META = { ...BASE_CATEGORY_META };
let CATEGORY_LIST = Object.keys(CATEGORY_META);

const BASE_INCOME_META = {
  "Salário": "$",
  "Reembolso": "↺",
  "Pix Recebido": "↓",
  "Outras Entradas": "+",
};
let INCOME_META = { ...BASE_INCOME_META };
let INCOME_CATEGORY_LIST = Object.keys(INCOME_META);

function rebuildCategories(customCategories) {
  const mergedExpense = { ...BASE_CATEGORY_META };
  const mergedIncome = { ...BASE_INCOME_META };
  customCategories.forEach((c) => {
    if (c.kind === "income") mergedIncome[c.name] = "+";
    else mergedExpense[c.name] = "•";
  });
  CATEGORY_META = mergedExpense;
  CATEGORY_LIST = Object.keys(mergedExpense);
  INCOME_META = mergedIncome;
  INCOME_CATEGORY_LIST = Object.keys(mergedIncome);
}

// Tipos de lançamento na aba Investimentos — não têm orçamento nem período
// de "gasto", só entram na conta de aportes/rendimento/resgates/acumulado.
const INVESTMENT_TYPE_META = {
  aporte: { label: "Aporte", icon: "↑", color: TEAL },
  rendimento: { label: "Rendimento", icon: "★", color: BRASS },
  resgate: { label: "Resgate", icon: "↓", color: CORAL },
};
const INVESTMENT_TYPE_LIST = Object.keys(INVESTMENT_TYPE_META);

const PLUGGY_CONNECT_SCRIPT_URL =
  "https://cdn.pluggy.ai/pluggy-connect/v2.8.2/pluggy-connect.js";

// Status possíveis do item (conexão bancária) na Pluggy — só UPDATED
// significa que sincronizou de verdade sem erro.
const ITEM_STATUS_LABEL = {
  UPDATED: "Sincronizado",
  UPDATING: "Sincronizando…",
  OUTDATED: "Desatualizado",
  LOGIN_ERROR: "Erro de login — precisa reconectar no meu.pluggy.ai",
  WAITING_USER_INPUT: "Aguardando confirmação (MFA)",
  CREATING: "Conectando…",
  CREATE_ERROR: "Erro ao conectar",
};

function fmtBRL(n) {
  return (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function addDaysISO(dateISO, n) {
  const d = new Date(dateISO + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Local persistence (localStorage — este app roda fora do sandbox     */
/* do claude.ai, então usa o storage normal do navegador)              */
/* ------------------------------------------------------------------ */
const LS_KEYS = {
  expenses: "caderneta:expenses",
  bankItemId: "caderneta:bankItemId", // legado — migrado pra bankItems no load
  bankItems: "caderneta:bankItems",
  pending: "caderneta:pending",
  customCategories: "caderneta:customCategories",
  investments: "caderneta:investments",
  creditCards: "caderneta:creditCards",
  itemStatus: "caderneta:itemStatus",
  rotativoRate: "caderneta:rotativoRate",
  cardCloseDays: "caderneta:cardCloseDays",
  cardUnreliableForecast: "caderneta:cardUnreliableForecast",
  recurring: "caderneta:recurring",
  forecasts: "caderneta:forecasts",
  startingBalance: "caderneta:startingBalance",
};

function lsGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

// Lançamentos que são mecânica interna do banco (Aplicação Automática do
// Itaú, Pix no crédito do Nubank), não movimentação real — a API já filtra
// isso em importações novas; isso aqui é só pra limpar o que ficou preso na
// fila de revisão pendente de importações feitas antes desse filtro existir.
const NOISE_DESCRIPTION_PATTERNS = [/aplic\s*aut\s*mais/i, /valor adicionado/i];
const isNoiseDescription = (description) =>
  NOISE_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(description || ""));

/* ------------------------------------------------------------------ */
/* Fluxo de caixa — janela de dias e cálculo de saldo diário            */
/* ------------------------------------------------------------------ */
const DAYS_PAST = 7;
const DAYS_FUTURE = 180;
const WEEKDAYS_PT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function formatDayLabel(dateISO) {
  const d = new Date(dateISO + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} · ${WEEKDAYS_PT[d.getDay()]}`;
}

function weekdayAbbrev(dateISO) {
  const d = new Date(dateISO + "T00:00:00");
  return WEEKDAYS_PT[d.getDay()];
}

// Uma regra recorrente vale no dia D de cada mês — em meses mais curtos que
// D (ex: regra no dia 31, mês de fevereiro), cai no último dia do mês.
function isRecurringDue(rule, dateISO) {
  const d = new Date(dateISO + "T00:00:00");
  const day = d.getDate();
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const targetDay = Math.min(Number(rule.dayOfMonth) || 1, lastDay);
  return day === targetDay;
}

// Soma o efeito em caixa de uma lista de lançamentos (Realizado ou
// Previsto) num dia. Uma compra no cartão de crédito (source "cartao") não
// move dinheiro da conta naquele dia — só a fatura paga (ou, pra frente,
// prevista) afeta o saldo — por isso pode ser excluída via excludeSource.
function cashDelta(items, { excludeSource } = {}) {
  return items.reduce((s, it) => {
    if (excludeSource && it.source === excludeSource) return s;
    return s + (it.type === "income" ? it.amount : -it.amount);
  }, 0);
}

// Mesma regra de fechamento de fatura usada em computeCardCycleData, só que
// solta (sem precisar das transações do cartão) — usada pra agrupar
// lançamentos do Realizado pelo ciclo de fatura a que pertencem.
function cycleMonthKeyFor(dateISO, closeDay) {
  const [y, m, d] = dateISO.slice(0, 10).split("-").map(Number);
  if (d <= closeDay) return `${y}-${String(m).padStart(2, "0")}`;
  const dt = new Date(y, m - 1, 1);
  dt.setMonth(dt.getMonth() + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

function dayItemLabel(it) {
  if (it.source === "cartao-auto") return it.note || it.category;
  const base = it.note ? `${it.category} · ${it.note}` : it.category;
  if (it.source === "cartao") return `${base} · cartão`;
  return base;
}

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */
function Perforation({ bg = PAPER, dot = INK }) {
  return (
    <div
      style={{
        height: 12,
        width: "100%",
        backgroundImage: `radial-gradient(circle, ${bg} 2.6px, transparent 3px)`,
        backgroundSize: "14px 12px",
        backgroundPosition: "center",
        backgroundColor: dot,
        backgroundRepeat: "repeat-x",
      }}
    />
  );
}

function Card({ children }) {
  return (
    <div
      style={{
        background: "#F5F1E5",
        border: `1px solid ${PAPER_LINE}`,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children, style }) {
  return (
    <div
      style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
        letterSpacing: 1,
        textTransform: "uppercase",
        color: MUTED,
        marginBottom: 8,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pluggy Connect loader                                               */
/* ------------------------------------------------------------------ */
function loadPluggyScript() {
  return new Promise((resolve, reject) => {
    if (window.PluggyConnect) {
      resolve();
      return;
    }
    const existing = document.querySelector(`script[src="${PLUGGY_CONNECT_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Falha ao carregar o widget da Pluggy.")));
      return;
    }
    const script = document.createElement("script");
    script.src = PLUGGY_CONNECT_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Falha ao carregar o widget da Pluggy."));
    document.body.appendChild(script);
  });
}

/* ------------------------------------------------------------------ */
/* Main App                                                            */
/* ------------------------------------------------------------------ */
export default function FinancasApp() {
  const [customCategories, setCustomCategories] = useState(
    () => lsGet(LS_KEYS.customCategories) || []
  );
  // Sempre que o componente renderiza, garante que CATEGORY_META/CATEGORY_LIST
  // (usadas em todo o app) reflitam as categorias personalizadas atuais.
  rebuildCategories(customCategories);

  // Ledger único de Realizado: despesas e entradas, vindas do banco, do
  // cartão de crédito, ou lançadas manualmente (campo `source`).
  const [expenses, setExpenses] = useState(() => lsGet(LS_KEYS.expenses) || []);

  // Previsto: regras recorrentes (categoria + valor + dia do mês) e
  // lançamentos pontuais futuros, lançados manualmente na aba Previsto.
  const [recurring, setRecurring] = useState(() => lsGet(LS_KEYS.recurring) || []);
  const [forecasts, setForecasts] = useState(() => lsGet(LS_KEYS.forecasts) || []);
  // Saldo da conta "agora" — âncora do Fluxo de Caixa: dias futuros somam a
  // partir dele, dias passados são reconstruídos subtraindo o que
  // aconteceu entre eles e hoje.
  const [startingBalance, setStartingBalance] = useState(
    () => lsGet(LS_KEYS.startingBalance) ?? 0
  );

  // Taxa de juros do rotativo (% ao mês) — a Pluggy não retorna isso, então
  // a usuária informa direto, olhando no app do banco/contrato do cartão.
  const [rotativoRate, setRotativoRate] = useState(() => lsGet(LS_KEYS.rotativoRate) ?? 16);
  // Dia em que a fatura fecha, por cartão (id da conta) — cada banco tem um
  // ciclo diferente (Itaú fecha dia 3, Nubank fecha dia 23, etc).
  const [cardCloseDays, setCardCloseDays] = useState(() => lsGet(LS_KEYS.cardCloseDays) || {});
  // Se a data prevista pela Pluggy pra parcela futura desse cartão costuma
  // "pular" um mês — quando marcado, corrige a previsão a partir de
  // qualquer parcela já realizada; quando não, confia na previsão.
  const [cardUnreliableForecast, setCardUnreliableForecast] = useState(
    () => lsGet(LS_KEYS.cardUnreliableForecast) || {}
  );
  // O widget "Meu Pluggy" só deixa escolher UM banco por vez — então cada
  // banco vira uma conexão própria, com seu próprio itemId. Migra o antigo
  // bankItemId (valor único) pra essa lista, se existir.
  const [bankItems, setBankItems] = useState(() => {
    const stored = lsGet(LS_KEYS.bankItems);
    if (stored) return stored;
    const legacy = lsGet(LS_KEYS.bankItemId);
    return legacy ? [{ itemId: legacy, label: "Banco 1" }] : [];
  });
  const [pendingItems, setPendingItems] = useState(() => {
    const stored = lsGet(LS_KEYS.pending) || [];
    const cleaned = stored.filter((p) => !isNoiseDescription(p.description));
    if (cleaned.length !== stored.length) lsSet(LS_KEYS.pending, cleaned);
    return cleaned;
  });
  const [investments, setInvestments] = useState(() => lsGet(LS_KEYS.investments) || []);
  const [creditCards, setCreditCards] = useState(() => lsGet(LS_KEYS.creditCards) || []);
  const [itemStatuses, setItemStatuses] = useState(() => lsGet(LS_KEYS.itemStatus) || []);
  const [ccStatus, setCcStatus] = useState("idle"); // idle | loading

  const [tab, setTab] = useState("fluxo"); // fluxo | realizado | previsto | invest | settings
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState("");

  const [bankStatus, setBankStatus] = useState("idle"); // idle | connecting | importing | reviewing
  const [importCandidates, setImportCandidates] = useState([]);

  const saveExpenses = useCallback((next) => {
    setExpenses(next);
    if (!lsSet(LS_KEYS.expenses, next)) {
      setError("Não consegui salvar. Tente novamente.");
    }
  }, []);

  const saveRotativoRate = useCallback((nextRate) => {
    setRotativoRate(nextRate);
    if (!lsSet(LS_KEYS.rotativoRate, nextRate)) {
      setError("Não consegui salvar a taxa de juros.");
    }
  }, []);

  const saveCardCloseDays = useCallback((nextMap) => {
    setCardCloseDays(nextMap);
    if (!lsSet(LS_KEYS.cardCloseDays, nextMap)) {
      setError("Não consegui salvar o dia de fechamento da fatura.");
    }
  }, []);

  const saveCardUnreliableForecast = useCallback((nextMap) => {
    setCardUnreliableForecast(nextMap);
    if (!lsSet(LS_KEYS.cardUnreliableForecast, nextMap)) {
      setError("Não consegui salvar a configuração de previsão de parcelas.");
    }
  }, []);

  const addCustomCategory = (name, kind) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const exists = [...CATEGORY_LIST, ...INCOME_CATEGORY_LIST].some(
      (c) => c.toLowerCase() === trimmed.toLowerCase()
    );
    if (exists) {
      setError("Essa categoria já existe.");
      return;
    }
    const next = [...customCategories, { name: trimmed, kind: kind === "income" ? "income" : "expense" }];
    setCustomCategories(next);
    lsSet(LS_KEYS.customCategories, next);
  };

  const removeCustomCategory = (name) => {
    const next = customCategories.filter((c) => c.name !== name);
    setCustomCategories(next);
    lsSet(LS_KEYS.customCategories, next);
  };

  const savePending = useCallback((next) => {
    setPendingItems(next);
    lsSet(LS_KEYS.pending, next);
  }, []);

  const saveBankItems = useCallback((next) => {
    setBankItems(next);
    lsSet(LS_KEYS.bankItems, next);
  }, []);

  const addExpense = (exp) => {
    const next = [{ ...exp, id: uid() }, ...expenses];
    saveExpenses(next);
    setShowAdd(false);
  };

  const addManyExpenses = (list) => {
    const withIds = list.map((e) => ({ ...e, id: uid() }));
    saveExpenses([...withIds, ...expenses]);
  };

  const deleteExpense = (id) => {
    saveExpenses(expenses.filter((e) => e.id !== id));
  };

  /* -------------------- previsto: recorrentes e pontuais ------------- */
  const saveRecurring = useCallback((next) => {
    setRecurring(next);
    lsSet(LS_KEYS.recurring, next);
  }, []);
  const addRecurring = (r) => saveRecurring([{ ...r, id: uid() }, ...recurring]);
  const deleteRecurring = (id) => saveRecurring(recurring.filter((r) => r.id !== id));

  const saveForecasts = useCallback((next) => {
    setForecasts(next);
    lsSet(LS_KEYS.forecasts, next);
  }, []);
  const addForecast = (f) => saveForecasts([{ ...f, id: uid() }, ...forecasts]);
  const deleteForecast = (id) => saveForecasts(forecasts.filter((f) => f.id !== id));

  const saveStartingBalance = useCallback((amount) => {
    setStartingBalance(amount);
    lsSet(LS_KEYS.startingBalance, amount);
  }, []);

  /* -------------------- rendimentos (aportes/rendimento/resgates) ---- */
  const saveInvestments = useCallback((next) => {
    setInvestments(next);
    if (!lsSet(LS_KEYS.investments, next)) {
      setError("Não consegui salvar. Tente novamente.");
    }
  }, []);

  const addInvestment = (inv) => {
    const next = [{ ...inv, id: uid() }, ...investments];
    saveInvestments(next);
    setShowAdd(false);
  };

  const addManyInvestments = (list) => {
    const withIds = list.map((i) => ({ ...i, id: uid() }));
    saveInvestments([...withIds, ...investments]);
  };

  const deleteInvestment = (id) => {
    saveInvestments(investments.filter((i) => i.id !== id));
  };

  // Apaga só os lançamentos (gastos, entradas, investimentos, cartão e
  // pendências de importação). Mantém a conexão bancária, as categorias
  // personalizadas e as previsões (recorrentes e pontuais), que são
  // preferências/planejamento e não "histórico realizado".
  const resetAllData = useCallback(() => {
    saveExpenses([]);
    saveInvestments([]);
    savePending([]);
    setCreditCards([]);
    lsSet(LS_KEYS.creditCards, []);
  }, [saveExpenses, saveInvestments, savePending]);

  // Remove uma conexão específica. Os cartões e o status guardados em cache
  // são só reconstruídos no próximo "Buscar faturas".
  const removeBankItem = useCallback(
    (itemId) => {
      saveBankItems(bankItems.filter((b) => b.itemId !== itemId));
      const nextCards = creditCards.filter((c) => c.bankItemId !== itemId);
      setCreditCards(nextCards);
      lsSet(LS_KEYS.creditCards, nextCards);
      const nextStatuses = itemStatuses.filter((s) => s.itemId !== itemId);
      setItemStatuses(nextStatuses);
      lsSet(LS_KEYS.itemStatus, nextStatuses);
    },
    [bankItems, creditCards, itemStatuses, saveBankItems]
  );

  /* -------------------- cartão de crédito (faturas) ------------------- */
  // Busca cartões de TODAS as conexões (Itaú, Nubank, etc) e junta tudo
  // numa lista só. Alimenta o cálculo automático de previsão de fatura.
  const fetchCreditCards = useCallback(async () => {
    if (bankItems.length === 0) return;
    setCcStatus("loading");
    setError("");
    try {
      const results = await Promise.all(
        bankItems.map(async (b) => {
          try {
            const res = await fetch(`/api/credit-cards?itemId=${encodeURIComponent(b.itemId)}`);
            if (!res.ok) {
              let detail = `HTTP ${res.status}`;
              try {
                const body = await res.json();
                if (body?.error) detail = body.error;
              } catch (_) {}
              throw new Error(detail);
            }
            const { cards, itemStatus } = await res.json();
            return {
              cards: cards.map((c) => ({ ...c, bankItemId: b.itemId, bankLabel: b.label })),
              itemStatus: itemStatus ? { ...itemStatus, itemId: b.itemId, label: b.label } : null,
              error: null,
            };
          } catch (err) {
            console.error(`Falha ao buscar cartões de ${b.label}:`, err.message);
            return { cards: [], itemStatus: null, error: `${b.label}: ${err.message}` };
          }
        })
      );

      const allCards = results.flatMap((r) => r.cards);
      const allStatuses = results.map((r) => r.itemStatus).filter(Boolean);
      const errors = results.map((r) => r.error).filter(Boolean);
      setCreditCards(allCards);
      lsSet(LS_KEYS.creditCards, allCards);
      setItemStatuses(allStatuses);
      lsSet(LS_KEYS.itemStatus, allStatuses);
      if (errors.length > 0) {
        setError(`Não consegui buscar os cartões de: ${errors.join(" · ")}`);
      }
    } catch (e) {
      console.error(e);
      setError(e.message || "Não consegui buscar os cartões de crédito.");
    } finally {
      setCcStatus("idle");
    }
  }, [bankItems]);

  /* -------------------- conexão bancária (Pluggy) -------------------- */
  const connectBank = useCallback(async () => {
    setError("");
    setBankStatus("connecting");
    try {
      await loadPluggyScript();

      const res = await fetch("/api/connect-token");
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) detail = body.error;
        } catch (_) {}
        throw new Error(`Não consegui gerar o token de conexão (${detail})`);
      }
      const { accessToken } = await res.json();

      const pluggyConnect = new window.PluggyConnect({
        connectToken: accessToken,
        includeSandbox: false,
        onSuccess: (itemData) => {
          const newItemId = itemData?.item?.id;
          if (newItemId) {
            const defaultLabel = `Banco ${bankItems.length + 1}`;
            const label = (window.prompt(
              "Como quer chamar essa conexão? (ex: Itaú, Nubank)",
              defaultLabel
            ) || defaultLabel).trim() || defaultLabel;
            saveBankItems([...bankItems, { itemId: newItemId, label }]);
            importTransactions([newItemId]);
          } else {
            setBankStatus("idle");
          }
        },
        onError: (err) => {
          console.error(err);
          setError("A conexão com o banco falhou ou foi cancelada.");
          setBankStatus("idle");
        },
        onClose: () => {
          setBankStatus((s) => (s === "connecting" ? "idle" : s));
        },
      });
      pluggyConnect.init();
    } catch (e) {
      console.error(e);
      setError(e.message || "Não consegui abrir a conexão com o banco.");
      setBankStatus("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankItems, saveBankItems]);

  const importTransactions = useCallback(async (itemIds) => {
    setBankStatus("importing");
    setError("");
    try {
      const from = daysAgoISO(90);
      const to = todayISO();
      const results = await Promise.all(
        itemIds.map(async (itemId) => {
          try {
            const res = await fetch(
              `/api/transactions?itemId=${encodeURIComponent(itemId)}&from=${from}&to=${to}`
            );
            if (!res.ok) {
              let detail = `HTTP ${res.status}`;
              try {
                const body = await res.json();
                if (body?.error) detail = body.error;
              } catch (_) {}
              throw new Error(detail);
            }
            const { transactions } = await res.json();
            return { transactions, error: null };
          } catch (err) {
            console.error(`Falha ao buscar transações do item ${itemId}:`, err.message);
            return { transactions: [], error: err.message };
          }
        })
      );
      const transactions = results.flatMap((r) => r.transactions);
      const fetchErrors = results.map((r) => r.error).filter(Boolean);

      // Evita sugerir de novo transações que já foram importadas antes
      // (heurística simples: mesma data + mesmo valor + mesma descrição).
      const existingKeys = new Set(
        expenses.map((e) => `${e.date}|${e.amount}|${e.note || ""}`)
      );
      const existingInvestmentKeys = new Set(
        investments.map((i) => `${i.date}|${i.amount}|${i.note || ""}`)
      );
      const alreadyPendingKeys = new Set(pendingItems.map((p) => p.key));

      const fresh = transactions
        .filter((t) => !isNoiseDescription(t.description))
        .filter((t) => !alreadyPendingKeys.has(t.id))
        .filter((t) => {
          const key = `${t.date?.slice(0, 10)}|${t.amount}|${t.description || ""}`;
          const isInvestment = t.suggestedCategory === "Investimentos";
          return isInvestment ? !existingInvestmentKeys.has(key) : !existingKeys.has(key);
        })
        .map((t) => {
          // "Investimentos" é um caso especial: o lançamento inteiro vai
          // direto pra aba Investimentos (aporte se saiu, resgate se voltou).
          if (t.suggestedCategory === "Investimentos") {
            return {
              key: t.id,
              date: (t.date || "").slice(0, 10),
              amount: t.amount,
              description: t.description,
              accountName: t.accountName,
              type: "investment",
              investType: t.isExpense ? "aporte" : "resgate",
              confidence: t.confidence,
              source: t.source,
              accountId: t.accountId,
              include: true,
            };
          }
          return {
            key: t.id,
            date: (t.date || "").slice(0, 10),
            amount: t.amount,
            description: t.description,
            accountName: t.accountName,
            type: t.isExpense ? "expense" : "income",
            category: t.isExpense
              ? t.suggestedCategory || CATEGORY_LIST[0]
              : INCOME_CATEGORY_LIST[0],
            confidence: t.confidence,
            source: t.source,
            accountId: t.accountId,
            // entradas sempre exigem revisão manual, então começam
            // desmarcadas por padrão
            include: t.isExpense ? !!t.suggestedCategory : false,
          };
        });

      const merged = [...pendingItems, ...fresh];
      savePending(merged);
      setImportCandidates(merged);
      setBankStatus("reviewing");
      if (fetchErrors.length > 0) {
        setError(`Não consegui buscar lançamentos de uma das conexões: ${fetchErrors.join(" · ")}`);
      }
    } catch (e) {
      console.error(e);
      setError(e.message || "Não consegui importar as transações.");
      setBankStatus("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, investments, pendingItems, savePending]);

  const confirmImport = (finalList) => {
    const included = finalList.filter((c) => c.include);

    const normalToAdd = included
      .filter((c) => c.type !== "investment")
      .map((c) => ({
        type: c.type || "expense",
        category: c.category,
        amount: Math.abs(Number(c.amount)),
        date: c.date,
        note: c.description || "",
        source: c.source || "banco",
        // Liga o lançamento de volta ao cartão de origem (mesmo id usado em
        // creditCards) — usado pra somar "quanto já foi categorizado nesse
        // ciclo" por cartão, no topo do Realizado.
        accountId: c.accountId || null,
      }));
    if (normalToAdd.length > 0) addManyExpenses(normalToAdd);

    const investmentToAdd = included
      .filter((c) => c.type === "investment")
      .map((c) => ({
        type: c.investType,
        amount: Math.abs(Number(c.amount)),
        date: c.date,
        note: c.description || "",
      }));
    if (investmentToAdd.length > 0) addManyInvestments(investmentToAdd);

    const reviewedKeys = new Set(finalList.map((c) => c.key));
    savePending(pendingItems.filter((p) => !reviewedKeys.has(p.key)));

    setImportCandidates([]);
    setBankStatus("idle");
  };

  const cancelImport = () => {
    setImportCandidates([]);
    setBankStatus("idle");
  };

  const reviewPending = useCallback(() => {
    setImportCandidates(pendingItems);
    setBankStatus("reviewing");
  }, [pendingItems]);

  const refreshAllBanks = useCallback(() => {
    if (bankItems.length > 0) {
      importTransactions(bankItems.map((b) => b.itemId));
    }
  }, [bankItems, importTransactions]);

  /* -------------------- derived data -------------------- */
  const pendingTotal = pendingItems.reduce((s, p) => s + Math.abs(p.amount), 0);

  const aportesTotal = investments.filter((i) => i.type === "aporte").reduce((s, i) => s + i.amount, 0);
  const rendimentoTotal = investments.filter((i) => i.type === "rendimento").reduce((s, i) => s + i.amount, 0);
  const resgatesTotal = investments.filter((i) => i.type === "resgate").reduce((s, i) => s + i.amount, 0);
  const accumulated = investments.reduce(
    (s, inv) => s + (inv.type === "resgate" ? -inv.amount : inv.amount),
    0
  );

  // Previsão automática de fatura de cartão: pra cada cartão conectado,
  // calcula o total das próximas ~6 faturas usando o mesmo motor validado
  // da aba antiga de Cartão (computeCardCycleData), e estima a data de
  // vencimento a partir do histórico real de faturas do próprio cartão.
  const cardAutoForecasts = useMemo(() => {
    const today = todayISO();
    const out = [];
    creditCards.forEach((card) => {
      const closeDay = cardCloseDays[card.id] || 3;
      const forecastIsUnreliable = !!cardUnreliableForecast[card.id];
      const bills = card.bills || [];
      const offsets = bills
        .filter((b) => b.billClosingDate && b.dueDate)
        .map((b) => Math.round((new Date(b.dueDate) - new Date(b.billClosingDate)) / 86400000))
        .filter((n) => n > 0 && n < 40);
      const dueDayOffset = offsets.length
        ? Math.round(offsets.reduce((a, b) => a + b, 0) / offsets.length)
        : 7;

      const [ty, tm, td] = today.split("-").map(Number);
      let cycleY = ty;
      let cycleM = tm - 1; // 0-indexado
      if (td > closeDay) {
        cycleM += 1;
        if (cycleM > 11) {
          cycleM = 0;
          cycleY += 1;
        }
      }

      for (let o = 0; o < 6; o++) {
        let y = cycleY;
        let m = cycleM + o;
        while (m > 11) {
          m -= 12;
          y += 1;
        }
        const { periodTotal } = computeCardCycleData(card, {
          cursor: { y, m },
          viewMode: "mes",
          closeDay,
          forecastIsUnreliable,
          today,
        });
        if (!periodTotal || periodTotal <= 0) continue;
        const closingDate = new Date(y, m, closeDay);
        const dueDate = new Date(closingDate);
        dueDate.setDate(dueDate.getDate() + dueDayOffset);
        const dueDateISO = dueDate.toISOString().slice(0, 10);
        if (dueDateISO <= today) continue;
        out.push({
          id: `cartao-auto-${card.id}-${y}-${m}`,
          type: "expense",
          category: "Cartão de Crédito",
          amount: periodTotal,
          date: dueDateISO,
          note: `Fatura ${card.name}${card.bankLabel ? " · " + card.bankLabel : ""}`,
          source: "cartao-auto",
          cardId: card.id,
        });
      }
    });
    return out;
  }, [creditCards, cardCloseDays, cardUnreliableForecast]);

  // Lançamentos marcados como "Desconsiderar" somem de todo cálculo (saldo
  // do Fluxo, total categorizado por cartão) mas continuam visíveis na
  // lista do Realizado, pra manter o registro de por que foram ignorados.
  const activeExpenses = useMemo(
    () => expenses.filter((e) => e.category !== DISREGARD_CATEGORY),
    [expenses]
  );

  // Quanto já foi categorizado (confirmado no Realizado) de cada cartão,
  // dentro do ciclo de fatura que ainda está em aberto — dá o panorama do
  // "já categorizei X desse cartão" enquanto a fatura ainda não fechou.
  const cardCycleTotals = useMemo(() => {
    const today = todayISO();
    return creditCards.map((card) => {
      const closeDay = cardCloseDays[card.id] || 3;
      const openCycleKey = cycleMonthKeyFor(today, closeDay);
      const total = activeExpenses
        .filter(
          (e) =>
            e.source === "cartao" &&
            e.accountId === card.id &&
            cycleMonthKeyFor(e.date, closeDay) === openCycleKey
        )
        .reduce((s, e) => s + (e.type === "income" ? -e.amount : e.amount), 0);
      return {
        cardId: card.id,
        label: `${card.name}${card.bankLabel ? " · " + card.bankLabel : ""}`,
        total,
      };
    });
  }, [creditCards, cardCloseDays, activeExpenses]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: PAPER,
        fontFamily: "'IBM Plex Sans', sans-serif",
        color: INK,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,680&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { margin: 0; }
        button { font-family: inherit; cursor: pointer; }
        input, select { font-family: inherit; }
        ::selection { background: ${BRASS}; color: ${INK}; }
        @media (prefers-reduced-motion: reduce) {
          * { transition: none !important; animation: none !important; }
        }
      `}</style>

      <div style={{ width: "100%", maxWidth: 430, minHeight: "100vh", display: "flex", flexDirection: "column", position: "relative" }}>
        {/* ---------------- COVER ---------------- */}
        <div style={{ background: INK, color: CREAM_TEXT, padding: "28px 20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Wallet size={16} color={BRASS} />
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1.5, color: BRASS, textTransform: "uppercase" }}>
              Caderneta
            </span>
          </div>
          <div style={{ marginTop: 14, fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 20 }}>
            {TAB_TITLES[tab]}
          </div>
        </div>
        <Perforation bg={PAPER} dot={INK} />

        {/* ---------------- CONTENT ---------------- */}
        <div style={{ flex: 1, padding: "18px 16px 100px" }}>
          {error && (
            <div style={{ background: "#F3D9D3", color: CORAL, fontSize: 12, padding: "8px 10px", borderRadius: 6, marginBottom: 14, display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{error}</span>
              <button onClick={() => setError("")} style={{ background: "none", border: "none", color: CORAL }}>
                <X size={14} />
              </button>
            </div>
          )}

          {tab === "fluxo" && (
            <FluxoView
              expenses={activeExpenses}
              recurring={recurring}
              forecasts={forecasts}
              cardAutoForecasts={cardAutoForecasts}
              startingBalance={startingBalance}
              onSaveStartingBalance={saveStartingBalance}
            />
          )}

          {tab === "realizado" && (
            <RealizadoView
              expenses={expenses}
              pendingTotal={pendingTotal}
              pendingCount={pendingItems.length}
              onReviewPending={reviewPending}
              onDelete={deleteExpense}
              cardCycleTotals={cardCycleTotals}
            />
          )}

          {tab === "previsto" && (
            <PrevistoView
              recurring={recurring}
              onAddRecurring={addRecurring}
              onDeleteRecurring={deleteRecurring}
              forecasts={forecasts}
              onAddForecast={addForecast}
              onDeleteForecast={deleteForecast}
              cardAutoForecasts={cardAutoForecasts}
              hasBank={bankItems.length > 0}
              creditCards={creditCards}
              ccStatus={ccStatus}
              onFetchCards={fetchCreditCards}
            />
          )}

          {tab === "invest" && (
            <InvestmentsView
              aportes={aportesTotal}
              rendimento={rendimentoTotal}
              resgates={resgatesTotal}
              accumulated={accumulated}
              entries={investments}
              onDelete={deleteInvestment}
            />
          )}

          {tab === "settings" && (
            <ConfigView
              rotativoRate={rotativoRate}
              onSaveRotativoRate={saveRotativoRate}
              creditCards={creditCards}
              cardCloseDays={cardCloseDays}
              onSaveCardCloseDays={saveCardCloseDays}
              cardUnreliableForecast={cardUnreliableForecast}
              onSaveCardUnreliableForecast={saveCardUnreliableForecast}
              bankItems={bankItems}
              itemStatuses={itemStatuses}
              bankStatus={bankStatus}
              onConnectBank={connectBank}
              onRefreshAll={refreshAllBanks}
              onRemoveBankItem={removeBankItem}
              customCategories={customCategories}
              onAddCategory={addCustomCategory}
              onRemoveCategory={removeCustomCategory}
              onResetData={resetAllData}
            />
          )}
        </div>

        {/* ---------------- FAB ---------------- */}
        {(tab === "fluxo" || tab === "realizado" || tab === "invest") && (
          <button
            onClick={() => setShowAdd(true)}
            aria-label={tab === "invest" ? "Adicionar lançamento de rendimento" : "Adicionar lançamento"}
            style={{
              position: "fixed",
              bottom: 78,
              left: "50%",
              transform: "translateX(-50%)",
              maxWidth: 430,
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: TEAL,
              color: CREAM_TEXT,
              border: `3px solid ${PAPER}`,
              boxShadow: "0 4px 14px rgba(22,35,29,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Plus size={26} />
          </button>
        )}

        {/* ---------------- BOTTOM NAV ---------------- */}
        <div
          style={{
            position: "fixed",
            bottom: 0,
            width: "100%",
            maxWidth: 430,
            background: INK,
            display: "flex",
            justifyContent: "space-around",
            padding: "10px 0 max(10px, env(safe-area-inset-bottom))",
          }}
        >
          {[
            { id: "fluxo", label: "Fluxo", Icon: HomeIcon },
            { id: "realizado", label: "Realizado", Icon: ListTree },
            { id: "previsto", label: "Previsto", Icon: Calendar },
            { id: "invest", label: "Investir", Icon: TrendingUp },
            { id: "settings", label: "Config", Icon: SettingsIcon },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                background: "none",
                border: "none",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                color: tab === id ? BRASS : "rgba(239,233,218,0.5)",
                fontSize: 10,
                fontFamily: "'IBM Plex Mono', monospace",
                letterSpacing: 0.5,
              }}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </div>

        {showAdd && tab === "invest" && (
          <AddInvestmentModal onClose={() => setShowAdd(false)} onAdd={addInvestment} />
        )}
        {showAdd && tab !== "invest" && (
          <AddExpenseModal onClose={() => setShowAdd(false)} onAdd={addExpense} />
        )}

        {bankStatus === "reviewing" && (
          <ImportReviewModal
            candidates={importCandidates}
            onCancel={cancelImport}
            onConfirm={confirmImport}
          />
        )}
      </div>
    </div>
  );
}

const TAB_TITLES = {
  fluxo: "Fluxo de caixa",
  realizado: "Realizado",
  previsto: "Previsto",
  invest: "Investimentos",
  settings: "Configurações",
};

/* ------------------------------------------------------------------ */
/* Fluxo de Caixa view — panorama diário, Realizado (passado/hoje) x   */
/* Previsto (futuro), com saldo projetado dia a dia                    */
/* ------------------------------------------------------------------ */
function FluxoView({ expenses, recurring, forecasts, cardAutoForecasts, startingBalance, onSaveStartingBalance }) {
  const [localBalance, setLocalBalance] = useState(startingBalance ?? "");
  useEffect(() => {
    setLocalBalance(startingBalance ?? "");
  }, [startingBalance]);

  const today = todayISO();

  const days = useMemo(() => {
    const list = [];
    const start = new Date();
    start.setDate(start.getDate() - DAYS_PAST);
    for (let i = 0; i <= DAYS_PAST + DAYS_FUTURE; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      list.push(d.toISOString().slice(0, 10));
    }
    return list;
  }, [today]);

  const realizedByDay = useMemo(() => {
    const map = {};
    expenses.forEach((e) => {
      (map[e.date] = map[e.date] || []).push(e);
    });
    return map;
  }, [expenses]);

  const forecastsByDay = useMemo(() => {
    const map = {};
    days.forEach((d) => {
      if (d <= today) return;
      const items = [];
      recurring.forEach((r) => {
        if (r.active === false) return;
        if (isRecurringDue(r, d)) items.push(r);
      });
      forecasts.forEach((f) => {
        if (f.date === d) items.push(f);
      });
      cardAutoForecasts.forEach((f) => {
        if (f.date === d) items.push(f);
      });
      if (items.length) map[d] = items;
    });
    return map;
  }, [days, today, recurring, forecasts, cardAutoForecasts]);

  const balances = useMemo(() => {
    const map = {};
    const anchor = Number(startingBalance) || 0;
    map[today] = anchor;
    let running = anchor;
    days
      .filter((d) => d > today)
      .sort()
      .forEach((d) => {
        running += cashDelta(forecastsByDay[d] || []);
        map[d] = running;
      });
    days
      .filter((d) => d < today)
      .sort()
      .reverse()
      .forEach((d) => {
        const nextDay = addDaysISO(d, 1);
        const nextBalance = map[nextDay] ?? anchor;
        const delta = cashDelta(realizedByDay[nextDay] || [], { excludeSource: "cartao" });
        map[d] = nextBalance - delta;
      });
    return map;
  }, [days, today, forecastsByDay, realizedByDay, startingBalance]);

  const handleSaveBalance = () => onSaveStartingBalance(Number(localBalance) || 0);

  return (
    <div>
      <SectionLabel>Saldo atual</SectionLabel>
      <Card>
        <div style={{ padding: "14px" }}>
          <input
            type="number"
            inputMode="decimal"
            value={localBalance}
            onChange={(e) => setLocalBalance(e.target.value)}
            onBlur={handleSaveBalance}
            placeholder="0,00"
            style={{ ...fieldInput, margin: 0, fontFamily: "'IBM Plex Mono', monospace", fontSize: 18 }}
          />
        </div>
        <div style={{ fontSize: 11, color: MUTED, padding: "0 14px 12px" }}>
          O saldo da sua conta agora — o ponto de partida. Os dias abaixo são
          calculados a partir dele: pra frente usando o Previsto, pra trás
          reconstruindo com o Realizado.
        </div>
      </Card>

      <SectionLabel style={{ marginTop: 22 }}>
        Próximos {DAYS_FUTURE} dias · realizado e previsto
      </SectionLabel>

      {days.map((d) => {
        const isFuture = d > today;
        const isToday = d === today;
        const items = isFuture ? forecastsByDay[d] || [] : realizedByDay[d] || [];
        const balance = balances[d];
        const hasItems = items.length > 0;

        if (!hasItems && !isToday) {
          return (
            <div
              key={d}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "6px 14px",
                fontSize: 11.5,
                color: MUTED,
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            >
              <span>{formatDayLabel(d)}</span>
              <span>{fmtBRL(balance)}</span>
            </div>
          );
        }

        return (
          <div key={d} style={{ marginBottom: 10 }}>
            <Card>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  background: isToday ? "#F3E7CE" : "#F5F1E5",
                  borderBottom: hasItems ? `1px solid ${PAPER_LINE}` : "none",
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                  {formatDayLabel(d)}
                  {isToday ? " · hoje" : ""}
                  {isFuture ? " · previsto" : ""}
                </span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 13,
                    fontWeight: 600,
                    color: balance >= 0 ? TEAL : CORAL,
                  }}
                >
                  {fmtBRL(balance)}
                </span>
              </div>
              {items.map((it, i) => (
                <div
                  key={it.id || i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "8px 14px",
                    borderBottom: i === items.length - 1 ? "none" : `1px solid ${PAPER_LINE}`,
                    opacity: it.source === "cartao" ? 0.6 : 1,
                  }}
                >
                  <span style={{ fontSize: 12.5 }}>{dayItemLabel(it)}</span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: it.type === "income" ? TEAL : INK,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {it.type === "income" ? "+ " : "− "}
                    {fmtBRL(it.amount)}
                  </span>
                </div>
              ))}
            </Card>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Realizado view — extrato diário unificado (banco + cartão + manual) */
/* ------------------------------------------------------------------ */
function RealizadoView({ expenses, pendingTotal, pendingCount, onReviewPending, onDelete, cardCycleTotals }) {
  const sorted = [...expenses].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return (
    <div>
      {cardCycleTotals && cardCycleTotals.length > 0 && (
        <>
          <SectionLabel>Cartão · já categorizado neste ciclo</SectionLabel>
          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            {cardCycleTotals.map((c) => (
              <div
                key={c.cardId}
                style={{
                  flex: 1,
                  background: "#F5F1E5",
                  border: `1px solid ${PAPER_LINE}`,
                  borderLeft: `3px solid ${TEAL}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                }}
              >
                <div
                  style={{
                    fontSize: 10.5,
                    fontFamily: "'IBM Plex Mono', monospace",
                    color: MUTED,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  {c.label}
                </div>
                <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 17, marginTop: 2 }}>
                  {fmtBRL(c.total)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {pendingCount > 0 && (
        <button
          onClick={onReviewPending}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            background: "#F3E7CE",
            border: `1px solid ${BRASS}`,
            borderRadius: 8,
            padding: "12px 14px",
            marginBottom: 18,
            textAlign: "left",
          }}
        >
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>
              {fmtBRL(pendingTotal)} ainda não categorizado{pendingCount > 1 ? "s" : ""}
            </div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
              {pendingCount} lançamento{pendingCount > 1 ? "s" : ""} do banco/cartão · toque para revisar
            </div>
          </div>
          <ChevronRight size={18} color={BRASS} />
        </button>
      )}

      <SectionLabel>Lançamentos</SectionLabel>
      {sorted.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 10px", color: MUTED, fontSize: 13 }}>
          Nenhum gasto lançado ainda.
          <br />
          Toque no + para registrar o primeiro, ou conecte seu banco em Config.
        </div>
      ) : (
        <Card>
          {sorted.map((e, i) => (
            <div
              key={e.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 14px",
                borderBottom: i === sorted.length - 1 ? "none" : `1px solid ${PAPER_LINE}`,
                opacity: e.category === DISREGARD_CATEGORY ? 0.5 : 1,
              }}
            >
              <div style={{ fontSize: 16, width: 22, textAlign: "center", color: MUTED }}>
                {e.type === "income" ? INCOME_META[e.category] || "+" : CATEGORY_META[e.category] || "•"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                  {e.category}
                  {e.source === "cartao" && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 9.5,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                        color: MUTED,
                        border: `1px solid ${MUTED}`,
                        borderRadius: 4,
                        padding: "1px 5px",
                      }}
                    >
                      Cartão
                    </span>
                  )}
                  {e.category === DISREGARD_CATEGORY && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 9.5,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                        color: CORAL,
                        border: `1px solid ${CORAL}`,
                        borderRadius: 4,
                        padding: "1px 5px",
                      }}
                    >
                      Ignorado nas outras abas
                    </span>
                  )}
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: MUTED, marginTop: 2 }}>
                  {new Date(e.date + "T00:00:00").toLocaleDateString("pt-BR")} · {weekdayAbbrev(e.date)}
                  {e.note ? ` · ${e.note}` : ""}
                </div>
              </div>
              <div
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: e.type === "income" ? TEAL : INK,
                }}
              >
                {e.type === "income" ? "+ " : ""}
                {fmtBRL(e.amount)}
              </div>
              <button
                onClick={() => onDelete(e.id)}
                aria-label="Excluir gasto"
                style={{ background: "none", border: "none", color: MUTED, padding: 4 }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Previsto view — regras recorrentes, lançamentos pontuais futuros e  */
/* previsão automática de fatura de cartão                             */
/* ------------------------------------------------------------------ */
function PrevistoView({
  recurring,
  onAddRecurring,
  onDeleteRecurring,
  forecasts,
  onAddForecast,
  onDeleteForecast,
  cardAutoForecasts,
  hasBank,
  creditCards,
  ccStatus,
  onFetchCards,
}) {
  const [newRecType, setNewRecType] = useState("expense");
  const [newRecCategory, setNewRecCategory] = useState(CATEGORY_LIST[0]);
  const [newRecAmount, setNewRecAmount] = useState("");
  const [newRecDay, setNewRecDay] = useState("5");
  const [newRecNote, setNewRecNote] = useState("");

  const [newFcType, setNewFcType] = useState("expense");
  const [newFcCategory, setNewFcCategory] = useState(CATEGORY_LIST[0]);
  const [newFcAmount, setNewFcAmount] = useState("");
  const [newFcDate, setNewFcDate] = useState(todayISO());
  const [newFcNote, setNewFcNote] = useState("");

  const categoriesFor = (type) => (type === "income" ? INCOME_CATEGORY_LIST : CATEGORY_LIST);

  const handleAddRecurring = () => {
    if (!(Number(newRecAmount) > 0)) return;
    onAddRecurring({
      type: newRecType,
      category: newRecCategory,
      amount: Number(newRecAmount),
      dayOfMonth: Math.min(31, Math.max(1, Number(newRecDay) || 1)),
      note: newRecNote.trim(),
      active: true,
    });
    setNewRecAmount("");
    setNewRecNote("");
  };

  const handleAddForecast = () => {
    if (!(Number(newFcAmount) > 0)) return;
    onAddForecast({
      type: newFcType,
      category: newFcCategory,
      amount: Number(newFcAmount),
      date: newFcDate,
      note: newFcNote.trim(),
      source: "manual",
    });
    setNewFcAmount("");
    setNewFcNote("");
  };

  const sortedRecurring = [...recurring].sort((a, b) => a.dayOfMonth - b.dayOfMonth);
  const sortedForecasts = [...forecasts].sort((a, b) => (a.date < b.date ? -1 : 1));
  const sortedCardForecasts = [...cardAutoForecasts].sort((a, b) => (a.date < b.date ? -1 : 1));

  const typeToggle = (value, onChange) => (
    <div style={{ display: "flex", gap: 8 }}>
      {[{ id: "expense", label: "Despesa" }, { id: "income", label: "Entrada" }].map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          style={{
            flex: 1,
            background: value === opt.id ? INK : "#F5F1E5",
            color: value === opt.id ? CREAM_TEXT : INK,
            border: `1px solid ${value === opt.id ? INK : PAPER_LINE}`,
            borderRadius: 6,
            padding: "8px",
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <SectionLabel>Recorrentes</SectionLabel>
      {sortedRecurring.length === 0 ? (
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 14 }}>
          Nenhum lançamento recorrente ainda — ex: aluguel todo dia 5, salário
          todo dia 1, transporte todo dia 10.
        </div>
      ) : (
        <Card>
          {sortedRecurring.map((r, i) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                borderBottom: i === sortedRecurring.length - 1 ? "none" : `1px solid ${PAPER_LINE}`,
              }}
            >
              <div style={{ width: 38, textAlign: "center", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: MUTED }}>
                dia {r.dayOfMonth}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {r.category}
                  {r.note ? ` · ${r.note}` : ""}
                </div>
              </div>
              <div
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 13,
                  fontWeight: 600,
                  color: r.type === "income" ? TEAL : INK,
                }}
              >
                {r.type === "income" ? "+ " : "− "}
                {fmtBRL(r.amount)}
              </div>
              <button
                onClick={() => onDeleteRecurring(r.id)}
                aria-label="Excluir recorrente"
                style={{ background: "none", border: "none", color: MUTED, padding: 4 }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </Card>
      )}

      <Card>
        <div style={{ padding: "14px" }}>
          <label style={{ ...fieldLabel, marginTop: 0 }}>Tipo</label>
          {typeToggle(newRecType, (v) => {
            setNewRecType(v);
            setNewRecCategory(categoriesFor(v)[0]);
          })}

          <label style={fieldLabel}>Categoria</label>
          <select value={newRecCategory} onChange={(e) => setNewRecCategory(e.target.value)} style={fieldInput}>
            {categoriesFor(newRecType).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={fieldLabel}>Valor (R$)</label>
              <input
                type="number"
                inputMode="decimal"
                value={newRecAmount}
                onChange={(e) => setNewRecAmount(e.target.value)}
                placeholder="0,00"
                style={{ ...fieldInput, fontFamily: "'IBM Plex Mono', monospace" }}
              />
            </div>
            <div style={{ width: 90 }}>
              <label style={fieldLabel}>Dia do mês</label>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={31}
                value={newRecDay}
                onChange={(e) => setNewRecDay(e.target.value)}
                style={{ ...fieldInput, fontFamily: "'IBM Plex Mono', monospace" }}
              />
            </div>
          </div>

          <label style={fieldLabel}>Nota (opcional)</label>
          <input
            type="text"
            value={newRecNote}
            onChange={(e) => setNewRecNote(e.target.value)}
            placeholder="ex: aluguel, salário"
            style={fieldInput}
          />

          <button
            onClick={handleAddRecurring}
            disabled={!(Number(newRecAmount) > 0)}
            style={{
              marginTop: 14,
              width: "100%",
              background: Number(newRecAmount) > 0 ? TEAL : PAPER_LINE,
              color: Number(newRecAmount) > 0 ? CREAM_TEXT : MUTED,
              border: "none",
              borderRadius: 8,
              padding: "11px",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Adicionar recorrente
          </button>
        </div>
      </Card>

      <SectionLabel style={{ marginTop: 22 }}>Lançamentos pontuais futuros</SectionLabel>
      {sortedForecasts.length === 0 ? (
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 14 }}>
          Nenhum lançamento pontual futuro ainda — ex: uma viagem, uma compra
          grande já planejada.
        </div>
      ) : (
        <Card>
          {sortedForecasts.map((f, i) => (
            <div
              key={f.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                borderBottom: i === sortedForecasts.length - 1 ? "none" : `1px solid ${PAPER_LINE}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {f.category}
                  {f.note ? ` · ${f.note}` : ""}
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: MUTED, marginTop: 2 }}>
                  {new Date(f.date + "T00:00:00").toLocaleDateString("pt-BR")}
                </div>
              </div>
              <div
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 13,
                  fontWeight: 600,
                  color: f.type === "income" ? TEAL : INK,
                }}
              >
                {f.type === "income" ? "+ " : "− "}
                {fmtBRL(f.amount)}
              </div>
              <button
                onClick={() => onDeleteForecast(f.id)}
                aria-label="Excluir lançamento pontual"
                style={{ background: "none", border: "none", color: MUTED, padding: 4 }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </Card>
      )}

      <Card>
        <div style={{ padding: "14px" }}>
          <label style={{ ...fieldLabel, marginTop: 0 }}>Tipo</label>
          {typeToggle(newFcType, (v) => {
            setNewFcType(v);
            setNewFcCategory(categoriesFor(v)[0]);
          })}

          <label style={fieldLabel}>Categoria</label>
          <select value={newFcCategory} onChange={(e) => setNewFcCategory(e.target.value)} style={fieldInput}>
            {categoriesFor(newFcType).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={fieldLabel}>Valor (R$)</label>
              <input
                type="number"
                inputMode="decimal"
                value={newFcAmount}
                onChange={(e) => setNewFcAmount(e.target.value)}
                placeholder="0,00"
                style={{ ...fieldInput, fontFamily: "'IBM Plex Mono', monospace" }}
              />
            </div>
            <div style={{ width: 130 }}>
              <label style={fieldLabel}>Data</label>
              <input
                type="date"
                value={newFcDate}
                onChange={(e) => setNewFcDate(e.target.value)}
                style={fieldInput}
              />
            </div>
          </div>

          <label style={fieldLabel}>Nota (opcional)</label>
          <input
            type="text"
            value={newFcNote}
            onChange={(e) => setNewFcNote(e.target.value)}
            placeholder="ex: viagem de fim de ano"
            style={fieldInput}
          />

          <button
            onClick={handleAddForecast}
            disabled={!(Number(newFcAmount) > 0)}
            style={{
              marginTop: 14,
              width: "100%",
              background: Number(newFcAmount) > 0 ? TEAL : PAPER_LINE,
              color: Number(newFcAmount) > 0 ? CREAM_TEXT : MUTED,
              border: "none",
              borderRadius: 8,
              padding: "11px",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Adicionar lançamento pontual
          </button>
        </div>
      </Card>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 22 }}>
        <SectionLabel style={{ marginBottom: 0 }}>
          <CreditCard size={12} style={{ marginRight: 4, verticalAlign: "-2px" }} />
          Faturas de cartão (automático)
        </SectionLabel>
      </div>

      {!hasBank ? (
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 8 }}>
          Conecte seu banco em Config pra prever a fatura do cartão automaticamente.
        </div>
      ) : (
        <>
          <button
            onClick={onFetchCards}
            disabled={ccStatus === "loading"}
            style={{
              width: "100%",
              marginTop: 10,
              background: creditCards.length > 0 ? "#F5F1E5" : TEAL,
              color: creditCards.length > 0 ? INK : CREAM_TEXT,
              border: creditCards.length > 0 ? `1px solid ${PAPER_LINE}` : "none",
              borderRadius: 8,
              padding: "11px",
              fontSize: 13,
              fontWeight: 600,
              opacity: ccStatus === "loading" ? 0.6 : 1,
            }}
          >
            {ccStatus === "loading" ? "Buscando faturas…" : creditCards.length > 0 ? "Atualizar faturas" : "Buscar faturas"}
          </button>

          {sortedCardForecasts.length === 0 ? (
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 10 }}>
              Nenhuma fatura futura calculada ainda.
            </div>
          ) : (
            <Card>
              {sortedCardForecasts.map((f, i) => (
                <div
                  key={f.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    borderBottom: i === sortedCardForecasts.length - 1 ? "none" : `1px solid ${PAPER_LINE}`,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>{f.note}</div>
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                      vence em {new Date(f.date).toLocaleDateString("pt-BR")}
                    </div>
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 600 }}>
                    {fmtBRL(f.amount)}
                  </div>
                </div>
              ))}
            </Card>
          )}
          <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>
            Esses valores entram automaticamente no Fluxo de Caixa como previsão
            de saída, na data estimada de vencimento.
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Investments (Rendimentos) view                                      */
/* ------------------------------------------------------------------ */
function InvestmentsView({ aportes, rendimento, resgates, accumulated, entries, onDelete }) {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div>
      <SectionLabel>Acumulado</SectionLabel>
      <Card>
        <div style={{ padding: "16px 14px", textAlign: "center" }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 680, fontSize: 32 }}>
            {fmtBRL(accumulated)}
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
            soma de todos os aportes + rendimento − resgates até hoje
          </div>
        </div>
      </Card>

      <SectionLabel style={{ marginTop: 22 }}>Total histórico</SectionLabel>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <InvestSummaryCard label="Aportes" value={aportes} meta={INVESTMENT_TYPE_META.aporte} />
        <InvestSummaryCard label="Rendimento" value={rendimento} meta={INVESTMENT_TYPE_META.rendimento} />
        <InvestSummaryCard label="Resgates" value={resgates} meta={INVESTMENT_TYPE_META.resgate} />
      </div>

      <SectionLabel>Lançamentos</SectionLabel>
      {sorted.length === 0 ? (
        <div style={{ textAlign: "center", padding: "30px 10px", color: MUTED, fontSize: 13 }}>
          Nenhum lançamento de rendimento ainda.
          <br />
          Toque no + para registrar um aporte, rendimento ou resgate.
        </div>
      ) : (
        <Card>
          {sorted.map((inv, i) => {
            const meta = INVESTMENT_TYPE_META[inv.type] || INVESTMENT_TYPE_META.aporte;
            const sign = inv.type === "resgate" ? "− " : "+ ";
            return (
              <div
                key={inv.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 14px",
                  borderBottom: i === sorted.length - 1 ? "none" : `1px solid ${PAPER_LINE}`,
                }}
              >
                <div style={{ fontSize: 16, width: 22, textAlign: "center", color: meta.color }}>
                  {meta.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{meta.label}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: MUTED, marginTop: 2 }}>
                    {new Date(inv.date + "T00:00:00").toLocaleDateString("pt-BR")}
                    {inv.note ? ` · ${inv.note}` : ""}
                  </div>
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13.5, fontWeight: 600, color: meta.color }}>
                  {sign}
                  {fmtBRL(inv.amount)}
                </div>
                <button
                  onClick={() => onDelete(inv.id)}
                  aria-label="Excluir lançamento"
                  style={{ background: "none", border: "none", color: MUTED, padding: 4 }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function InvestSummaryCard({ label, value, meta }) {
  return (
    <div
      style={{
        flex: 1,
        background: "#F5F1E5",
        border: `1px solid ${PAPER_LINE}`,
        borderLeft: `3px solid ${meta.color}`,
        borderRadius: 8,
        padding: "10px 10px",
      }}
    >
      <div style={{ fontSize: 15, color: meta.color, marginBottom: 4 }}>{meta.icon}</div>
      <div style={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 15.5, marginTop: 2 }}>
        {fmtBRL(value)}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cálculo de ciclo/fatura de cartão de crédito — motor validado,       */
/* reaproveitado pela previsão automática de fatura em Previsto.        */
/* ------------------------------------------------------------------ */
function computeCardCycleData(card, { cursor, viewMode, closeDay, forecastIsUnreliable, today }) {
  const BILL_CLOSE_DAY = closeDay || 3;
  const cycleMonthKey = (dateStr) => {
    const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
    if (d <= BILL_CLOSE_DAY) return `${y}-${String(m).padStart(2, "0")}`;
    const dt = new Date(y, m - 1, 1);
    dt.setMonth(dt.getMonth() + 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  };

  const allCardTransactions = card?.transactions || [];

  const stripInstallmentSuffix = (description, installmentNumber, totalInstallments) => {
    if (!description || !installmentNumber || !totalInstallments) return description || "";
    const padded = `${String(installmentNumber).padStart(2, "0")}/${String(totalInstallments).padStart(2, "0")}`;
    const unpadded = `${installmentNumber}/${totalInstallments}`;
    if (description.endsWith(padded)) return description.slice(0, -padded.length);
    if (description.endsWith(unpadded)) return description.slice(0, -unpadded.length);
    return description;
  };
  const descriptionsMatch = (a, b) => {
    if (!a || !b) return false;
    const len = Math.min(a.length, b.length);
    if (len < 6) return a === b;
    return a.slice(0, len) === b.slice(0, len);
  };
  const nextMonthKey = (key) => {
    const [y, m] = key.split("-").map(Number);
    const dt = new Date(y, m - 1, 1);
    dt.setMonth(dt.getMonth() + 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  };
  const effectiveCycleKey = (tx) => {
    const rawKey = cycleMonthKey(tx.date || "");
    if (!tx.totalInstallments || tx.totalInstallments <= 1 || !tx.installmentNumber) {
      return rawKey;
    }
    if ((tx.date || "").slice(0, 10) <= today) {
      return rawKey;
    }
    const txBaseDescription = stripInstallmentSuffix(
      tx.description,
      tx.installmentNumber,
      tx.totalInstallments
    );
    const realizedSiblings = allCardTransactions.filter(
      (o) =>
        (o.date || "").slice(0, 10) <= today &&
        o.installmentNumber &&
        Number(o.totalInstallments) === Number(tx.totalInstallments) &&
        descriptionsMatch(
          stripInstallmentSuffix(o.description, o.installmentNumber, o.totalInstallments),
          txBaseDescription
        )
    );
    if (forecastIsUnreliable && realizedSiblings.length >= 1) {
      const anchor = realizedSiblings.reduce((a, b) =>
        b.installmentNumber > a.installmentNumber ? b : a
      );
      const anchorKey = cycleMonthKey(anchor.date || "");
      const [y, m] = anchorKey.split("-").map(Number);
      const dt = new Date(y, m - 1, 1);
      dt.setMonth(dt.getMonth() + (tx.installmentNumber - anchor.installmentNumber));
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    }
    const previous = allCardTransactions.find(
      (o) =>
        o.installmentNumber === tx.installmentNumber - 1 &&
        Number(o.totalInstallments) === Number(tx.totalInstallments) &&
        descriptionsMatch(
          stripInstallmentSuffix(o.description, o.installmentNumber, o.totalInstallments),
          txBaseDescription
        )
    );
    if (!previous) {
      return rawKey;
    }
    const floorKey = nextMonthKey(effectiveCycleKey(previous));
    return rawKey > floorKey ? rawKey : floorKey;
  };

  const normalizeDescription = (s) =>
    (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  const ROTATIVO_ADJUSTMENT_PREFIXES = [
    "saldo em rotativo",
    "juros de rotativo",
    "iof de rotativo",
    "juros de divida encerrada",
    "encerramento de divida",
  ];
  const isRotativoAdjustment = (tx) => {
    const d = normalizeDescription(tx.description);
    return ROTATIVO_ADJUSTMENT_PREFIXES.some((p) => d.startsWith(p));
  };
  const INVOICE_PAYMENT_PREFIXES = ["pagamento recebido", "devolucao saldo credor"];
  const isInvoicePayment = (tx) => {
    const d = normalizeDescription(tx.description);
    return INVOICE_PAYMENT_PREFIXES.some((p) => d.startsWith(p));
  };

  const cycleGroups = new Map();
  allCardTransactions.forEach((tx) => {
    if (isRotativoAdjustment(tx) || isInvoicePayment(tx)) return;
    const key = effectiveCycleKey(tx);
    if (!cycleGroups.has(key)) cycleGroups.set(key, []);
    cycleGroups.get(key).push(tx);
  });

  const todayCycleKey = cycleMonthKey(today);

  const selectedCycleKeys =
    viewMode === "ano"
      ? [...cycleGroups.keys()].filter((k) => k.startsWith(`${cursor.y}-`)).sort()
      : [`${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`];

  const billTransactions = selectedCycleKeys
    .flatMap((k) => cycleGroups.get(k) || [])
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const periodTotal = billTransactions.reduce((s, tx) => s + tx.amount, 0);

  const isCurrentCycle = viewMode === "mes" && selectedCycleKeys[0] === todayCycleKey;
  const isFutureCycle = viewMode === "mes" && selectedCycleKeys[0] > todayCycleKey;
  const summaryLabel = isCurrentCycle ? "em aberto" : isFutureCycle ? "ainda não fechou" : "";

  return {
    allCardTransactions,
    cycleMonthKey,
    stripInstallmentSuffix,
    descriptionsMatch,
    nextMonthKey,
    effectiveCycleKey,
    normalizeDescription,
    isRotativoAdjustment,
    isInvoicePayment,
    cycleGroups,
    todayCycleKey,
    selectedCycleKeys,
    billTransactions,
    periodTotal,
    isCurrentCycle,
    isFutureCycle,
    summaryLabel,
  };
}

/* ------------------------------------------------------------------ */
/* Config view                                                         */
/* ------------------------------------------------------------------ */
function ConfigView({
  rotativoRate,
  onSaveRotativoRate,
  creditCards,
  cardCloseDays,
  onSaveCardCloseDays,
  cardUnreliableForecast,
  onSaveCardUnreliableForecast,
  bankItems,
  itemStatuses,
  bankStatus,
  onConnectBank,
  onRefreshAll,
  onRemoveBankItem,
  customCategories,
  onAddCategory,
  onRemoveCategory,
  onResetData,
}) {
  const [localRotativoRate, setLocalRotativoRate] = useState(rotativoRate ?? 16);
  const [localCardCloseDays, setLocalCardCloseDays] = useState(cardCloseDays || {});
  const [localCardUnreliableForecast, setLocalCardUnreliableForecast] = useState(
    cardUnreliableForecast || {}
  );
  const [saved, setSaved] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatKind, setNewCatKind] = useState("expense");
  const [resetDone, setResetDone] = useState(false);
  const [copiedItemId, setCopiedItemId] = useState(null);

  // Garante uma linha (com o padrão de dia 3) pra cada cartão já
  // carregado, sem perder o que já foi digitado pra outros.
  useEffect(() => {
    setLocalCardCloseDays((cd) => {
      let changed = false;
      const merged = { ...cd };
      creditCards.forEach((c) => {
        if (!(c.id in merged)) {
          merged[c.id] = 3;
          changed = true;
        }
      });
      return changed ? merged : cd;
    });
  }, [creditCards]);

  const handleSave = () => {
    onSaveRotativoRate(Number(localRotativoRate) || 0);
    const cleanedCloseDays = {};
    Object.keys(localCardCloseDays).forEach((id) => {
      cleanedCloseDays[id] = Number(localCardCloseDays[id]) || 3;
    });
    onSaveCardCloseDays(cleanedCloseDays);
    onSaveCardUnreliableForecast(localCardUnreliableForecast);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const handleAddCategory = () => {
    if (!newCatName.trim()) return;
    onAddCategory(newCatName, newCatKind);
    setNewCatName("");
    setNewCatKind("expense");
  };

  const handleResetData = () => {
    const ok = window.confirm(
      "Isso apaga TODOS os gastos, entradas, investimentos e dados do cartão salvos no aparelho. Não dá pra desfazer. Continuar?"
    );
    if (!ok) return;
    onResetData();
    setResetDone(true);
    setTimeout(() => setResetDone(false), 2200);
  };

  const handleCopyItemId = async (itemId) => {
    try {
      await navigator.clipboard.writeText(itemId);
      setCopiedItemId(itemId);
      setTimeout(() => setCopiedItemId((id) => (id === itemId ? null : id)), 2000);
    } catch (_) {
      // Clipboard API pode falhar — sem fallback, o ID continua visível na
      // tela pra copiar manualmente.
    }
  };

  const handleRemoveBankItem = (itemId, label) => {
    const ok = window.confirm(
      `Esquecer a conexão "${label}"? Os gastos, entradas e categorias já salvos continuam intactos.`
    );
    if (!ok) return;
    onRemoveBankItem(itemId);
  };

  const busy = bankStatus === "connecting" || bankStatus === "importing";

  return (
    <div>
      <SectionLabel>Conexão bancária</SectionLabel>
      <Card>
        <div style={{ padding: "14px" }}>
          <div style={{ fontSize: 13, marginBottom: 10, color: INK }}>
            {bankItems.length === 0
              ? "Conecte o Itaú ou o Nubank pra importar os gastos automaticamente, via Pluggy."
              : "O widget do Meu Pluggy só deixa escolher um banco por vez — cada banco conectado vira uma conexão própria aqui embaixo."}
          </div>

          {bankItems.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {bankItems.map((b) => (
                <div
                  key={b.itemId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#F5F1E5",
                    border: `1px solid ${PAPER_LINE}`,
                    borderRadius: 6,
                    padding: "8px 10px",
                    marginBottom: 6,
                  }}
                >
                  <button
                    onClick={() => handleCopyItemId(b.itemId)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flex: 1,
                      minWidth: 0,
                      background: "none",
                      border: "none",
                      textAlign: "left",
                    }}
                  >
                    {copiedItemId === b.itemId ? (
                      <Check size={13} color={TEAL} />
                    ) : (
                      <Copy size={13} color={MUTED} />
                    )}
                    <span style={{ fontSize: 12, fontWeight: 600, color: INK, flexShrink: 0 }}>
                      {b.label}
                    </span>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 10.5,
                        color: MUTED,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {copiedItemId === b.itemId ? "Copiado" : b.itemId}
                    </span>
                  </button>
                  <button
                    onClick={() => handleRemoveBankItem(b.itemId, b.label)}
                    aria-label={`Esquecer conexão ${b.label}`}
                    style={{ background: "none", border: "none", color: MUTED, padding: 4, flexShrink: 0 }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {itemStatuses.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {itemStatuses.map((s) => (
                <div
                  key={s.itemId}
                  style={{
                    fontSize: 11,
                    color: s.status === "UPDATED" ? MUTED : CORAL,
                    textAlign: "center",
                  }}
                >
                  {s.label}: {ITEM_STATUS_LABEL[s.status] || s.status || "Status da conexão desconhecido"}
                  {s.lastUpdatedAt
                    ? ` · última sincronização ${new Date(s.lastUpdatedAt).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}`
                    : ""}
                </div>
              ))}
            </div>
          )}

          <button
            onClick={onConnectBank}
            disabled={busy}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: bankItems.length > 0 ? "#F5F1E5" : TEAL,
              color: bankItems.length > 0 ? INK : CREAM_TEXT,
              border: bankItems.length > 0 ? `1px solid ${PAPER_LINE}` : "none",
              borderRadius: 8,
              padding: "12px",
              fontSize: 13.5,
              fontWeight: 600,
              opacity: busy ? 0.6 : 1,
            }}
          >
            <Landmark size={16} />
            {bankStatus === "connecting"
              ? "Abrindo conexão…"
              : bankItems.length > 0
              ? "Adicionar outro banco"
              : "Conectar banco"}
          </button>

          {bankItems.length > 0 && (
            <button
              onClick={onRefreshAll}
              disabled={busy}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                background: "none",
                color: TEAL,
                border: `1px solid ${TEAL}`,
                borderRadius: 8,
                padding: "12px",
                fontSize: 13.5,
                fontWeight: 600,
                marginTop: 8,
                opacity: busy ? 0.6 : 1,
              }}
            >
              <RefreshCw size={16} />
              {bankStatus === "importing" ? "Buscando lançamentos…" : "Buscar novos lançamentos"}
            </button>
          )}
        </div>
      </Card>

      <SectionLabel style={{ marginTop: 22 }}>Juros do rotativo do cartão</SectionLabel>
      <Card>
        <div style={{ padding: "12px 14px" }}>
          <input
            type="number"
            inputMode="decimal"
            value={localRotativoRate}
            onChange={(e) => setLocalRotativoRate(e.target.value)}
            placeholder="16"
            style={{
              width: "100%",
              border: `1px solid ${PAPER_LINE}`,
              borderRadius: 6,
              padding: "8px 10px",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 14,
              background: PAPER,
            }}
          />
          <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>
            Taxa mensal (% a.m.) cobrada quando a fatura não é paga integralmente.
            A Pluggy não informa isso — confira no app do banco/contrato do cartão.
          </div>
        </div>
      </Card>

      {creditCards.length > 0 && (
        <>
          <SectionLabel style={{ marginTop: 22 }}>Dia de fechamento da fatura</SectionLabel>
          <Card>
            <div style={{ fontSize: 11, color: MUTED, padding: "10px 14px 4px" }}>
              Cada banco fecha num dia diferente (ex: Itaú fecha dia 3, Nubank fecha
              dia 23 — ciclo de 24 de um mês a 23 do outro). Uma compra feita depois
              desse dia entra na fatura do mês seguinte.
            </div>
            {creditCards.map((c, i) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "10px 14px",
                  borderBottom: i === creditCards.length - 1 ? "none" : `1px solid ${PAPER_LINE}`,
                }}
              >
                <span style={{ fontSize: 13, flex: 1 }}>
                  {c.name}
                  {c.bankLabel ? ` · ${c.bankLabel}` : ""}
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={31}
                  value={localCardCloseDays[c.id] ?? 3}
                  onChange={(e) =>
                    setLocalCardCloseDays((cd) => ({ ...cd, [c.id]: e.target.value }))
                  }
                  style={{
                    width: 60,
                    border: `1px solid ${PAPER_LINE}`,
                    borderRadius: 6,
                    padding: "6px 8px",
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 13,
                    textAlign: "right",
                    background: PAPER,
                  }}
                />
              </div>
            ))}
          </Card>

          <SectionLabel style={{ marginTop: 22 }}>Previsão de parcelas futuras</SectionLabel>
          <Card>
            <div style={{ fontSize: 11, color: MUTED, padding: "10px 14px 4px" }}>
              Alguns bancos preveem a data de parcelas futuras errado (ela "pula" um
              mês) — confirmado no Itaú, não acontece no Nubank. Marque só os cartões
              onde isso acontecer de verdade; marcar sem necessidade também erra a
              conta.
            </div>
            {creditCards.map((c, i) => (
              <label
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  borderBottom: i === creditCards.length - 1 ? "none" : `1px solid ${PAPER_LINE}`,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={!!localCardUnreliableForecast[c.id]}
                  onChange={(e) =>
                    setLocalCardUnreliableForecast((m) => ({ ...m, [c.id]: e.target.checked }))
                  }
                />
                <span style={{ fontSize: 13, flex: 1 }}>
                  {c.name}
                  {c.bankLabel ? ` · ${c.bankLabel}` : ""}
                </span>
              </label>
            ))}
          </Card>
        </>
      )}

      <SectionLabel style={{ marginTop: 22 }}>Nova categoria</SectionLabel>
      <Card>
        <div style={{ padding: "14px" }}>
          <label style={{ ...fieldLabel, marginTop: 0 }}>Nome</label>
          <input
            type="text"
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            placeholder="ex: Pet, Presentes, Casa"
            style={fieldInput}
          />

          <label style={fieldLabel}>Tipo</label>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { id: "expense", label: "Despesa" },
              { id: "income", label: "Entrada" },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => setNewCatKind(opt.id)}
                style={{
                  flex: 1,
                  background: newCatKind === opt.id ? INK : "#F5F1E5",
                  color: newCatKind === opt.id ? CREAM_TEXT : INK,
                  border: `1px solid ${newCatKind === opt.id ? INK : PAPER_LINE}`,
                  borderRadius: 6,
                  padding: "8px",
                  fontSize: 12.5,
                  fontWeight: 600,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleAddCategory}
            disabled={!newCatName.trim()}
            style={{
              marginTop: 14,
              width: "100%",
              background: newCatName.trim() ? TEAL : PAPER_LINE,
              color: newCatName.trim() ? CREAM_TEXT : MUTED,
              border: "none",
              borderRadius: 8,
              padding: "11px",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Adicionar categoria
          </button>
        </div>

        {customCategories.length > 0 && (
          <div style={{ borderTop: `1px solid ${PAPER_LINE}` }}>
            {customCategories.map((c, i) => (
              <div
                key={c.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "10px 14px",
                  borderBottom: i === customCategories.length - 1 ? "none" : `1px solid ${PAPER_LINE}`,
                }}
              >
                <div>
                  <div style={{ fontSize: 13 }}>{c.name}</div>
                  <div style={{ fontSize: 10.5, color: MUTED, marginTop: 1 }}>
                    {c.kind === "income" ? "Entrada" : "Despesa"}
                  </div>
                </div>
                <button
                  onClick={() => onRemoveCategory(c.name)}
                  aria-label={`Remover categoria ${c.name}`}
                  style={{ background: "none", border: "none", color: MUTED, padding: 4 }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <button
        onClick={handleSave}
        style={{
          marginTop: 18,
          width: "100%",
          background: saved ? TEAL : INK,
          color: CREAM_TEXT,
          border: "none",
          borderRadius: 8,
          padding: "13px",
          fontSize: 13.5,
          fontWeight: 600,
          letterSpacing: 0.3,
        }}
      >
        {saved ? "Salvo ✓" : "Salvar configurações"}
      </button>

      <SectionLabel style={{ marginTop: 22 }}>Zona de risco</SectionLabel>
      <Card>
        <div style={{ padding: "14px" }}>
          <div style={{ fontSize: 13, marginBottom: 10, color: INK }}>
            Apaga gastos, entradas, investimentos e dados do cartão salvos
            neste aparelho. A conexão com o banco, as categorias
            personalizadas e as previsões (recorrentes e pontuais) continuam
            salvas.
          </div>
          <button
            onClick={handleResetData}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: resetDone ? TEAL : "none",
              color: resetDone ? CREAM_TEXT : CORAL,
              border: `1px solid ${resetDone ? TEAL : CORAL}`,
              borderRadius: 8,
              padding: "12px",
              fontSize: 13.5,
              fontWeight: 600,
            }}
          >
            {resetDone ? <Check size={16} /> : <Trash2 size={16} />}
            {resetDone ? "Todos os dados foram apagados" : "Apagar todos os lançamentos"}
          </button>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Import review modal — transações vindas do banco/cartão, aguardando */
/* confirmação de categoria antes de entrarem no Realizado             */
/* ------------------------------------------------------------------ */
function ImportReviewModal({ candidates, onCancel, onConfirm }) {
  const [list, setList] = useState(candidates);
  const [monthFilter, setMonthFilter] = useState("all");

  const toggleInclude = (key) => {
    setList((l) => l.map((c) => (c.key === key ? { ...c, include: !c.include } : c)));
  };
  const setCategory = (key, category) => {
    setList((l) => l.map((c) => (c.key === key ? { ...c, category } : c)));
  };
  const setInvestType = (key, investType) => {
    setList((l) => l.map((c) => (c.key === key ? { ...c, investType } : c)));
  };

  const includedCount = list.filter((c) => c.include).length;

  const sortedList = useMemo(
    () => [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [list]
  );

  const months = useMemo(() => {
    const set = new Set(sortedList.map((c) => c.date.slice(0, 7)));
    return [...set].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }, [sortedList]);

  const monthLabel = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    return `${MONTHS_PT[m - 1].slice(0, 3)}/${String(y).slice(2)}`;
  };

  const visibleList =
    monthFilter === "all"
      ? sortedList
      : sortedList.filter((c) => c.date.slice(0, 7) === monthFilter);

  const visibleIncludedCount = visibleList.filter((c) => c.include).length;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(22,35,29,0.55)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 430,
          maxHeight: "88vh",
          background: PAPER,
          borderRadius: "16px 16px 0 0",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 18px 10px" }}>
          <span style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 17 }}>
            Revisar importação
          </span>
          <button onClick={onCancel} style={{ background: "none", border: "none", color: MUTED }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ fontSize: 11.5, color: MUTED, padding: "0 18px 10px" }}>
          {list.length === 0
            ? "Nenhum lançamento novo encontrado nos últimos 90 dias."
            : "Confira a categoria de cada lançamento — despesas já vêm com sugestão quando possível; entradas comuns (salário, PIX recebido) você categoriza na mão; lançamentos de investimento (aporte/resgate) vão direto pra aba Investimentos. Compras no cartão aparecem marcadas — elas entram no Realizado, mas não afetam o saldo do Fluxo de Caixa (só a fatura paga afeta). Desmarque o que não quiser importar."}
        </div>

        {months.length > 1 && (
          <div
            style={{
              display: "flex",
              flexShrink: 0,
              flexWrap: "nowrap",
              gap: 6,
              overflowX: "auto",
              overflowY: "hidden",
              padding: "0 18px 12px",
            }}
          >
            {["all", ...months].map((ym) => (
              <button
                key={ym}
                onClick={() => setMonthFilter(ym)}
                style={{
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                  padding: "5px 10px",
                  borderRadius: 20,
                  border: `1px solid ${monthFilter === ym ? TEAL : PAPER_LINE}`,
                  background: monthFilter === ym ? TEAL : "transparent",
                  color: monthFilter === ym ? CREAM_TEXT : INK,
                }}
              >
                {ym === "all" ? "Todos" : monthLabel(ym)}
              </button>
            ))}
          </div>
        )}

        {monthFilter !== "all" && (
          <div style={{ fontSize: 11, color: MUTED, padding: "0 18px 10px" }}>
            {visibleIncludedCount} de {visibleList.length} selecionados em {monthLabel(monthFilter)}
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: "0 18px" }}>
          {visibleList.map((c) => (
            <div
              key={c.key}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                padding: "10px 0",
                borderBottom: `1px solid ${PAPER_LINE}`,
                opacity: c.include ? 1 : 0.45,
              }}
            >
              <button
                onClick={() => toggleInclude(c.key)}
                aria-label={c.include ? "Remover da importação" : "Incluir na importação"}
                style={{
                  marginTop: 2,
                  width: 22,
                  height: 22,
                  borderRadius: 5,
                  border: `1.4px solid ${c.include ? TEAL : PAPER_LINE}`,
                  background: c.include ? TEAL : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {c.include && <Check size={14} color={CREAM_TEXT} />}
              </button>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>
                    {c.description || "(sem descrição)"}
                    {c.type === "income" && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 9.5,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          color: TEAL,
                          border: `1px solid ${TEAL}`,
                          borderRadius: 4,
                          padding: "1px 5px",
                        }}
                      >
                        Entrada
                      </span>
                    )}
                    {c.type === "investment" && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 9.5,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          color: BRASS,
                          border: `1px solid ${BRASS}`,
                          borderRadius: 4,
                          padding: "1px 5px",
                        }}
                      >
                        Investimento
                      </span>
                    )}
                    {c.source === "cartao" && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 9.5,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          color: MUTED,
                          border: `1px solid ${MUTED}`,
                          borderRadius: 4,
                          padding: "1px 5px",
                        }}
                      >
                        Cartão
                      </span>
                    )}
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 13,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      color: c.type === "income" ? TEAL : c.type === "investment" ? INVESTMENT_TYPE_META[c.investType].color : INK,
                    }}
                  >
                    {c.type === "income" ? "+ " : c.type === "investment" && c.investType === "resgate" ? "+ " : ""}
                    {fmtBRL(c.amount)}
                  </span>
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: MUTED, marginTop: 2 }}>
                  {new Date(c.date + "T00:00:00").toLocaleDateString("pt-BR")} · {weekdayAbbrev(c.date)}
                  {c.accountName ? ` · ${c.accountName}` : ""}
                  {c.confidence && c.confidence !== "nenhuma" ? ` · confiança ${c.confidence}` : ""}
                </div>
                {c.type === "investment" ? (
                  <select
                    value={c.investType}
                    onChange={(e) => setInvestType(c.key, e.target.value)}
                    disabled={!c.include}
                    style={{
                      marginTop: 6,
                      width: "100%",
                      border: `1px solid ${PAPER_LINE}`,
                      borderRadius: 6,
                      padding: "6px 8px",
                      fontSize: 12.5,
                      background: "#F5F1E5",
                      color: INK,
                    }}
                  >
                    {INVESTMENT_TYPE_LIST.map((t) => (
                      <option key={t} value={t}>{INVESTMENT_TYPE_META[t].label}</option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={c.category}
                    onChange={(e) => setCategory(c.key, e.target.value)}
                    disabled={!c.include}
                    style={{
                      marginTop: 6,
                      width: "100%",
                      border: `1px solid ${PAPER_LINE}`,
                      borderRadius: 6,
                      padding: "6px 8px",
                      fontSize: 12.5,
                      background: "#F5F1E5",
                      color: INK,
                    }}
                  >
                    {(c.type === "income" ? INCOME_CATEGORY_LIST : CATEGORY_LIST).map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: "14px 18px max(14px, env(safe-area-inset-bottom))" }}>
          <button
            onClick={() => onConfirm(list)}
            disabled={includedCount === 0}
            style={{
              width: "100%",
              background: includedCount > 0 ? TEAL : PAPER_LINE,
              color: includedCount > 0 ? CREAM_TEXT : MUTED,
              border: "none",
              borderRadius: 8,
              padding: "13px",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {includedCount > 0 ? `Importar ${includedCount} lançamento(s)` : "Nada selecionado"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add expense/income modal — lançamento manual no Realizado           */
/* ------------------------------------------------------------------ */
function AddExpenseModal({ onClose, onAdd }) {
  const [type, setType] = useState("expense");
  const [category, setCategory] = useState(CATEGORY_LIST[0]);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const valid = Number(amount) > 0;
  const categoryList = type === "income" ? INCOME_CATEGORY_LIST : CATEGORY_LIST;

  useEffect(() => {
    setCategory(categoryList[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(22,35,29,0.55)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 430,
          background: PAPER,
          borderRadius: "16px 16px 0 0",
          padding: "18px 18px max(18px, env(safe-area-inset-bottom))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 18 }}>Novo lançamento</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: MUTED }}>
            <X size={20} />
          </button>
        </div>

        <label style={{ ...fieldLabel, marginTop: 0 }}>Tipo</label>
        <div style={{ display: "flex", gap: 8 }}>
          {[{ id: "expense", label: "Despesa" }, { id: "income", label: "Entrada" }].map((opt) => (
            <button
              key={opt.id}
              onClick={() => setType(opt.id)}
              style={{
                flex: 1,
                background: type === opt.id ? INK : "#F5F1E5",
                color: type === opt.id ? CREAM_TEXT : INK,
                border: `1px solid ${type === opt.id ? INK : PAPER_LINE}`,
                borderRadius: 6,
                padding: "8px",
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <label style={fieldLabel}>Categoria</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={fieldInput}>
          {categoryList.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <label style={fieldLabel}>Valor (R$)</label>
        <input
          type="number"
          inputMode="decimal"
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0,00"
          style={{ ...fieldInput, fontFamily: "'IBM Plex Mono', monospace", fontSize: 18 }}
        />

        <label style={fieldLabel}>Data</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={fieldInput}
        />

        <label style={fieldLabel}>Nota (opcional)</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="ex: pix carona quinta"
          style={fieldInput}
        />

        <button
          disabled={!valid}
          onClick={() =>
            onAdd({ type, category, amount: Number(amount), date, note: note.trim(), source: "manual" })
          }
          style={{
            marginTop: 6,
            width: "100%",
            background: valid ? TEAL : PAPER_LINE,
            color: valid ? CREAM_TEXT : MUTED,
            border: "none",
            borderRadius: 8,
            padding: "13px",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Adicionar
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add investment modal — aporte / rendimento / resgate                */
/* ------------------------------------------------------------------ */
function AddInvestmentModal({ onClose, onAdd }) {
  const [type, setType] = useState("aporte");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const valid = Number(amount) > 0;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(22,35,29,0.55)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 430,
          background: PAPER,
          borderRadius: "16px 16px 0 0",
          padding: "18px 18px max(18px, env(safe-area-inset-bottom))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 18 }}>
            Novo lançamento
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: MUTED }}>
            <X size={20} />
          </button>
        </div>

        <label style={{ ...fieldLabel, marginTop: 0 }}>Tipo</label>
        <div style={{ display: "flex", gap: 8 }}>
          {INVESTMENT_TYPE_LIST.map((t) => {
            const meta = INVESTMENT_TYPE_META[t];
            const active = type === t;
            return (
              <button
                key={t}
                onClick={() => setType(t)}
                style={{
                  flex: 1,
                  background: active ? meta.color : "#F5F1E5",
                  color: active ? CREAM_TEXT : INK,
                  border: `1px solid ${active ? meta.color : PAPER_LINE}`,
                  borderRadius: 6,
                  padding: "8px 4px",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {meta.icon} {meta.label}
              </button>
            );
          })}
        </div>

        <label style={fieldLabel}>Valor (R$)</label>
        <input
          type="number"
          inputMode="decimal"
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0,00"
          style={{ ...fieldInput, fontFamily: "'IBM Plex Mono', monospace", fontSize: 18 }}
        />

        <label style={fieldLabel}>Data</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={fieldInput}
        />

        <label style={fieldLabel}>Nota (opcional)</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="ex: aporte Tesouro Selic"
          style={fieldInput}
        />

        <button
          disabled={!valid}
          onClick={() =>
            onAdd({ type, amount: Number(amount), date, note: note.trim() })
          }
          style={{
            marginTop: 6,
            width: "100%",
            background: valid ? INVESTMENT_TYPE_META[type].color : PAPER_LINE,
            color: valid ? CREAM_TEXT : MUTED,
            border: "none",
            borderRadius: 8,
            padding: "13px",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Adicionar
        </button>
      </div>
    </div>
  );
}

const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const fieldLabel = {
  display: "block",
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 10.5,
  letterSpacing: 0.8,
  textTransform: "uppercase",
  color: MUTED,
  marginBottom: 5,
  marginTop: 12,
};

const fieldInput = {
  width: "100%",
  border: `1px solid ${PAPER_LINE}`,
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 14,
  background: "#F5F1E5",
  color: INK,
};
