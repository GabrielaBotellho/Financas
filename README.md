# financas-backend

Backend serverless (pensado pra Vercel) que conecta o app **Caderneta**
(financas.jsx) à [Pluggy](https://pluggy.ai) para puxar automaticamente
transações do Itaú e do Nubank via Open Finance.

## Rotas

### `GET /api/connect-token`
Gera um Connect Token de curta duração (30 min) para o front-end abrir o
widget **Pluggy Connect** e o usuário logar no banco.

Resposta:
```json
{ "accessToken": "..." }
```

Aceita opcionalmente `?itemId=...` quando for reconectar/atualizar um item
já existente (ex: quando a senha do banco muda e a conexão expira).

### `GET /api/transactions?itemId=...&from=YYYY-MM-DD&to=YYYY-MM-DD`
Busca todas as contas do item conectado e retorna as transações de despesa
do período, já com uma **sugestão** de categoria (`suggestedCategory`) e um
nível de confiança (`confidence`: alta / media / baixa / nenhuma).

A distinção **dia a dia × lazer** é subjetiva, então sempre que a regra
depender dela, a confiança vem como `"baixa"` — a ideia é você confirmar ou
corrigir a categoria no app antes de salvar, não confiar 100% na sugestão.

## Deploy na Vercel

1. Crie um repositório Git com esses arquivos (ou peça pra eu gerar via
   Claude Code) e importe na Vercel (vercel.com → New Project).
2. Em **Settings → Environment Variables**, adicione:
   - `PLUGGY_CLIENT_ID`
   - `PLUGGY_CLIENT_SECRET`
3. Deploy. As rotas ficam disponíveis em
   `https://<seu-projeto>.vercel.app/api/connect-token` e
   `.../api/transactions`.

## Próximo passo

Integrar essas duas rotas no `financas.jsx`: um botão "Conectar banco" que
chama `/api/connect-token`, abre o widget da Pluggy, e depois de conectado
chama `/api/transactions` para trazer os gastos — deixando você revisar e
confirmar as categorias antes de entrarem no histórico.
