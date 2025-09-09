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

// Busca dados diários
async function fetchDailyData(isoDate) {
  const filename = convertToDDMMYY(isoDate);
  const url = `${BUCKET_URL}/${filename}.json`;
  console.log('🔍 Tentando buscar:', url);
  try {
    const res = await fetch(url);
    console.log('📡 Response status:', res.status, res.statusText);
    if (res.ok) {
      const data = await res.json();
      console.log(
        '✅ Dados carregados:',
        Object.keys(data || {}).length,
        'jogadores'
      );
      return data;
    } else {
      console.error('❌ Erro HTTP:', res.status, res.statusText);
    }
  } catch (e) {
    console.error('❌ Erro na requisição:', e);
  }
  return {};
}

// Agrega minutos por jogador/status
function aggregateMinutes(data) {
  const minutes = {};
  for (const player in data) {
    const statuses = data[player].statuses;
    for (const status in statuses) {
      const entry = statuses[status];
      const key = `${player}|${status}`;
      if (!minutes[key]) {
        minutes[key] = {
          player,
          status,
          minutos: 0,
          jogo: entry.jogo || '',
        };
      }
      minutes[key].minutos += entry.countMinutes || 0;
    }
  }
  return Object.values(minutes);
}

// Gera histórico detalhado
function buildHistory(data) {
  const history = {};
  for (const player in data) {
    history[player] = [];
    const statuses = data[player].statuses;
    for (const status in statuses) {
      const entry = statuses[status];
      history[player].push({
        status,
        jogo: entry.jogo || '',
        minutos: entry.countMinutes || 0,
        hora: entry.updateAt,
      });
    }
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
