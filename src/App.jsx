import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Plus,
  X,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Home as HomeIcon,
  ListTree,
  Settings as SettingsIcon,
  Wallet,
  Sun,
  PartyPopper,
  Landmark,
  RefreshCw,
  Check,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Design tokens — "caderneta" (bank passbook) theme                   */
/* ------------------------------------------------------------------ */
const INK = "#16231D";
const INK_SOFT = "#22332B";
const PAPER = "#EDE7D8";
const PAPER_LINE = "#DCD2B7";
const PAPER_DIM = "#E3DBC7";
const BRASS = "#B8863E";
const TEAL = "#3F6B58";
const CORAL = "#C1503D";
const MUTED = "#7A705F";
const CREAM_TEXT = "#EFE9DA";

const BASE_CATEGORY_META = {
  "Assinaturas": { group: "fixo", tag: null, icon: "♫" },
  "Transporte - Carona": { group: "fixo", tag: null, icon: "→" },
  "Transporte - Ônibus": { group: "fixo", tag: null, icon: "▭" },
  "Academia": { group: "fixo", tag: null, icon: "↑" },
  "Roupa": { group: "variavel", tag: null, icon: "◇" },
  "Comida Dia a Dia": { group: "variavel", tag: "diaadia", icon: "○" },
  "Comida Lazer": { group: "variavel", tag: "lazer", icon: "○" },
  "Ifood - Dia a Dia": { group: "variavel", tag: "diaadia", icon: "◎" },
  "Ifood - Lazer": { group: "variavel", tag: "lazer", icon: "◎" },
  "Compras": { group: "variavel", tag: null, icon: "□" },
  "Uber - Dia a Dia": { group: "variavel", tag: "diaadia", icon: "△" },
  "Uber - Lazer": { group: "variavel", tag: "lazer", icon: "△" },
  "Cartão de Crédito Nubank": { group: "variavel", tag: null, icon: "▪" },
  "Investimentos": { group: "variavel", tag: null, icon: "↗" },
  "Farmácia": { group: "variavel", tag: null, icon: "✚" },
  "Médico": { group: "variavel", tag: null, icon: "♥" },
};

// CATEGORY_META e CATEGORY_LIST começam só com as categorias fixas do app,
// mas são recalculadas (rebuildCategories) sempre que o usuário adiciona ou
// remove uma categoria personalizada nas Configurações — por isso são `let`,
// não `const`.
let CATEGORY_META = { ...BASE_CATEGORY_META };
let CATEGORY_LIST = Object.keys(CATEGORY_META);

// Categorias de entrada (dinheiro chegando) — separadas das categorias de
// despesa, já que não têm orçamento nem entram no comparativo dia a dia/lazer.
const BASE_INCOME_META = {
  "Salário": { icon: "$" },
  "Reembolso": { icon: "↺" },
  "Pix Recebido": { icon: "↓" },
  "Outras Entradas": { icon: "+" },
};
let INCOME_META = { ...BASE_INCOME_META };
let INCOME_CATEGORY_LIST = Object.keys(INCOME_META);

/**
 * Recalcula CATEGORY_META/CATEGORY_LIST e INCOME_META/INCOME_CATEGORY_LIST
 * juntando as categorias fixas do app com as personalizadas cadastradas
 * pelo usuário (customCategories). Cada categoria personalizada tem um
 * `kind`: "expense" (entra em CATEGORY_META, grupo "variavel", com ou sem
 * a tag "diaadia" conforme o checkbox) ou "income" (entra em INCOME_META,
 * sem orçamento nem grupo).
 */
function rebuildCategories(customCategories) {
  const mergedExpense = { ...BASE_CATEGORY_META };
  const mergedIncome = { ...BASE_INCOME_META };
  customCategories.forEach((c) => {
    if (c.kind === "income") {
      mergedIncome[c.name] = { icon: "+" };
    } else {
      mergedExpense[c.name] = { group: "variavel", tag: c.diaDia ? "diaadia" : null, icon: "•" };
    }
  });
  CATEGORY_META = mergedExpense;
  CATEGORY_LIST = Object.keys(mergedExpense);
  INCOME_META = mergedIncome;
  INCOME_CATEGORY_LIST = Object.keys(mergedIncome);
}

