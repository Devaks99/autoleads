require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const app = express();
const serpApiKey = process.env.SERP_API_KEY;

console.log("DEBUG .env:", __dirname);
console.log("Conteúdo da variável:", process.env.SERP_API_KEY);

app.use(express.static("public"));
app.use(express.json());

// 🔧 Garante que a pasta "output" exista
const outputDir = path.join(__dirname, "output");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// 🔍 Endpoint principal para buscar leads
app.post("/buscar", async (req, res) => {
  const { empresa } = req.body;

  if (!empresa) {
    return res.status(400).json({ success: false, error: "Nome da empresa é obrigatório." });
  }

  try {
    console.log(`🚀 Buscando leads da empresa: ${empresa}`);

    const serpUrl = `https://serpapi.com/search.json?q=site:linkedin.com/in+${encodeURIComponent(
      empresa
    )}+AND+"Protheus"&api_key=${serpApiKey}`;

    const { data } = await axios.get(serpUrl);

    const results = data.organic_results || [];
    console.log(`📄 ${results.length} resultados brutos recebidos da SERP API`);

    const leads = results
      .filter((r) => r.link && r.link.includes("linkedin.com/in"))
      .map((r) => ({
        nome: r.title || "Sem nome",
        link: r.link,
      }));

    if (leads.length === 0) {
      console.log("⚠️ Nenhum lead encontrado na pesquisa.");
      return res.json({ success: true, leads: [] });
    }

    // 📝 Salvar CSV
    const csvData = leads.map((l) => `${l.nome};${l.link}`).join("\n");
    const outputPath = path.join(outputDir, "leads.csv");
    fs.writeFileSync(outputPath, csvData, "utf8");
    console.log(`✅ Leads salvos em: ${outputPath}`);

    res.json({ success: true, leads });
  } catch (err) {
    console.error("❌ Erro ao buscar leads:", err.message);

    // 🧪 Resposta fake pra testar o front mesmo sem API válida
    res.json({
      success: true,
      leads: [
        { nome: "Teste Lead 1", link: "https://linkedin.com/in/teste1" },
        { nome: "Teste Lead 2", link: "https://linkedin.com/in/teste2" },
      ],
    });
  }
});

const PORT = 3000;
app.listen(PORT, () =>
  console.log(`💻 Servidor rodando em: http://localhost:${PORT}`)
);
