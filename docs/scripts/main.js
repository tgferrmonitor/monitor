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
  const filenameWithExt = `${filename}.jso`;
  // Tentar primeiro arquivo local (útil para GitHub Pages / testes locais)
  try {
    const localUrl = `./${filenameWithExt}?t=${Date.now()}`; // cache-bust
    console.log('🔍 Tentando buscar localmente:', localUrl);
    const localRes = await fetch(localUrl);
    if (localRes.ok) {
      const data = await localRes.json();
      console.log(
        '✅ Dados locais carregados:',
        Object.keys(data || {}).length,
        'jogadores'
      );
      return data;
    }
  } catch (e) {
    console.log(
      'ℹ️ Dados locais não disponíveis ou com erro, tentando bucket...'
    );
  }

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

// Agrega minutos por jogador/status
function aggregateMinutes(data) {
  const result = [];
  for (const player in data) {
    const statuses = (data[player] && data[player].statuses) || {};
    let latest = null;
    let latestTs = 0;
    for (const status in statuses) {
      const entry = statuses[status] || {};
      const ts = entry.updateAt ? new Date(entry.updateAt).getTime() : 0;
      if (!latest || ts >= latestTs) {
        latestTs = ts;
        latest = {
          player,
          status,
          minutos: entry.countMinutes || 0,
          jogo: entry.jogo || '',
        };
      }
    }
    if (latest) result.push(latest);
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