const DEFAULT_BUDGETS = {
  "Assinaturas": 12,
  "Transporte - Carona": 84,
  "Transporte - Ônibus": 150,
  "Academia": 15,
  "Roupa": 0,
  "Comida Dia a Dia": 0,
  "Comida Lazer": 0,
  "Ifood - Dia a Dia": 0,
  "Ifood - Lazer": 0,
  "Compras": 0,
  "Uber - Dia a Dia": 0,
  "Uber - Lazer": 0,
  "Cartão de Crédito Nubank": 0,
  "Investimentos": 0,
  "Farmácia": 0,
  "Médico": 0,
};

const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const PLUGGY_CONNECT_SCRIPT_URL =
  "https://cdn.pluggy.ai/pluggy-connect/v2.8.2/pluggy-connect.js";

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

/* ------------------------------------------------------------------ */
/* Local persistence (localStorage — este app roda fora do sandbox     */
/* do claude.ai, então usa o storage normal do navegador)              */
/* ------------------------------------------------------------------ */
const LS_KEYS = {
  expenses: "caderneta:expenses",
  config: "caderneta:config",
  bankItemId: "caderneta:bankItemId",
  pending: "caderneta:pending",
  customCategories: "caderneta:customCategories",
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

function StampRing({ percent, color, size = 60 }) {
  const p = Math.min(percent, 100);
  const r = (size - 18) / 2;
  const c = 2 * Math.PI * r;
  const dash = (p / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={size / 2 - 2}
        fill="none"
        stroke={PAPER_LINE}
        strokeWidth="1.6"
        strokeDasharray="1.4 3.6"
      />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(22,35,29,0.09)" strokeWidth="6" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeDasharray={`${dash} ${c}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 0.4s ease" }}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dy="0.32em"
        fontFamily="'IBM Plex Mono', monospace"
        fontSize={size * 0.21}
        fill={INK}
        fontWeight="600"
      >
        {Math.round(p)}%
      </text>
    </svg>
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

  const [expenses, setExpenses] = useState(() => lsGet(LS_KEYS.expenses) || []);
  const [budgets, setBudgets] = useState(() => ({
    ...DEFAULT_BUDGETS,
    ...((lsGet(LS_KEYS.config) || {}).budgets || {}),
  }));
  const [income, setIncome] = useState(() => (lsGet(LS_KEYS.config) || {}).income || 0);
  const [bankItemId, setBankItemId] = useState(() => lsGet(LS_KEYS.bankItemId) || null);
  const [pendingItems, setPendingItems] = useState(() => lsGet(LS_KEYS.pending) || []);

  const [tab, setTab] = useState("home"); // home | history | settings
  const [showAdd, setShowAdd] = useState(false);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [viewMode, setViewMode] = useState("mes");
  const [error, setError] = useState("");

  const [bankStatus, setBankStatus] = useState("idle"); // idle | connecting | importing | reviewing
  const [importCandidates, setImportCandidates] = useState([]);

  const saveExpenses = useCallback((next) => {
    setExpenses(next);
    if (!lsSet(LS_KEYS.expenses, next)) {
      setError("Não consegui salvar. Tente novamente.");
    }
  }, []);

  const saveConfig = useCallback((nextBudgets, nextIncome) => {
    setBudgets(nextBudgets);
    setIncome(nextIncome);
    if (!lsSet(LS_KEYS.config, { budgets: nextBudgets, income: nextIncome })) {
      setError("Não consegui salvar as configurações.");
    }
  }, []);

  const addCustomCategory = (name, kind, diaDia) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const exists = [...CATEGORY_LIST, ...INCOME_CATEGORY_LIST].some(
      (c) => c.toLowerCase() === trimmed.toLowerCase()
    );
    if (exists) {
      setError("Essa categoria já existe.");
      return;
    }
    const next = [
      ...customCategories,
      { name: trimmed, kind: kind === "income" ? "income" : "expense", diaDia: !!diaDia },
    ];
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

  /* -------------------- conexão bancária (Pluggy) -------------------- */
  // Usada só na primeira conexão. Itens do Meu Pluggy sincronizam sozinhos
  // uma vez por dia, então NUNCA reabrimos esse widget em modo "update" —
  // isso não é suportado para esse tipo de conector (veja handleBankAction).
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
            setBankItemId(newItemId);
            lsSet(LS_KEYS.bankItemId, newItemId);
            importTransactions(newItemId);
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
  }, [bankItemId]);

  const importTransactions = useCallback(async (itemId) => {
    setBankStatus("importing");
    setError("");
    try {
      const from = daysAgoISO(90);
      const to = todayISO();
      const res = await fetch(
        `/api/transactions?itemId=${encodeURIComponent(itemId)}&from=${from}&to=${to}`
      );
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) detail = body.error;
        } catch (_) {
          // resposta não era JSON, mantém o status HTTP como detalhe
        }
        throw new Error(`Não consegui buscar as transações do banco (${detail})`);
      }
      const { transactions } = await res.json();

      // Evita sugerir de novo transações que já foram importadas antes
      // (heurística simples: mesma data + mesmo valor + mesma descrição)
      const existingKeys = new Set(
        expenses.map((e) => `${e.date}|${e.amount}|${e.note || ""}`)
      );
      const alreadyPendingKeys = new Set(pendingItems.map((p) => p.key));

      const fresh = transactions
        .filter((t) => !existingKeys.has(`${t.date?.slice(0, 10)}|${t.amount}|${t.description || ""}`))
        .filter((t) => !alreadyPendingKeys.has(t.id))
        .map((t) => ({
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
          // entradas sempre exigem revisão manual (sem sugestão automática),
          // então começam desmarcadas por padrão
          include: t.isExpense ? !!t.suggestedCategory : false,
        }));

      // Junta com o que já estava pendente de revisões anteriores — nada
      // se perde se você fechar o app sem revisar tudo de uma vez.
      const merged = [...pendingItems, ...fresh];
      savePending(merged);
      setImportCandidates(merged);
      setBankStatus("reviewing");
    } catch (e) {
      console.error(e);
      setError(e.message || "Não consegui importar as transações.");
      setBankStatus("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, pendingItems, savePending]);

  const confirmImport = (finalList) => {
    const toAdd = finalList
      .filter((c) => c.include)
      .map((c) => ({
        type: c.type || "expense",
        category: c.category,
        amount: Math.abs(Number(c.amount)),
        date: c.date,
        note: c.description || "",
      }));
    addManyExpenses(toAdd);

    // Tudo que passou por essa revisão sai da lista de pendentes — seja
    // porque virou gasto de verdade, seja porque você desmarcou de propósito.
    const reviewedKeys = new Set(finalList.map((c) => c.key));
    savePending(pendingItems.filter((p) => !reviewedKeys.has(p.key)));

    setImportCandidates([]);
    setBankStatus("idle");
  };

  const cancelImport = () => {
    // Cancelar só fecha a tela — os itens continuam pendentes pra depois.
    setImportCandidates([]);
    setBankStatus("idle");
  };

  // Abre a revisão direto com o que já está pendente, sem precisar buscar
  // de novo no banco.
  const reviewPending = useCallback(() => {
    setImportCandidates(pendingItems);
    setBankStatus("reviewing");
  }, [pendingItems]);

  // Itens do Meu Pluggy sincronizam sozinhos uma vez por dia — não faz
  // sentido reabrir o widget de conexão pra "atualizar". Se já tem banco
  // conectado, o botão só busca as transações mais recentes direto na API.
  const handleBankAction = useCallback(() => {
    if (bankItemId) {
      importTransactions(bankItemId);
    } else {
      connectBank();
    }
  }, [bankItemId, importTransactions, connectBank]);

  /* -------------------- derived data -------------------- */
  // `inPeriod` traz TUDO (despesas e entradas) — usado no Histórico.
  const inPeriod = useMemo(() => {
    return expenses.filter((e) => {
      const d = new Date(e.date + "T00:00:00");
      if (viewMode === "ano") return d.getFullYear() === cursor.y;
      return d.getFullYear() === cursor.y && d.getMonth() === cursor.m;
    });
  }, [expenses, cursor, viewMode]);

  // Registros antigos não tinham campo `type` — tratamos como despesa.
  const isIncomeRecord = (e) => e.type === "income";
  const expensesInPeriod = useMemo(
    () => inPeriod.filter((e) => !isIncomeRecord(e)),
    [inPeriod]
  );
  const incomeInPeriod = useMemo(
    () => inPeriod.filter((e) => isIncomeRecord(e)),
    [inPeriod]
  );
  const totalIncomeReal = incomeInPeriod.reduce((s, e) => s + e.amount, 0);

  const pendingInPeriod = useMemo(() => {
    return pendingItems.filter((p) => {
      const d = new Date(p.date + "T00:00:00");
      if (viewMode === "ano") return d.getFullYear() === cursor.y;
      return d.getFullYear() === cursor.y && d.getMonth() === cursor.m;
    });
  }, [pendingItems, cursor, viewMode]);
  const pendingTotal = pendingInPeriod.reduce((s, p) => s + Math.abs(p.amount), 0);

  const totalSpent = expensesInPeriod.reduce((s, e) => s + e.amount, 0);
  const periodMultiplier = viewMode === "ano" ? 12 : 1;

  const byCategory = useMemo(() => {
    const map = {};
    CATEGORY_LIST.forEach((c) => (map[c] = 0));
    expensesInPeriod.forEach((e) => {
      map[e.category] = (map[e.category] || 0) + e.amount;
    });
    return map;
  }, [expensesInPeriod]);

  const fixedCommitted = CATEGORY_LIST.filter((c) => CATEGORY_META[c].group === "fixo").reduce(
    (s, c) => s + (budgets[c] || 0) * periodMultiplier,
    0
  );
  const fixedSpent = CATEGORY_LIST.filter((c) => CATEGORY_META[c].group === "fixo").reduce(
    (s, c) => s + byCategory[c],
    0
  );

  const diaadia = CATEGORY_LIST.filter((c) => CATEGORY_META[c].tag === "diaadia").reduce(
    (s, c) => s + byCategory[c],
    0
  );
  const lazer = CATEGORY_LIST.filter((c) => CATEGORY_META[c].tag === "lazer").reduce(
    (s, c) => s + byCategory[c],
    0
  );

  const incomePeriod = income * periodMultiplier;
  // "Sobra/falta" agora considera tanto a renda mensal configurada quanto as
  // entradas reais importadas do banco no período.
  const remaining = incomePeriod + totalIncomeReal - totalSpent;

  const periodLabel =
    viewMode === "ano" ? `${cursor.y}` : `${MONTHS_PT[cursor.m]} ${cursor.y}`;

  const shiftPeriod = (dir) => {
    setCursor((c) => {
      if (viewMode === "ano") return { ...c, y: c.y + dir };
      let m = c.m + dir;
      let y = c.y;
      if (m < 0) {
        m = 11;
        y -= 1;
      } else if (m > 11) {
        m = 0;
        y += 1;
      }
      return { y, m };
    });
  };

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
        <div style={{ background: INK, color: CREAM_TEXT, padding: "28px 20px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Wallet size={16} color={BRASS} />
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1.5, color: BRASS, textTransform: "uppercase" }}>
                Caderneta
              </span>
            </div>
            <div style={{ display: "flex", gap: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
              {["mes", "ano"].map((v) => (
                <button
                  key={v}
                  onClick={() => setViewMode(v)}
                  style={{
                    background: viewMode === v ? BRASS : "transparent",
                    color: viewMode === v ? INK : CREAM_TEXT,
                    border: `1px solid ${BRASS}`,
                    borderRadius: 3,
                    padding: "3px 9px",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  {v === "mes" ? "Mês" : "Ano"}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 22 }}>
            <button onClick={() => shiftPeriod(-1)} aria-label="Período anterior" style={{ background: "none", border: "none", color: CREAM_TEXT, opacity: 0.7 }}>
              <ChevronLeft size={20} />
            </button>
            <span style={{ fontFamily: "'Fraunces', serif", fontWeight: 500, fontSize: 15, letterSpacing: 0.5 }}>
              {periodLabel}
            </span>
            <button onClick={() => shiftPeriod(1)} aria-label="Próximo período" style={{ background: "none", border: "none", color: CREAM_TEXT, opacity: 0.7 }}>
              <ChevronRight size={20} />
            </button>
          </div>

          <div style={{ textAlign: "center", marginTop: 10, marginBottom: 22 }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "rgba(239,233,218,0.55)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>
              Total gasto
            </div>
            <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 680, fontSize: 44, lineHeight: 1 }}>
              {fmtBRL(totalSpent)}
            </div>
            {totalIncomeReal > 0 && (
              <div
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 12,
                  marginTop: 6,
                  color: "#9ED0B4",
                }}
              >
                + {fmtBRL(totalIncomeReal)} em entradas
              </div>
            )}
            {(income > 0 || totalIncomeReal > 0) && (
              <div
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 12,
                  marginTop: 8,
                  color: remaining >= 0 ? "#9ED0B4" : "#E3A093",
                }}
              >
                {remaining >= 0 ? "sobram " : "faltam "}
                {fmtBRL(Math.abs(remaining))}
              </div>
            )}
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

          {tab === "home" && (
            <HomeView
              byCategory={byCategory}
              budgets={budgets}
              periodMultiplier={periodMultiplier}
              fixedSpent={fixedSpent}
              fixedCommitted={fixedCommitted}
              diaadia={diaadia}
              lazer={lazer}
              pendingTotal={pendingTotal}
              pendingCount={pendingInPeriod.length}
              onReviewPending={reviewPending}
            />
          )}

          {tab === "history" && (
            <HistoryView expenses={inPeriod} onDelete={deleteExpense} />
          )}

          {tab === "settings" && (
            <SettingsView
              budgets={budgets}
              income={income}
              onSave={saveConfig}
              bankItemId={bankItemId}
              bankStatus={bankStatus}
              onConnectBank={handleBankAction}
              customCategories={customCategories}
              onAddCategory={addCustomCategory}
              onRemoveCategory={removeCustomCategory}
            />
          )}
        </div>

        {/* ---------------- FAB ---------------- */}
        <button
          onClick={() => setShowAdd(true)}
          aria-label="Adicionar gasto"
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
            { id: "home", label: "Início", Icon: HomeIcon },
            { id: "history", label: "Histórico", Icon: ListTree },
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

        {showAdd && (
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

/* ------------------------------------------------------------------ */
/* Home view                                                           */
/* ------------------------------------------------------------------ */
function HomeView({ byCategory, budgets, periodMultiplier, fixedSpent, fixedCommitted, diaadia, lazer, pendingTotal, pendingCount, onReviewPending }) {
  const fixed = CATEGORY_LIST.filter((c) => CATEGORY_META[c].group === "fixo");
  const variable = CATEGORY_LIST.filter((c) => CATEGORY_META[c].group === "variavel");

  return (
    <div>
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
              {pendingCount} lançamento{pendingCount > 1 ? "s" : ""} do banco neste período · toque para revisar
            </div>
          </div>
          <ChevronRight size={18} color={BRASS} />
        </button>
      )}

      <SectionLabel>Dia a dia × Lazer</SectionLabel>
      <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
        <SplitCard icon={<Sun size={16} color={TEAL} />} label="Dia a dia" value={diaadia} color={TEAL} />
        <SplitCard icon={<PartyPopper size={16} color={CORAL} />} label="Lazer" value={lazer} color={CORAL} />
      </div>

      <SectionLabel>Custos fixos · {fmtBRL(fixedSpent)} de {fmtBRL(fixedCommitted)}</SectionLabel>
      <Card>
        {fixed.map((c, i) => (
          <CategoryRow
            key={c}
            name={c}
            spent={byCategory[c]}
            budget={(budgets[c] || 0) * periodMultiplier}
            color={BRASS}
            last={i === fixed.length - 1}
          />
        ))}
      </Card>

      <SectionLabel style={{ marginTop: 22 }}>Custos variáveis</SectionLabel>
      <Card>
        {variable.map((c, i) => (
          <CategoryRow
            key={c}
            name={c}
            spent={byCategory[c]}
            budget={(budgets[c] || 0) * periodMultiplier}
            color={TEAL}
            last={i === variable.length - 1}
          />
        ))}
      </Card>
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

function SplitCard({ icon, label, value, color }) {
  return (
    <div
      style={{
        flex: 1,
        background: "#F5F1E5",
        border: `1px solid ${PAPER_LINE}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 8,
        padding: "12px 14px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        {icon}
        <span style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {label}
        </span>
      </div>
      <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 20 }}>{fmtBRL(value)}</div>
    </div>
  );
}

function CategoryRow({ name, spent, budget, color, last }) {
  const hasBudget = budget > 0;
  const percent = hasBudget ? (spent / budget) * 100 : 0;
  const over = hasBudget && spent > budget;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderBottom: last ? "none" : `1px solid ${PAPER_LINE}`,
      }}
    >
      {hasBudget ? (
        <StampRing percent={percent} color={over ? CORAL : color} size={46} />
      ) : (
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: "50%",
            border: `1.4px dashed ${PAPER_LINE}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 16,
            color: MUTED,
            flexShrink: 0,
          }}
        >
          {CATEGORY_META[name].icon}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{name}</div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: over ? CORAL : MUTED, marginTop: 2 }}>
          {fmtBRL(spent)}{hasBudget ? ` / ${fmtBRL(budget)}` : ""}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* History view                                                        */
/* ------------------------------------------------------------------ */
function HistoryView({ expenses, onDelete }) {
  const sorted = [...expenses].sort((a, b) => (a.date < b.date ? 1 : -1));
  if (sorted.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 10px", color: MUTED, fontSize: 13 }}>
        Nenhum gasto lançado neste período ainda.
        <br />
        Toque no + para registrar o primeiro, ou conecte seu banco em Config.
      </div>
    );
  }
  return (
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
          }}
        >
          <div style={{ fontSize: 16, width: 22, textAlign: "center", color: MUTED }}>
            {e.type === "income" ? INCOME_META[e.category]?.icon || "+" : CATEGORY_META[e.category]?.icon || "•"}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500 }}>{e.category}</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: MUTED, marginTop: 2 }}>
              {new Date(e.date + "T00:00:00").toLocaleDateString("pt-BR")}
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
  );
}

