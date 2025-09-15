// Configurações globais
const BUCKET_URL = 'https://bucket-tgferr-monitor.br-se1.magaluobjects.com';
let playersMap = new Map();
let serviceWorkerReady = false;
let swRegistration = null;

// Service Worker para notificações
if ('serviceWorker' in navigator && 'Notification' in window) {
  navigator.serviceWorker.register('./sw.js').then(function (reg) {
    swRegistration = reg;
    serviceWorkerReady = true;
    console.log('Service worker registrado!', reg);
  });
  Notification.requestPermission();
}

// Utilitários
function convertToDDMMYY(isoDate) {
  const [year, month, day] = isoDate.split('-');
  const yy = year.slice(-2);
  return `${day}${month}${yy}`;
}

// Carrega lista de jogadores
async function loadPlayers() {
  try {
    const res = await fetch('./players.json');
    if (!res.ok) return;
    const list = await res.json();
    for (const p of list)
      playersMap.set(`Player ${p.id}`, p.name || p.displayName || p.id);

    const sel = document.getElementById('playerFilter');
    for (const p of list) {
      const opt = document.createElement('option');
      opt.value = `Player ${p.id}`;
      opt.textContent = p.name || p.displayName || p.id;
      sel.appendChild(opt);
    }
  } catch (e) {
    console.log('Erro ao carregar players:', e);
  }
}

// Popula lista de jogos baseado nos dados carregados
function populateGameFilter(data) {
  const gameFilter = document.getElementById('gameFilter');
  const games = new Set();

  // Limpa opções existentes (exceto "todos")
  gameFilter.innerHTML = '<option value="">(todos)</option>';

  // Coleta todos os jogos únicos dos dados
  for (const player in data) {
    const statuses = (data[player] && data[player].statuses) || {};
    for (const status in statuses) {
      const entry = statuses[status] || {};
      const jogo = entry.jogo;
      if (jogo && jogo !== 'Sem jogo') {
        games.add(jogo);
      }
    }
  }

  // Adiciona jogos ao select
  const sortedGames = Array.from(games).sort();
  for (const game of sortedGames) {
    const opt = document.createElement('option');
    opt.value = game;
    opt.textContent = game;
    gameFilter.appendChild(opt);
  }

  // Adiciona "Sem jogo" no final se houver dados sem jogo
  for (const player in data) {
    const statuses = (data[player] && data[player].statuses) || {};
    for (const status in statuses) {
      const entry = statuses[status] || {};
      if (!entry.jogo || entry.jogo === 'Sem jogo') {
        const opt = document.createElement('option');
        opt.value = 'Sem jogo';
        opt.textContent = 'Sem jogo';
        gameFilter.appendChild(opt);
        break;
      }
    }
  }
}

// Busca dados diários
async function fetchDailyData(isoDate) {
  const filename = convertToDDMMYY(isoDate);
  const filenameWithExt = `${filename}.json`;

  const url = `${BUCKET_URL}/${filenameWithExt}?t=${Date.now()}`;
  console.log('🔍 Tentando buscar do bucket:', url);
  try {
    const res = await fetch(url);
    console.log('📡 Response status:', res.status, res.statusText);
    if (res.ok) {
      const data = await res.json();
      console.log(
        '✅ Dados carregados do bucket:',
        Object.keys(data || {}).length,
        'jogadores'
      );
      return data;
    } else {
      console.error('❌ Erro HTTP:', res.status, res.statusText);
    }
  } catch (e) {
    console.error('❌ Erro na requisição ao bucket:', e);
  }
  return {};
}

// Força atualização: limpa cache, tenta desregistrar service worker e recarrega o relatório
async function forceRefreshData() {
  const dateIso = document.getElementById('date').value;
  if (!dateIso) return alert('Escolha uma data!');

  // Clear HTTP cache by fetching with cache-bust and try to clear caches API
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      for (const k of keys) await caches.delete(k);
      console.log('Caches apagados:', keys);
    }
  } catch (e) {
    console.log('Erro ao limpar caches:', e);
  }

  // Unregister service worker to avoid cached responses
  try {
    if (swRegistration) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) {
        await r.unregister();
      }
      swRegistration = null;
      serviceWorkerReady = false;
      console.log('Service worker desregistrado');
    }
  } catch (e) {
    console.log('Erro ao desregistrar service worker:', e);
  }

  // Força recarga do relatório com cache-bust
  try {
    // Bump the timestamp param by re-calling loadReport which uses fetchDailyData with cache-bust
    await loadReport();
    alert(
      'Dados atualizados (tentativa). Se ainda vir cache, limpe o cache do navegador.'
    );
  } catch (e) {
    console.error('Erro ao recarregar relatório:', e);
    alert('Erro ao forçar atualização. Veja console.');
  }
}

