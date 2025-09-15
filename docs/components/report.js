// Componente de relatório - renderiza tabela e histórico
function renderReport(aggregated, history, playerFilter, gameFilter, gameSummary, gamePlayerStatuses) {
  let html = `
    <div class="report-section">
      <h3>${playerFilter ? `Resumo de jogos - ${playersMap.get(playerFilter) || playerFilter}` : 'Resumo por jogo'}</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Jogo</th>
              <th>Tempo Total</th>
              <th>Jogadores</th>
            </tr>
          </thead>
          <tbody>
  `;

  // Agora montamos o resumo por jogo mostrando o status ATUAL de cada jogador
  // Obter lista de jogos como união entre gameSummary e gamePlayerStatuses
  const gamesSet = new Set();
  if (gameSummary && Array.isArray(gameSummary)) gameSummary.forEach(g => gamesSet.add(g.jogo));
  if (gamePlayerStatuses) Object.keys(gamePlayerStatuses).forEach(g => gamesSet.add(g));

  const gamesList = Array.from(gamesSet).sort();
  for (const jogo of gamesList) {
    if (gameFilter && jogo !== gameFilter) continue;

    const playersForGame = (gamePlayerStatuses && gamePlayerStatuses[jogo]) ? gamePlayerStatuses[jogo] : [];

    // Se houver filtro de jogador e este jogador não estiver presente neste jogo, pular
    if (playerFilter && !playersForGame.some(p => p.player === playerFilter)) continue;

    // Tempo exibido: se filtrado por jogador, mostrar o tempo desse jogador neste jogo;
    // caso contrário, usar o tempo agregado do resumo geral
    let tempoDisplay = '';
    if (playerFilter) {
      const playerTimeInGame = aggregated
        .filter(item => item.player === playerFilter && item.jogo === jogo)
        .reduce((total, item) => total + item.minutos, 0);
      tempoDisplay = formatMinutesToHours(playerTimeInGame);
    } else {
      const summaryEntry = (gameSummary || []).find(s => s.jogo === jogo);
      if (summaryEntry) tempoDisplay = summaryEntry.tempoFormatado;
      else tempoDisplay = formatMinutesToHours(playersForGame.reduce((s, p) => s + (p.countMinutes || 0), 0));
    }

    // Monta HTML para coluna de jogadores com status atual e timestamp
    let playersHtml = '<div style="display:flex; flex-direction:column; gap:6px;">';
    for (const p of playersForGame) {
      if (playerFilter && p.player !== playerFilter) continue;
      const name = playersMap.get(p.player) || p.player;
      const badge = getStatusBadge(p.status);
      const ts = p.updateAt ? new Date(p.updateAt).toLocaleString('pt-BR') : 'sem data';
      playersHtml += `<div><strong>${name}</strong> ${badge} <span class="muted">(${ts})</span></div>`;
    }
    playersHtml += '</div>';

    html += `
      <tr>
        <td>${jogo}</td>
        <td>${tempoDisplay}</td>
        <td>${playersHtml}</td>
      </tr>
    `;
  }

  html += `
          </tbody>
        </table>
      </div>

      <h3 style="margin-top: 32px;">Tempo por jogador, jogo e status</h3>
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
    // Aplicar filtros
    if (playerFilter && item.player !== playerFilter) continue;
    if (gameFilter && item.jogo !== gameFilter) continue;

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
      '<p style="margin-top:16px;">Nenhum dado para esta data/jogador/jogo.</p>';
  }

  // Histórico por player com accordion
  html += `
    <div class="history-section" style="margin-top: 32px;">
      <h3>Histórico detalhado por jogador</h3>
      <div style="background-color: var(--md-sys-color-primary-container); padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 0.9em;">
        <strong>📋 Como ler o histórico:</strong>
        <ul style="margin: 8px 0 0 20px; line-height: 1.5;">
          <li><strong>Horário:</strong> Momento exato quando o jogador mudou de status ou jogo</li>
          <li><strong>Duração da sessão:</strong> Por quanto tempo ficou naquele status específico</li>
          <li><strong>Tempo acumulado:</strong> Total de tempo registrado para aquele status/jogo no dia</li>
        </ul>
      </div>
      <button class="btn secondary" onclick="exportHistoryCSV(window.lastDailyData)">
        📄 Baixar CSV do histórico
      </button>
  `;

  for (const player in history) {
    // Aplicar filtro de jogador no histórico também
    if (playerFilter && player !== playerFilter) continue;

    const playerName = playersMap.get(player) || player;

    // Filtrar eventos do histórico se necessário
    const filteredEvents = gameFilter
      ? history[player].filter(ev => ev.jogo === gameFilter)
      : history[player];

    if (filteredEvents.length === 0) continue; // Pular se não há eventos após filtro

    html += `
      <details style="margin-top: 16px;">
        <summary>
          <strong>${playerName}</strong>
          <span class="muted">(${filteredEvents.length} eventos)</span>
        </summary>
        <ul>
    `;

    for (const ev of filteredEvents) {
      const badge = getStatusBadge(ev.status);
      const timeDisplay = ev.hora
        ? new Date(ev.hora).toLocaleTimeString('pt-BR')
        : '';

      // Melhorar descrição do que representa cada informação
      const gameInfo = ev.jogo !== 'Sem jogo' ? `🎮 ${ev.jogo}` : '⭕ Sem jogo';

      // Informação sobre duração da sessão
      const duracaoInfo = ev.duracaoSessao !== 'Sessão ativa'
        ? `⏰ <strong>Duração desta sessão:</strong> ${ev.duracaoSessao}`
        : `⏰ <strong>Sessão ainda ativa</strong> (ou última do dia)`;

      html += `
        <li style="padding: 12px 0; border-bottom: 1px solid var(--md-sys-color-outline-variant);">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <strong style="color: var(--md-sys-color-primary);">${timeDisplay}</strong>
            - ${badge} - ${gameInfo}
          </div>
          <div style="font-size: 0.85em; color: var(--md-sys-color-on-surface-variant); margin-left: 16px; line-height: 1.4;">
            ${duracaoInfo}
            <br>
            📊 <strong>Tempo total acumulado neste status/jogo:</strong> ${ev.tempoFormatado}
            <br>
            <em style="opacity: 0.8;">💡 O horário ${timeDisplay} marca quando o jogador ${getStatusAction(ev.status)}</em>
          </div>
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

// Explica a ação do status
function getStatusAction(status) {
  const actions = {
    'Online': 'ficou online (disponível no Roblox)',
    'Jogando': 'começou a jogar ou mudou de jogo',
    'No Studio': 'entrou no Roblox Studio',
    'Offline': 'ficou offline ou fechou o Roblox',
    'Invisível': 'ativou modo invisível'
  };
  return actions[status] || `mudou para "${status}"`;
}

// Função principal de carregamento do relatório
async function loadReport() {
  const dateIso = document.getElementById('date').value;
  if (!dateIso) return alert('Escolha uma data!');

  const playerFilter = document.getElementById('playerFilter').value;
  const gameFilter = document.getElementById('gameFilter').value;
  const reportArea = document.getElementById('reportArea');

  // Loading state
  reportArea.innerHTML = '<p>Carregando dados...</p>';

  try {
    const dailyData = await fetchDailyData(dateIso);

    // Popula o filtro de jogos com base nos dados carregados
    populateGameFilter(dailyData);

  const aggregated = aggregateMinutes(dailyData);
  const history = buildHistory(dailyData);
  const gameSummary = generateGameSummary(dailyData);
  const gamePlayerStatuses = buildGamePlayerStatuses(dailyData);

  // Renderiza relatório com ambos os filtros
  const reportHTML = renderReport(aggregated, history, playerFilter, gameFilter, gameSummary, gamePlayerStatuses);
    reportArea.innerHTML = reportHTML;

    // Salva dados para exportação CSV
    window.lastDailyData = dailyData;
  } catch (error) {
    console.error('Erro ao carregar relatório:', error);
    reportArea.innerHTML = '<p>Erro ao carregar dados. Tente novamente.</p>';
  }
}
