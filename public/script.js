async function buscarLeads() {
  const empresa = document.getElementById("empresa").value.trim();
  if (!empresa) return alert("Digite o nome de uma empresa!");

  const tabela = document.getElementById("tabela");
  const tbody = tabela.querySelector("tbody");
  tbody.innerHTML = "";
  tabela.style.display = "none";

  const btn = document.querySelector("button");
  btn.disabled = true;
  btn.textContent = "Buscando...";

  try {
    const resposta = await fetch("/buscar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresa }),
    });

    const dados = await resposta.json();

    if (dados.success && dados.leads.length > 0) {
      tabela.style.display = "table";
      dados.leads.forEach((l) => {
        const linha = `<tr>
          <td>${l.nome}</td>
          <td><a href="${l.link}" target="_blank">${l.link}</a></td>
        </tr>`;
        tbody.innerHTML += linha;
      });
    } else {
      alert("Nenhum lead encontrado.");
    }
  } catch (e) {
    alert("Erro ao buscar leads.");
    console.error(e);
  }

  btn.disabled = false;
  btn.textContent = "Buscar";
}
