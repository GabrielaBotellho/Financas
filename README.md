# caderneta-financas

App de controle financeiro pessoal (front-end React + backend serverless),
hospedado inteiro na Vercel. Front e API convivem no mesmo projeto:

```
├── src/            → front-end (Vite + React)
│   ├── App.jsx      → o app inteiro (telas, lógica, tema "caderneta")
│   └── main.jsx
├── api/            → backend serverless (funções da Vercel)
│   ├── connect-token.js
│   └── transactions.js
├── lib/
│   ├── pluggy.js
│   └── categorize.js
├── index.html
├── package.json
└── vite.config.js
```

## O que mudou em relação ao artifact original

- **Persistência**: o artifact do claude.ai usava `window.storage` (uma API
  exclusiva do sandbox do claude.ai). Fora dali isso não existe, então essa
  versão usa `localStorage` do navegador — os dados ficam salvos no seu
  iPhone, no Safari, entre uma visita e outra.
- **Conexão bancária**: a tela de Configurações agora tem um botão
  "Conectar banco", que abre o widget oficial da Pluggy (`Pluggy Connect`)
  pra você logar no Itaú/Nubank.
- **Revisão de importação**: depois de conectar, o app busca as transações
  recentes (`/api/transactions`) e mostra uma tela de revisão — você
  confirma/ajusta a categoria de cada lançamento antes dele entrar de fato
  no histórico. Isso é proposital: a Pluggy não sabe distinguir "dia a dia"
  de "lazer", só você sabe.

## Deploy na Vercel

1. Suba esses arquivos pro mesmo repositório GitHub que você já conectou
   à Vercel (pode substituir os arquivos antigos do backend-only pelos
   novos, mantendo a estrutura de pastas acima).
2. Confirme que as variáveis de ambiente `PLUGGY_CLIENT_ID` e
   `PLUGGY_CLIENT_SECRET` continuam configuradas em Settings → Environment
   Variables.
3. A Vercel detecta automaticamente que é um projeto Vite e roda
   `npm install` + `npm run build` sozinha. Não precisa configurar nada
   manualmente.
4. Depois do deploy, abra a URL de produção (ex:
   `https://financas-eta-blush.vercel.app`) no Safari do iPhone — agora é
   o app completo, não mais o artifact.
5. Adicione à Tela de Início pelo Safari normalmente — como agora é uma
   URL fixa de verdade (não a do claude.ai), o ícone vai abrir direto no
   app, sem cair num chat novo.

## Local (opcional, se quiser testar no computador antes)

```
npm install
npm run dev
```

Isso sobe o front-end, mas as rotas `/api/*` só funcionam de verdade depois
do deploy na Vercel (ou usando `vercel dev`, que tem outra curva de
configuração — não é necessário pra você agora).