// Gera resumo de tempo total por jogo
function generateGameSummary(data) {
  const gameSummary = {};

  for (const player in data) {
    const statuses = (data[player] && data[player].statuses) || {};

    for (const status in statuses) {
      const entry = statuses[status] || {};
      const jogo = entry.jogo || 'Sem jogo';
      const minutos = entry.countMinutes || 0;

      if (!gameSummary[jogo]) {
        gameSummary[jogo] = {
          totalMinutos: 0,
          jogadores: new Set()
        };
      }

      gameSummary[jogo].totalMinutos += minutos;
      gameSummary[jogo].jogadores.add(player);
    }
  }

  // Converter para array e ordenar por tempo total
  const summary = Object.entries(gameSummary)
    .map(([jogo, dados]) => ({
      jogo,
      totalMinutos: dados.totalMinutos,
      totalJogadores: dados.jogadores.size,
      tempoFormatado: formatMinutesToHours(dados.totalMinutos)
    }))
    .sort((a, b) => b.totalMinutos - a.totalMinutos);

  return summary;
}

// Formata minutos para HHhMMm
function formatMinutesToHours(minutos) {
  const horas = Math.floor(minutos / 60);
  const minutosRestantes = minutos % 60;
  return `${horas.toString().padStart(2, '0')}h${minutosRestantes.toString().padStart(2, '0')}m`;
}

// Agrega minutos por jogador/status/jogo
function aggregateMinutes(data) {
  const gameAggregation = {};

  // Primeiro passo: agregar por jogo
  for (const player in data) {
    const statuses = (data[player] && data[player].statuses) || {};

    for (const status in statuses) {
      const entry = statuses[status] || {};
      const jogo = entry.jogo || 'Sem jogo';
      const minutos = entry.countMinutes || 0;

      if (!gameAggregation[jogo]) {
        gameAggregation[jogo] = {};
      }

      if (!gameAggregation[jogo][player]) {
        gameAggregation[jogo][player] = {
          totalMinutos: 0,
          statuses: []
        };
      }

      gameAggregation[jogo][player].totalMinutos += minutos;
      gameAggregation[jogo][player].statuses.push({
        status,
        minutos,
        updateAt: entry.updateAt
      });
    }
  }

  // Segundo passo: converter para formato da tabela
  const result = [];
  for (const jogo in gameAggregation) {
    for (const player in gameAggregation[jogo]) {
      const playerData = gameAggregation[jogo][player];

      // Para cada status do jogador neste jogo
      for (const statusInfo of playerData.statuses) {
        result.push({
          player,
          status: statusInfo.status,
          jogo,
          minutos: statusInfo.minutos,
          updateAt: statusInfo.updateAt
        });
      }
    }
  }

  return result;
}

// Gera histórico detalhado
function buildHistory(data) {
  const history = {};
  for (const player in data) {
    history[player] = [];
    const statuses = data[player].statuses;
    for (const status in statuses) {
      const entry = statuses[status];
      const minutos = entry.countMinutes || 0;
      const horas = Math.floor(minutos / 60);
      const minutosRestantes = minutos % 60;
      const horasMinutosFormat = `${horas.toString().padStart(2, '0')}h${minutosRestantes.toString().padStart(2, '0')}m`;

      history[player].push({
        status,
        jogo: entry.jogo || 'Sem jogo',
        minutos: minutos,
        tempoFormatado: horasMinutosFormat,
        hora: entry.updateAt,
      });
    }
    // Ordenar por hora para mostrar cronologicamente
    history[player].sort((a, b) => new Date(a.hora) - new Date(b.hora));
  }
  return history;
}

// Exporta CSV do histórico
function exportHistoryCSV(data) {
  let csv = 'player,status,jogo,minutos,hora\n';
  for (const player in data) {
    const statuses = data[player].statuses;
    for (const status in statuses) {
      const entry = statuses[status];
      csv += `${player},${status},${entry.jogo || ''},${
        entry.countMinutes || 0
      },${entry.updateAt}\n`;
    }
  }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `historico.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Exporta CSV da tabela principal
function exportCSV() {
  const table = document.querySelector('#reportArea table');
  if (!table) return alert('Nada para exportar');
  const rows = [];
  for (const tr of table.querySelectorAll('tr')) {
    const cols = Array.from(tr.querySelectorAll('th,td')).map((n) =>
      n.textContent.trim()
    );
    rows.push(cols.join(','));
  }
  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `report-${
    document.getElementById('date').value || 'report'
  }.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Imprime relatório
function printReport() {
  window.print();
}

// Define data de hoje
function setTodayInputs() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}`;
  document.getElementById('date').value = iso;
  loadReport();
}

// Inicialização
document.addEventListener('DOMContentLoaded', function () {
  setTodayInputs();
  loadPlayers();
});
