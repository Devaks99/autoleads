async function buscarLeads() {
  const empresa = document.getElementById("empresa").value.trim();
  const cargo = document.getElementById("cargo").value.trim();

  if (!empresa) {
    alert("Por favor, digite o nome de uma empresa!");
    return;
  }

  const tabela = document.getElementById("tabela");
  const tbody = tabela.querySelector("tbody");
  const statusDiv = document.getElementById("status");
  const btn = document.querySelector("button");

  // Resetar a interface antes de uma nova busca
  tbody.innerHTML = "";
  tabela.style.display = "none";
  statusDiv.textContent = "Buscando, por favor aguarde...";
  btn.disabled = true;
  btn.textContent = "Buscando...";

  try {
    const resposta = await fetch("/buscar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresa, cargo }), // Envia ambos os campos
    });

    if (!resposta.ok) {
        // Trata erros vindos do servidor (ex: API key faltando)
        const erroData = await resposta.json();
        throw new Error(erroData.error || `Erro no servidor: ${resposta.statusText}`);
    }

    const dados = await resposta.json();

   if (dados.success && dados.leads.length > 0) {
  statusDiv.textContent = `${dados.leads.length} leads encontrados!`;
  tabela.style.display = "table";
  dados.leads.forEach(lead => {
    const linha = document.createElement("tr");
    // Atualize esta parte para incluir o e-mail
    linha.innerHTML = `
      <td>${escapeHtml(lead.nome)}</td>
      <td><a href="${lead.link}" target="_blank">${escapeHtml(lead.link)}</a></td>
      <td>${escapeHtml(lead.email)}</td>
    `;
    tbody.appendChild(linha);
  });
    } else {
      statusDiv.textContent = "Nenhum lead encontrado para esta busca. Tente outros termos.";
    }
  } catch (e) {
    statusDiv.textContent = `Erro: ${e.message}`;
    console.error("Falha na busca:", e);
  } finally {
    // Reabilita o botão ao final da operação
    btn.disabled = false;
    btn.textContent = "Buscar Leads";
  }
}

// Função de segurança para evitar injeção de HTML (XSS)
function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}