/* ------------------------------------------------------------------ */
/* Settings view                                                       */
/* ------------------------------------------------------------------ */
function SettingsView({
  budgets,
  income,
  onSave,
  bankItemId,
  bankStatus,
  onConnectBank,
  customCategories,
  onAddCategory,
  onRemoveCategory,
}) {
  const [localBudgets, setLocalBudgets] = useState(budgets);
  const [localIncome, setLocalIncome] = useState(income || "");
  const [saved, setSaved] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatKind, setNewCatKind] = useState("expense"); // "expense" | "income"
  const [newCatDiaDia, setNewCatDiaDia] = useState(false);

  // Quando uma categoria personalizada é adicionada/removida, CATEGORY_LIST
  // muda — garante que o formulário de orçamento tenha uma linha (com 0)
  // pra qualquer categoria nova, sem perder o que já foi digitado.
  useEffect(() => {
    setLocalBudgets((lb) => {
      let changed = false;
      const merged = { ...lb };
      CATEGORY_LIST.forEach((c) => {
        if (!(c in merged)) {
          merged[c] = 0;
          changed = true;
        }
      });
      return changed ? merged : lb;
    });
  }, [customCategories]);

  const handleSave = () => {
    const cleaned = {};
    Object.keys(localBudgets).forEach((k) => {
      cleaned[k] = Number(localBudgets[k]) || 0;
    });
    onSave(cleaned, Number(localIncome) || 0);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const handleAddCategory = () => {
    if (!newCatName.trim()) return;
    onAddCategory(newCatName, newCatKind, newCatDiaDia);
    setNewCatName("");
    setNewCatKind("expense");
    setNewCatDiaDia(false);
  };

  const busy = bankStatus === "connecting" || bankStatus === "importing";

  return (
    <div>
      <SectionLabel>Conexão bancária</SectionLabel>
      <Card>
        <div style={{ padding: "14px" }}>
          <div style={{ fontSize: 13, marginBottom: 10, color: INK }}>
            {bankItemId
              ? "Banco conectado. Você pode atualizar os lançamentos quando quiser."
              : "Conecte o Itaú ou o Nubank pra importar os gastos automaticamente, via Pluggy."}
          </div>
          <button
            onClick={onConnectBank}
            disabled={busy}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: bankItemId ? "#F5F1E5" : TEAL,
              color: bankItemId ? INK : CREAM_TEXT,
              border: bankItemId ? `1px solid ${PAPER_LINE}` : "none",
              borderRadius: 8,
              padding: "12px",
              fontSize: 13.5,
              fontWeight: 600,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {bankItemId ? <RefreshCw size={16} /> : <Landmark size={16} />}
            {bankStatus === "connecting"
              ? "Abrindo conexão…"
              : bankStatus === "importing"
              ? "Buscando lançamentos…"
              : bankItemId
              ? "Buscar novos lançamentos"
              : "Conectar banco"}
          </button>
        </div>
      </Card>

      <SectionLabel style={{ marginTop: 22 }}>Renda mensal (opcional)</SectionLabel>
      <Card>
        <div style={{ padding: "12px 14px" }}>
          <input
            type="number"
            inputMode="decimal"
            value={localIncome}
            onChange={(e) => setLocalIncome(e.target.value)}
            placeholder="0,00"
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
            Usada para mostrar quanto sobra no mês/ano.
          </div>
        </div>
      </Card>

      <SectionLabel style={{ marginTop: 22 }}>Orçamento por categoria (mensal)</SectionLabel>
      <Card>
        {CATEGORY_LIST.map((c, i) => (
          <div
            key={c}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "10px 14px",
              borderBottom: i === CATEGORY_LIST.length - 1 ? "none" : `1px solid ${PAPER_LINE}`,
            }}
          >
            <span style={{ fontSize: 13, flex: 1 }}>{c}</span>
            <input
              type="number"
              inputMode="decimal"
              value={localBudgets[c]}
              onChange={(e) =>
                setLocalBudgets((b) => ({ ...b, [c]: e.target.value }))
              }
              style={{
                width: 90,
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

          {newCatKind === "expense" && (
            <>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 12,
                  fontSize: 13,
                  color: INK,
                }}
              >
                <input
                  type="checkbox"
                  checked={newCatDiaDia}
                  onChange={(e) => setNewCatDiaDia(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: TEAL }}
                />
                Dia a Dia
              </label>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 4, marginLeft: 24 }}>
                Marque se esses gastos devem contar no comparativo "Dia a dia" da
                tela inicial. Deixe desmarcado pra uma categoria neutra (não entra
                nem em Dia a dia, nem em Lazer).
              </div>
            </>
          )}
          {newCatKind === "income" && (
            <div style={{ fontSize: 11, color: MUTED, marginTop: 10 }}>
              Categorias de entrada não têm orçamento nem entram no comparativo
              Dia a dia/Lazer — só ajudam a identificar de onde veio o dinheiro.
            </div>
          )}

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
                    {c.kind === "income"
                      ? "Entrada"
                      : c.diaDia
                      ? "Despesa · conta em Dia a dia"
                      : "Despesa · categoria neutra"}
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Import review modal — transações vindas do banco, aguardando        */
/* confirmação de categoria antes de entrarem no histórico             */
/* ------------------------------------------------------------------ */
function ImportReviewModal({ candidates, onCancel, onConfirm }) {
  const [list, setList] = useState(candidates);

  const toggleInclude = (key) => {
    setList((l) => l.map((c) => (c.key === key ? { ...c, include: !c.include } : c)));
  };
  const setCategory = (key, category) => {
    setList((l) => l.map((c) => (c.key === key ? { ...c, category } : c)));
  };

  const includedCount = list.filter((c) => c.include).length;

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
            : "Confira a categoria de cada lançamento — despesas já vêm com sugestão quando possível; entradas (salário, PIX recebido, etc.) você categoriza na mão. Desmarque o que não quiser importar."}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 18px" }}>
          {list.map((c) => (
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
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 13,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      color: c.type === "income" ? TEAL : INK,
                    }}
                  >
                    {c.type === "income" ? "+ " : ""}
                    {fmtBRL(c.amount)}
                  </span>
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: MUTED, marginTop: 2 }}>
                  {new Date(c.date + "T00:00:00").toLocaleDateString("pt-BR")}
                  {c.accountName ? ` · ${c.accountName}` : ""}
                  {c.confidence && c.confidence !== "nenhuma" ? ` · confiança ${c.confidence}` : ""}
                </div>
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
/* Add expense modal                                                   */
/* ------------------------------------------------------------------ */
function AddExpenseModal({ onClose, onAdd }) {
  const [category, setCategory] = useState(CATEGORY_LIST[0]);
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
          <span style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 18 }}>Novo gasto</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: MUTED }}>
            <X size={20} />
          </button>
        </div>

        <label style={fieldLabel}>Categoria</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={fieldInput}
        >
          <optgroup label="Custos fixos">
            {CATEGORY_LIST.filter((c) => CATEGORY_META[c].group === "fixo").map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </optgroup>
          <optgroup label="Custos variáveis">
            {CATEGORY_LIST.filter((c) => CATEGORY_META[c].group === "variavel").map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </optgroup>
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
            onAdd({ type: "expense", category, amount: Number(amount), date, note: note.trim() })
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
