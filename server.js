// server.js (versão final com enriquecimento e tratamento de erros robusto)

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const EmailVerifier = require('email-verifier');

const app = express();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;

// Inicializa o verificador de e-mail
// Nota: A verificação avançada pode precisar de uma API key (ex: Hunter.io), mas o básico funciona sem.
const emailVerifier = new EmailVerifier(process.env.HUNTER_API_KEY);

// Middlewares para servir arquivos estáticos e processar JSON
app.use(express.static("public"));
app.use(express.json());

// --- FUNÇÕES DE ENRIQUECIMENTO (sem alterações) ---

async function getCompanyDomain(companyName) {
  // Evita busca desnecessária se as chaves não existirem
  if (!GOOGLE_API_KEY || !GOOGLE_CX) return null;
  
  const query = `site oficial ${companyName}`;
  const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query )}`;
  try {
    const { data } = await axios.get(url);
    if (data.items && data.items.length > 0) {
      const firstResultUrl = new URL(data.items[0].link);
      return firstResultUrl.hostname.replace(/^www\./, '');
    }
    return null;
  } catch (error) {
    console.error(`Erro ao buscar domínio para ${companyName}:`, error.message);
    return null;
  }
}

function generateEmailPermutations(fullName, domain) {
    if (!fullName || !domain) return [];
    const nameParts = fullName.toLowerCase().split(' ').filter(p => p.length > 1 && /^[a-zÀ-ÿ]+$/.test(p));
    if (nameParts.length === 0) return [];
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
    const permutations = new Set();
    permutations.add(`${firstName}@${domain}`);
    if (lastName) {
        permutations.add(`${firstName}.${lastName}@${domain}`);
        permutations.add(`${firstName}${lastName}@${domain}`);
        permutations.add(`${firstName.charAt(0)}${lastName}@${domain}`);
        permutations.add(`${firstName}_${lastName}@${domain}`);
        permutations.add(`${lastName}.${firstName}@${domain}`);
    }
    return Array.from(permutations);
}

// --- ROTA PRINCIPAL COM TRATAMENTO DE ERROS MELHORADO ---

app.post("/buscar", async (req, res) => {
  const { empresa, cargo } = req.body;

  if (!GOOGLE_API_KEY || !GOOGLE_CX) {
    console.error("ERRO GRAVE: Chaves da API do Google não foram configuradas no ambiente da Vercel.");
    return res.status(500).json({ success: false, error: "Erro de configuração no servidor. Contate o administrador." });
  }

  if (!empresa) {
    return res.status(400).json({ success: false, error: "O nome da empresa é obrigatório." });
  }

  try {
    console.log(`Iniciando busca para empresa: "${empresa}", cargo: "${cargo || 'N/A'}"`);
    
    const searchQuery = `site:linkedin.com/in "${empresa}" ${cargo ? `"${cargo}"` : ""}`;
    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(searchQuery )}`;
    
    const { data } = await axios.get(searchUrl);
    const results = data.items || [];

    if (results.length === 0) {
      console.log("Nenhum resultado bruto encontrado na API do Google.");
      return res.status(200).json({ success: true, leads: [] });
    }

    let leads = results
      .filter(r => r.link && r.link.includes("linkedin.com/in/"))
      .map(r => ({
        nome: r.title.split(" - ")[0].trim(),
        link: r.link,
        email: "Não encontrado",
      }));

    console.log(`Encontrados ${leads.length} perfis do LinkedIn. Iniciando enriquecimento...`);
    const companyDomain = await getCompanyDomain(empresa);

    if (companyDomain) {
      console.log(`Domínio encontrado para ${empresa}: ${companyDomain}`);
      for (const lead of leads) {
        const emailPermutations = generateEmailPermutations(lead.nome, companyDomain);
        for (const email of emailPermutations) {
          const result = await new Promise(resolve => {
            emailVerifier.verify(email, (err, info) => {
              if (!err && info.success) {
                resolve({ found: true, email: email });
              } else {
                resolve({ found: false });
              }
            });
          });
          if (result.found) {
            console.log(`✅ E-mail VÁLIDO encontrado para ${lead.nome}: ${result.email}`);
            lead.email = result.email;
            break;
          }
        }
      }
    } else {
      console.log(`⚠️ Não foi possível encontrar o domínio para a empresa ${empresa}. Pulando enriquecimento de e-mail.`);
    }

    // ATUALIZAÇÃO: A Vercel tem um sistema de arquivos temporário. Escrever arquivos pode ser inconsistente.
    // Vamos mover essa lógica para dentro de um 'try/catch' para não quebrar a resposta ao usuário.
    try {
      const outputDir = path.join('/tmp'); // Usar a pasta /tmp na Vercel
      if (leads.length > 0) {
          const csvHeader = "Nome;Link;Email\n";
          const csvRows = leads.map(l => `${l.nome};${l.link};${l.email}`).join("\n");
          const csvData = csvHeader + csvRows;
          const outputPath = path.join(outputDir, `leads_${empresa.replace(/\s+/g, '_')}.csv`);
          fs.writeFileSync(outputPath, csvData, "utf8");
          console.log(`✅ Leads salvos em: ${outputPath}`);
      }
    } catch (writeError) {
        console.error("⚠️ Erro ao salvar o arquivo CSV no ambiente serverless:", writeError.message);
    }

    console.log("Busca e enriquecimento concluídos. Enviando resposta.");
    return res.status(200).json({ success: true, leads });

  } catch (error) {
    // --- BLOCO DE ERRO ATUALIZADO E ROBUSTO ---
    console.error("!!!!!!!!!! ERRO NA EXECUÇÃO DA BUSCA !!!!!!!!!!");
    
    if (error.response) {
      // Erro vindo da API do Google (Axios)
      console.error("DADOS DO ERRO (AXIOS):", JSON.stringify(error.response.data, null, 2));
      console.error("STATUS DO ERRO (AXIOS):", error.response.status);
      const apiErrorMessage = error.response.data?.error?.message || "Erro na API externa.";
      return res.status(500).json({ success: false, error: `Falha na API do Google: ${apiErrorMessage}` });
    } else {
      // Erro de código ou de configuração da requisição
      console.error("ERRO GERAL (NÃO-AXIOS):", error.message);
      console.error("STACK DO ERRO:", error.stack);
      return res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor." });
    }
  }
});

// A Vercel gerencia a porta, então `app.listen` é mais para desenvolvimento local.
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`💻 Servidor rodando na porta ${PORT}`);
});

// Exporta o app para a Vercel
module.exports = app;
