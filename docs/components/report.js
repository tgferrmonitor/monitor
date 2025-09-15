// Componente de relatório - renderiza tabela e histórico
function renderReport(aggregated, history, playerFilter) {
  let html = `
    <div class="report-section">
      <h3>Tempo por jogador, jogo e status</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Jogador</th>
              <th>Status</th>
              <th>Horas</th>
              <th>Jogo</th>
            </tr>
          </thead>
          <tbody>
  `;

  let found = false;
  for (const item of aggregated) {
    if (playerFilter && item.player !== playerFilter) continue;
    const playerName = playersMap.get(item.player) || item.player;
    const badge = getStatusBadge(item.status);
    // Normaliza minutos para formato "HHhMMm"
    const horas = Math.floor(item.minutos / 60);
    const minutosRestantes = item.minutos % 60;
    const horasMinutosFormat = `${horas.toString().padStart(2, '0')}h${minutosRestantes.toString().padStart(2, '0')}m`;

    html += `
      <tr>
      <td>${playerName}</td>
      <td>${badge}</td>
      <td>${horasMinutosFormat}</td>
      <td>${item.jogo}</td>
      </tr>
    `;
    found = true;
  }

  html += `
          </tbody>
        </table>
      </div>
  `;

  if (!found) {
    html +=
      '<p style="margin-top:16px;">Nenhum dado para esta data/jogador.</p>';
  }

  // Histórico por player com accordion
  html += `
    <div class="history-section" style="margin-top: 32px;">
      <h3>Histórico detalhado por jogador</h3>
      <button class="btn secondary" onclick="exportHistoryCSV(window.lastDailyData)">
        📄 Baixar CSV do histórico
      </button>
  `;

  for (const player in history) {
    const playerName = playersMap.get(player) || player;
    html += `
      <details style="margin-top: 16px;">
        <summary>
          <strong>${playerName}</strong>
          <span class="muted">(${history[player].length} eventos)</span>
        </summary>
        <ul>
    `;

    for (const ev of history[player]) {
      const badge = getStatusBadge(ev.status);
      const timeDisplay = ev.hora
        ? new Date(ev.hora).toLocaleTimeString('pt-BR')
        : '';
      html += `
        <li>
          ${timeDisplay} - ${badge} -
          <span class="muted">${ev.jogo}</span>
          <span class="muted">Total: ${ev.minutos} min</span>
        </li>
      `;
    }

    html += `
        </ul>
      </details>
    `;
  }

  html += `
    </div>
  </div>
  `;

  return html;
}

// Gera badge de status
function getStatusBadge(status) {
  const badges = {
    Online: '<span class="badge online">Online</span>',
    Jogando: '<span class="badge ingame">Jogando</span>',
    'No Studio': '<span class="badge instudio">Studio</span>',
    Offline: '<span class="badge offline">Offline</span>',
    Invisível: '<span class="badge invisible">Invisível</span>',
  };
  return badges[status] || `<span class="badge">${status}</span>`;
}

// Função principal de carregamento do relatório
async function loadReport() {
  const dateIso = document.getElementById('date').value;
  if (!dateIso) return alert('Escolha uma data!');

  const playerFilter = document.getElementById('playerFilter').value;
  const reportArea = document.getElementById('reportArea');

  // Loading state
  reportArea.innerHTML = '<p>Carregando dados...</p>';

  try {
    const dailyData = await fetchDailyData(dateIso);
    const aggregated = aggregateMinutes(dailyData);
    const history = buildHistory(dailyData);

    // Renderiza relatório
    const reportHTML = renderReport(aggregated, history, playerFilter);
    reportArea.innerHTML = reportHTML;

    // Salva dados para exportação CSV
    window.lastDailyData = dailyData;
  } catch (error) {
    console.error('Erro ao carregar relatório:', error);
    reportArea.innerHTML = '<p>Erro ao carregar dados. Tente novamente.</p>';
  }
}
