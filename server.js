require("dotenv").config();
const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;

// Middlewares
app.use(express.json());
// Serve arquivos estáticos (index.html, script.js) da pasta raiz do projeto
app.use(express.static('public'))

// Rota para a página principal (necessária para o Express servir o index.html)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Rota da API para buscar leads
app.post("/api/buscar", async (req, res) => {
  const { empresa, cargo } = req.body;

  if (!GOOGLE_API_KEY || !GOOGLE_CX) {
    console.error("ERRO GRAVE: Chaves da API do Google não configuradas no ambiente.");
    return res.status(500).json({ success: false, error: "Erro de configuração no servidor." });
  }

  if (!empresa) {
    return res.status(400).json({ success: false, error: "O nome da empresa é obrigatório." });
  }

  try {
    const searchQuery = `site:linkedin.com/in "${empresa}" ${cargo ? `"${cargo}"` : ""}`;
    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(searchQuery )}`;
    
    const { data } = await axios.get(searchUrl);
    const results = data.items || [];

    const leads = results
      .filter(r => r.link && r.link.includes("linkedin.com/in/"))
      .map(r => ({
        nome: r.title.split(" - ")[0].trim(),
        link: r.link,
      }));

    return res.status(200).json({ success: true, leads });

  } catch (error) {
    console.error("!!!!!!!!!! ERRO NA EXECUÇÃO DA BUSCA !!!!!!!!!!");
    if (error.response) {
      console.error("DADOS DO ERRO (AXIOS):", JSON.stringify(error.response.data, null, 2));
      const apiErrorMessage = error.response.data?.error?.message || "Erro na API externa.";
      return res.status(500).json({ success: false, error: `Falha na API do Google: ${apiErrorMessage}` });
    } else {
      console.error("ERRO GERAL (NÃO-AXIOS):", error.message);
      return res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor." });
    }
  }
});

// Se não estiver na Vercel, inicia o servidor localmente
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🔥 Servidor rodando em http://localhost:${PORT}`);
  });
}

// Exporta o app para a Vercel
module.exports = app;
