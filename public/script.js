async function buscarLeads() {
  const empresa = document.getElementById("empresa").value.trim();
  const cargo = document.getElementById("cargo").value.trim();
  const cnpj = document.getElementById("cnpj") ? document.getElementById("cnpj").value.trim() : "";

  if (!empresa) return alert("Por favor, digite o nome de uma empresa!");

  const tabela = document.getElementById("tabela");
  const tbody = tabela.querySelector("tbody");
  const statusDiv = document.getElementById("status");
  const btn = document.querySelector("button");

  tbody.innerHTML = "";
  tabela.style.display = "none";
  statusDiv.textContent = "Buscando, por favor aguarde...";
  btn.disabled = true;
  btn.textContent = "Buscando...";

  try {
    // Envia empresa, cargo e CNPJ para o backend
    const resposta = await fetch("/api/buscar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresa, cargo, cnpj }),
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      throw new Error(dados.error || `Erro no servidor: ${resposta.statusText}`);
    }

    if (dados.success && dados.leads.length > 0) {
      statusDiv.textContent = `${dados.leads.length} leads encontrados!`;
      tabela.style.display = "table";
      tbody.innerHTML = ""; // limpa antes de inserir novas linhas

      dados.leads.forEach(lead => {
        const linha = document.createElement("tr");
        linha.innerHTML = `
          <td>${escapeHtml(lead.nome)}</td>
          <td><a href="${lead.link}" target="_blank">${escapeHtml(lead.link)}</a></td>
          <td>${escapeHtml(lead.email || "Email não encontrado")}</td>
        `;
        tbody.appendChild(linha);
      });
    } else {
      statusDiv.textContent = "Nenhum lead encontrado para esta busca.";
    }
  } catch (e) {
    statusDiv.textContent = `Erro: ${e.message}`;
    console.error("Falha na busca:", e);
  } finally {
    btn.disabled = false;
    btn.textContent = "Buscar Leads";
  }
}

// Função para evitar injeção de HTML
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
