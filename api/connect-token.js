// api/connect-token.js
// GET /api/connect-token
// Gera um Connect Token de curta duração (30 min) para o front-end
// abrir o widget "Pluggy Connect" e conectar Itaú/Nubank.
//
// As credenciais reais (CLIENT_ID/SECRET) nunca saem do servidor.

const { createConnectToken } = require("../lib/pluggy");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Método não permitido" });
    return;
  }

  try {
    const itemId = req.query?.itemId || undefined;
    const accessToken = await createConnectToken({ itemId });
    res.status(200).json({ accessToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
