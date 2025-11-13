require("dotenv").config();
const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;

app.use(express.json());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/**
 * Helper: normaliza CNPJ (só dígitos)
 */
function normalizeDigits(input = "") {
  return (input || "").toString().replace(/\D/g, "");
}

/**
 * Helper: tenta extrair possíveis nomes de empresa a partir de um título de página
 * (remove separadores, termos comuns e retorna tokens plausíveis)
 */
function extractPossibleNamesFromTitle(title = "") {
  if (!title) return [];
  // separadores comuns
  const parts = title.split(/[-|–—•:]/).map(p => p.trim()).filter(Boolean);
  // filtra tokens muito curtos e palavras genéricas
  const candidates = parts.filter(p => p.length > 3 && !/^(site|página|blog|notícias|contato)$/i.test(p));
  return candidates;
}

/**
 * Faz uma busca no Google Custom Search (SERP API) com parâmetros que priorizam Brasil
 */
async function googleSearchRaw(query) {
  const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&gl=br&hl=pt-BR`;
  const resp = await axios.get(url);
  return resp.data || {};
}

app.post("/api/buscar", async (req, res) => {
  const { empresa, cargo, cnpj } = req.body;

  if (!GOOGLE_API_KEY || !GOOGLE_CX) {
    console.error("ERRO GRAVE: Chaves da API do Google não configuradas.");
    return res.status(500).json({ success: false, error: "Erro de configuração no servidor." });
  }

  if (!empresa) {
    return res.status(400).json({ success: false, error: "O nome da empresa é obrigatório." });
  }

  try {
    // 1) Busca inicial: LinkedIn profiles por nome + cargo, priorizando Brasil
    let searchQuery = `site:linkedin.com/in "${empresa}" ${cargo ? `"${cargo}"` : ""} `;
    // não colocar CNPJ direto — vamos tratar em etapa separada
    console.log("Query principal (LinkedIn):", searchQuery);

    const mainData = await googleSearchRaw(searchQuery);
    const results = mainData.items || [];

    // Converte resultados em leads (mantendo snippet para possíveis filtros)
    let leads = results
      .filter(r => r.link && r.link.includes("linkedin.com/in/"))
      .map(r => ({
        nome: (r.title || "").split(" - ")[0].trim(),
        link: r.link,
        snippet: r.snippet || "",
        email: null // placeholder; vamos tentar extrair email do snippet
      }));

    // tenta extrair emails do snippet
    const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
    leads = leads.map(l => {
      const m = (l.snippet || "").match(emailRegex);
      return {
        ...l,
        email: m ? m[0] : "Email não encontrado"
      };
    });

    // 2) Se CNPJ fornecido -> busca páginas que contenham o CNPJ, extrai pistas de nome e filtra
    if (cnpj && cnpj.trim() !== "") {
      const cnpjDigits = normalizeDigits(cnpj);
      console.log("CNPJ informado (digits):", cnpjDigits);

      // fazemos uma busca separada pelo CNPJ (pesquisa em páginas brasileiras)
      // query procurará por "CNPJ 12.345.678/0001-90" e também pelo número puro
      const cnpjQueries = [
        `"${cnpjDigits}"`, // número puro
        `"CNPJ ${cnpjDigits}"`,
        `"CNPJ ${cnpj}"` // caso usuário tenha digitado com formatação
      ];

      // junta títulos e domains das páginas que mencionam o CNPJ para extrair nomes/domínios
      const candidateNames = new Set();

      for (const q of cnpjQueries) {
        try {
          const cnpjData = await googleSearchRaw(q);
          const items = cnpjData.items || [];
          items.forEach(it => {
            if (it.title) {
              extractPossibleNamesFromTitle(it.title).forEach(n => candidateNames.add(n));
            }
            // tentar pegar domínio/host também
            if (it.link) {
              try {
                const urlObj = new URL(it.link);
                const host = urlObj.hostname.replace(/^www\./, "");
                if (host && host.includes(".br")) candidateNames.add(host);
              } catch(e) { /* ignore */ }
            }
          });
        } catch (err) {
          console.warn("Falha buscando CNPJ com query:", q, err.message);
        }
      }

      const candidates = [...candidateNames].map(s => s.toLowerCase());
      console.log("Candidatos extraídos a partir do CNPJ:", candidates);

      // Se temos candidatos, filtramos as leads pelo nome ou snippet que contenha qualquer candidato
      if (candidates.length > 0) {
        const filtered = leads.filter(l => {
          const text = (l.nome + " " + l.snippet).toLowerCase();
          return candidates.some(c => c && text.includes(c));
        });

        // se o filtro deixou vazia, tenta uma filtragem mais relaxada (apenas checar empresa original)
        if (filtered.length > 0) {
          leads = filtered;
        } else {
          // tenta matching com o próprio nome da empresa informado (mais relaxado)
          const empLower = empresa.toLowerCase();
          const fallback = leads.filter(l => (l.nome + " " + l.snippet).toLowerCase().includes(empLower));
          if (fallback.length > 0) leads = fallback;
          else {
            // não encontrou nada mais específico — retorna aviso para usuário
            return res.status(200).json({
              success: true,
              leads: [],
              warning: "Nenhum perfil do LinkedIn foi identificado com confiança via CNPJ. Tente apenas com o nome da empresa ou verifique o CNPJ."
            });
          }
        }
      } else {
        // não conseguiu extrair candidatos do CNPJ — deixa leads como estão, mas informa
        console.log("Nenhum candidato extraído a partir do CNPJ; mantendo leads sem filtro adicional.");
      }
    }

    // Remove propriedades temporárias (snippet) antes de retornar
    leads = leads.map(l => ({ nome: l.nome, link: l.link, email: l.email || "Email não encontrado" }));

    return res.status(200).json({ success: true, leads });

  } catch (error) {
    console.error("❌ ERRO NA BUSCA DE LEADS:", error.message);
    if (error.response) {
      console.error("AXIOS ERRO:", JSON.stringify(error.response.data, null, 2));
      const apiErrorMessage = error.response.data?.error?.message || "Erro na API externa.";
      return res.status(500).json({ success: false, error: `Falha na API do Google: ${apiErrorMessage}` });
    }
    return res.status(500).json({ success: false, error: "Erro interno no servidor." });
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🔥 Servidor rodando em http://localhost:${PORT}`));
}

module.exports = app;
