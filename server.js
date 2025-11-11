// server.js (versão com enriquecimento de e-mail)

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
const emailVerifier = new EmailVerifier(process.env.HUNTER_API_KEY || 'default_key_if_needed'); // Pode precisar de uma API key de serviços como Hunter.io para verificação avançada, mas o básico funciona sem.

app.use(express.static("public"));
app.use(express.json());

const outputDir = path.join(__dirname, "output");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// --- NOVAS FUNÇÕES DE ENRIQUECIMENTO ---

/**
 * Busca no Google pelo site oficial de uma empresa.
 * @param {string} companyName - O nome da empresa.
 * @returns {Promise<string|null>} - O domínio da empresa ou null.
 */
async function getCompanyDomain(companyName) {
  const query = `site oficial ${companyName}`;
  const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query )}`;
  try {
    const { data } = await axios.get(url);
    if (data.items && data.items.length > 0) {
      const firstResultUrl = new URL(data.items[0].link);
      // Retorna o hostname (ex: "google.com")
      return firstResultUrl.hostname.replace(/^www\./, '');
    }
    return null;
  } catch (error) {
    console.error(`Erro ao buscar domínio para ${companyName}:`, error.message);
    return null;
  }
}

/**
 * Gera uma lista de possíveis e-mails a partir de um nome e domínio.
 * @param {string} fullName - Nome completo do lead (ex: "João da Silva").
 * @param {string} domain - Domínio da empresa (ex: "google.com").
 * @returns {string[]} - Uma lista de e-mails prováveis.
 */
function generateEmailPermutations(fullName, domain) {
    if (!fullName || !domain) return [];

    const nameParts = fullName.toLowerCase().split(' ').filter(p => p.length > 1);
    if (nameParts.length === 0) return [];

    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';

    const permutations = new Set(); // Usar Set para evitar duplicatas

    permutations.add(`${firstName}@${domain}`); // joao@...
    if (lastName) {
        permutations.add(`${firstName}.${lastName}@${domain}`); // joao.silva@...
        permutations.add(`${firstName}${lastName}@${domain}`); // joaosilva@...
        permutations.add(`${firstName.charAt(0)}${lastName}@${domain}`); // jsilva@...
        permutations.add(`${firstName}_${lastName}@${domain}`); // joao_silva@...
        permutations.add(`${lastName}.${firstName}@${domain}`); // silva.joao@...
    }

    return Array.from(permutations);
}

// --- ROTA PRINCIPAL ATUALIZADA ---

app.post("/buscar", async (req, res) => {
  const { empresa, cargo } = req.body;

  if (!empresa) {
    return res.status(400).json({ success: false, error: "O nome da empresa é obrigatório." });
  }
  if (!GOOGLE_API_KEY || !GOOGLE_CX) {
    return res.status(500).json({ success: false, error: "Erro de configuração no servidor." });
  }

  try {
    // ETAPA 1: Buscar perfis no LinkedIn (como antes)
    const searchQuery = `site:linkedin.com/in "${empresa}" ${cargo ? `"${cargo}"` : ""}`;
    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(searchQuery )}`;
    
    const { data } = await axios.get(searchUrl);
    const results = data.items || [];

    if (results.length === 0) {
      return res.json({ success: true, leads: [] });
    }

    let leads = results
      .filter(r => r.link && r.link.includes("linkedin.com/in/"))
      .map(r => ({
        nome: r.title.split(" - ")[0].trim(),
        link: r.link,
        email: "Não encontrado", // Valor padrão
      }));

    // ETAPA 2: Enriquecer os leads com e-mail
    console.log("Iniciando processo de enriquecimento de e-mails...");
    const companyDomain = await getCompanyDomain(empresa);

    if (companyDomain) {
      console.log(`Domínio encontrado para ${empresa}: ${companyDomain}`);
      
      // Usamos um loop `for...of` para poder usar `await` dentro dele
      for (const lead of leads) {
        const emailPermutations = generateEmailPermutations(lead.nome, companyDomain);
        
        // Tenta verificar cada permutação
        for (const email of emailPermutations) {
          const result = await new Promise(resolve => {
            emailVerifier.verify(email, (err, info) => {
              // Se o e-mail for válido (info.success = true), nós o encontramos!
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
            break; // Para de procurar e-mails para este lead
          }
        }
      }
    } else {
      console.log(`⚠️ Não foi possível encontrar o domínio para a empresa ${empresa}. Pulando enriquecimento de e-mail.`);
    }

    // Salvar CSV com a nova coluna de e-mail
    if (leads.length > 0) {
        const csvHeader = "Nome;Link;Email\n";
        const csvRows = leads.map(l => `${l.nome};${l.link};${l.email}`).join("\n");
        const csvData = csvHeader + csvRows;
        const outputPath = path.join(outputDir, `leads_${empresa.replace(/\s+/g, '_')}.csv`);
        fs.writeFileSync(outputPath, csvData, "utf8");
        console.log(`✅ Leads (com e-mails) salvos em: ${outputPath}`);
    }

    res.json({ success: true, leads });

  } catch (err) {
    console.error("❌ Erro geral no endpoint /buscar:", err.message);
    res.status(500).json({ success: false, error: "Falha ao processar a busca." });
  }
});

const PORT = 3000;
app.listen(PORT, () =>
  console.log(`💻 Servidor rodando em http://localhost:${PORT}` )
);
