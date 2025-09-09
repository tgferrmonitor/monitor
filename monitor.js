import https from 'https';
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import dotenv from 'dotenv';

dotenv.config();

import http from 'http';

// Se precisar ignorar certificados self-signed em desenvolvimento, ative a
// flag ALLOW_SELF_SIGNED=1 ao rodar o script. Isso definirá
// NODE_TLS_REJECT_UNAUTHORIZED=0 para o processo (apenas local/dev).
if (process.env.ALLOW_SELF_SIGNED === '1') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn(
    '⚠️ ALLOW_SELF_SIGNED=1 ativo - verificação TLS desativada para este processo'
  );
}

// HTTPS Agent para ignorar certificados inválidos (útil em ambientes de teste)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Configurar cliente S3 com NodeHttpHandler usando httpsAgent
const s3Client = new S3Client({
  region: process.env.S3_REGION?.trim(),
  endpoint: process.env.S3_ENDPOINT?.trim(),
  credentials: {
    accessKeyId: process.env.S3_KEY?.trim(),
    secretAccessKey: process.env.S3_SECRET?.trim(),
  },
});

// Carregar configs
const PLAYERS = JSON.parse(process.env.PLAYERS || '[]');
const ROBLOSECURITY = process.env.ROBLOSECURITY?.trim();
const TZ_OFFSET_MINUTES = parseInt(process.env.TZ_OFFSET_MINUTES || '0', 10);

// Configurações de email
const EMAIL_USER = process.env.EMAIL_USER || process.env.S3_EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS || process.env.S3_EMAIL_PASS;
const EMAIL_TO = process.env.EMAIL_TO || process.env.S3_EMAIL_TO;

// Carregar mapeamento de players de arquivo local (se existir)
let playersMap = new Map();
try {
  const fs = await import('fs/promises');
  const playersData = await fs.readFile('./players.json', 'utf8');
  const parsed = JSON.parse(playersData);

  // Se tem formato com array de objetos {id, name}
  if (parsed.players && Array.isArray(parsed.players)) {
    for (const player of parsed.players) {
      if (typeof player === 'object' && player.id && player.name) {
        playersMap.set(String(player.id), player.name);
      }
    }
  }
  console.log(`📝 Mapeamento de players carregado: ${playersMap.size} players`);
} catch (err) {
  console.log(
    'ℹ️ Arquivo players.json não encontrado ou inválido, usando IDs como nomes'
  );
}

function getPlayerName(userId) {
  return playersMap.get(String(userId)) || `Player ${userId}`;
}

// Validação simples de ambiente para evitar mensagens crípticas do SDK
function validateS3Env() {
  const missing = [];
  if (!process.env.S3_BUCKET?.trim()) missing.push('S3_BUCKET');
  if (!process.env.S3_KEY?.trim()) missing.push('S3_KEY');
  if (!process.env.S3_SECRET?.trim()) missing.push('S3_SECRET');
  if (missing.length > 0) {
    console.error(
      `❌ Variáveis de ambiente faltando: ${missing.join(', ')}. ` +
        'Defina-as no .env ou no ambiente antes de executar.'
    );
    // lançar erro para virar falha rápida; facilitamos debugging em CI
    throw new Error(
      'Missing required S3 environment variables: ' + missing.join(', ')
    );
  }
}

try {
  validateS3Env();
} catch (err) {
  console.error('Aborting due to missing configuration.');
  process.exit(1);
}

async function getUserPresence(userIds) {
  if (!userIds || userIds.length === 0) {
    throw new Error('userIds não pode ser vazio.');
  }

  const res = await fetch('https://presence.roblox.com/v1/presence/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `.ROBLOSECURITY=${ROBLOSECURITY}`,
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({ userIds }),
    agent: httpsAgent,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erro ao buscar presença: ${res.status} - ${text}`);
  }

  return res.json();
}

async function saveDailyData(filename, presenceData) {
  // Buscar dados existentes do dia
  let existingData = [];
  try {
    const existing = await s3Client.send(
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET?.trim(),
        Key: filename,
      })
    );
    const stream = existing.Body;
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString('utf8');
    const parsed = JSON.parse(text) || [];
    // Compatibilidade: historicamente gravamos arrays; nova versão grava objeto agrupado.
    // Se o arquivo for um objeto (grouped), convertemos para array de entradas para processamento.
    if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
      const converted = [];
      for (const [player, pdata] of Object.entries(parsed)) {
        const statuses = pdata && pdata.statuses ? pdata.statuses : {};
        for (const [status, sdata] of Object.entries(statuses)) {
          converted.push({
            player,
            status,
            jogo: sdata.jogo || '',
            countMinutes: sdata.countMinutes || 0,
            updatedAt:
              sdata.updateAt || sdata.updatedAt || new Date().toISOString(),
          });
        }
      }
      existingData = converted;
    } else {
      existingData = parsed;
    }
    console.log(
      `📂 Dados existentes carregados: ${
        Array.isArray(existingData) ? existingData.length : 0
      } entradas`
    );
  } catch (err) {
    if (err.name !== 'NoSuchKey') {
      console.error('Erro ao ler dados existentes:', err);
    }
    console.log('📂 Arquivo não existe, iniciando novo dia');
    // Se arquivo não existe, continuar com array vazio
  }

  // Mapear status codes para strings legíveis
  const statusMap = {
    0: 'Offline',
    1: 'Online',
    2: 'Jogando',
    3: 'No Studio',
    4: 'Invisível',
  };

  // Agrupa dados por jogador/status
  const allEntries = [...existingData];
  if (presenceData && presenceData.userPresences) {
    for (const info of presenceData.userPresences) {
      const playerName = getPlayerName(info.userId);
      const status = statusMap[info.userPresenceType] || 'Desconhecido';
      const jogo = info.lastLocation || '';
      allEntries.push({
        player: playerName,
        status,
        jogo,
        countMinutes: info.countMinutes || 0,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  // Monta estrutura agrupada
  const groupedData = {};
  for (const entry of allEntries) {
    const player = entry.player;
    const status = entry.status;
    const jogo = entry.jogo;
    const updatedAt = entry.updatedAt;
    const countMinutes = entry.countMinutes || 0;
    if (!groupedData[player]) groupedData[player] = { statuses: {} };
    if (!groupedData[player].statuses[status]) {
      groupedData[player].statuses[status] = {
        updateAt: updatedAt,
        countMinutes: countMinutes,
      };
      if (status === 'Jogando')
        groupedData[player].statuses[status].jogo = jogo;
    } else {
      groupedData[player].statuses[status].countMinutes += countMinutes;
      groupedData[player].statuses[status].updateAt = updatedAt;
      if (status === 'Jogando' && jogo)
        groupedData[player].statuses[status].jogo = jogo;
    }
  }

  // Detectar mudanças para notificação (mantém fluxo)
  const changes = detectChanges(existingData, allEntries);
  if (changes.length > 0) await sendEmailNotification(changes);

  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET?.trim(),
    Key: filename,
    Body: JSON.stringify(groupedData, null, 2),
    ContentType: 'application/json',
  });

  try {
    console.log('📤 Enviando dados agrupados para S3...');
    await s3Client.send(command);
    console.log(`✅ Dados salvos: ${filename}`);
    console.log('🎯 Processo de salvamento completo!');
  } catch (err) {
    console.error('Erro ao enviar para S3:', err);
    throw err;
  }
}

async function processPlayerData(existingData, presenceData, statusMap) {
  const currentTime = new Date().toISOString();
  // Começa com todos os eventos anteriores
  const updatedData = [...existingData];

  console.log(
    `🔄 Processando dados para ${
      presenceData.userPresences?.length || 0
    } players...`
  );

  for (const info of presenceData.userPresences || []) {
    const playerName = getPlayerName(info.userId);
    const status = statusMap[info.userPresenceType] || 'Desconhecido';
    const jogo = info.lastLocation || 'N/A';

    // Busca última entrada desse player
    const lastEntry = [...updatedData]
      .reverse()
      .find((entry) => entry.player === playerName);

    if (lastEntry && lastEntry.status === status && lastEntry.jogo === jogo) {
      // Mesmo status/jogo: acumula minutos
      const lastUpdate = new Date(lastEntry.updatedAt);
      const now = new Date(currentTime);
      const minutesDiff = Math.floor((now - lastUpdate) / (1000 * 60));
      const validMinutesDiff = Math.min(minutesDiff, 60);
      const newCountMinutes = Math.max(
        0,
        (lastEntry.countMinutes || 0) + validMinutesDiff
      );
      updatedData.push({
        player: playerName,
        status: status,
        jogo: jogo,
        countMinutes: newCountMinutes,
        updatedAt: currentTime,
      });
    } else {
      // Mudança de status/jogo ou novo player: nova entrada zerada
      updatedData.push({
        player: playerName,
        status: status,
        jogo: jogo,
        countMinutes: 0,
        updatedAt: currentTime,
      });
    }
  }

  console.log(
    `✅ Processamento concluído: ${updatedData.length} entradas atualizadas`
  );
  return updatedData;
}

// Funções auxiliares removidas - usando abordagem simplificada

// Função para ajustar datas pelo offset de timezone
function applyTimezoneOffset(dateInput) {
  if (!dateInput) return new Date();
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return new Date();
  d.setMinutes(d.getMinutes() + TZ_OFFSET_MINUTES);
  return d;
}

function formatDate(date) {
  const pad = (n) => n.toString().padStart(2, '0');
  const year = date.getFullYear().toString().slice(-2); // YY format
  return `${pad(date.getDate())}${pad(date.getMonth() + 1)}${year}`;
}

function formatDateTime(dateString) {
  if (!dateString || dateString === 'undefined') {
    return applyTimezoneOffset(new Date()).toLocaleString('pt-BR');
  }
  try {
    return applyTimezoneOffset(dateString).toLocaleString('pt-BR');
  } catch (e) {
    return applyTimezoneOffset(new Date()).toLocaleString('pt-BR');
  }
}

function detectChanges(existingData, newData) {
  // Apenas comparar o último status conhecido por jogador (baseado em updatedAt).
  const changes = [];
  const currentTime = new Date().toISOString();

  const eArr = Array.isArray(existingData) ? existingData : [];
  const nArr = Array.isArray(newData) ? newData : [];

  // Construir um map { player -> lastEntry } a partir de existingData
  const lastExistingByPlayer = new Map();
  for (const e of eArr) {
    if (!e || !e.player) continue;
    const ts = e.updatedAt ? new Date(e.updatedAt).getTime() : 0;
    const prev = lastExistingByPlayer.get(e.player);
    if (!prev || (prev._ts || 0) < ts) {
      lastExistingByPlayer.set(e.player, { ...e, _ts: ts });
    }
  }

  // Construir um map { player -> lastEntry } a partir de newData
  const lastNewByPlayer = new Map();
  for (const n of nArr) {
    if (!n || !n.player) continue;
    const ts = n.updatedAt ? new Date(n.updatedAt).getTime() : 0;
    const prev = lastNewByPlayer.get(n.player);
    if (!prev || (prev._ts || 0) < ts) {
      lastNewByPlayer.set(n.player, { ...n, _ts: ts });
    }
  }

  // Comparar últimos estados por jogador
  for (const [player, newEntry] of lastNewByPlayer.entries()) {
    const existingEntry = lastExistingByPlayer.get(player);
    if (!existingEntry) {
      changes.push({
        player,
        changeType: 'new',
        from: { status: 'N/A', jogo: 'N/A' },
        to: { status: newEntry.status, jogo: newEntry.jogo },
        timestamp: currentTime,
      });
      continue;
    }

    // Comparar somente status e jogo — ignorar countMinutes/updatedAt
    if (
      existingEntry.status !== newEntry.status ||
      existingEntry.jogo !== newEntry.jogo
    ) {
      changes.push({
        player,
        changeType: 'change',
        from: { status: existingEntry.status, jogo: existingEntry.jogo },
        to: { status: newEntry.status, jogo: newEntry.jogo },
        timestamp: currentTime,
      });
    }
  }

  return changes;
}

async function sendEmailNotification(changes) {
  if (!EMAIL_USER || !EMAIL_PASS || !EMAIL_TO || changes.length === 0) {
    if (changes.length === 0) {
      console.log('📧 Nenhuma mudança detectada, não enviando email');
    } else {
      console.log(
        '📧 Credenciais de email não configuradas, pulando notificação'
      );
    }
    return;
  }

  try {
    console.log('📧 Preparando email de notificação...');

    // Monta corpo do e-mail
    let corpo = '🎮 RELATÓRIO DE ATIVIDADE ROBLOX 🎮\n';
    corpo += '='.repeat(50) + '\n\n';

    if (changes.length === 1) {
      corpo += '📊 1 mudança de status detectada:\n\n';
    } else {
      corpo += `📊 ${changes.length} mudanças de status detectadas:\n\n`;
    }

    for (const change of changes) {
      const playerName = getPlayerName(change.player.replace('Player ', ''));

      corpo += `👤 JOGADOR: ${playerName}\n`;
      corpo += `📅 QUANDO: ${formatDateTime(change.timestamp)}\n`;

      if (change.changeType === 'new') {
        corpo += `🆕 NOVO PLAYER: ${change.to.status}\n`;
      } else {
        corpo += `🔄 MUDANÇA: ${change.from.status} → ${change.to.status}\n`;
      }

      if (change.to.jogo !== 'N/A' && change.to.jogo !== 'Website') {
        corpo += `🎯 JOGO: ${change.to.jogo}\n`;
      }

      if (change.to.status === 'Jogando' && change.to.jogo !== 'N/A') {
        corpo += `⏱️ ATIVIDADE: Jogando ativamente\n`;
      } else if (change.to.status === 'Online') {
        corpo += `🟢 ATIVIDADE: Online no Roblox\n`;
      } else if (change.to.status === 'Offline') {
        corpo += `🔴 ATIVIDADE: Desconectado\n`;
      }

      corpo += '\n' + '-'.repeat(40) + '\n\n';
    }

    corpo += `🕐 Relatório gerado em: ${applyTimezoneOffset(
      new Date()
    ).toLocaleString('pt-BR')}\n`;
    corpo += '🤖 Monitor Roblox - Sistema Automático';

    // Configurar transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
      },
    });

    // Enviar email
    await transporter.sendMail({
      from: `"🎮 Monitor Roblox" <${EMAIL_USER}>`,
      to: EMAIL_TO,
      subject: `🔔 Atividade Roblox Detectada - ${changes.length} mudança(s)`,
      text: corpo,
    });

    console.log('📧 Email enviado com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao enviar email:', error);
  }
}

// ===== FUNCIONALIDADE DE NOTIFICAÇÃO POR EMAIL =====

async function loadPreviousStatus() {
  try {
    const statusFilename = 'status_anterior.json';
    const existing = await s3Client.send(
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET?.trim(),
        Key: statusFilename,
      })
    );
    const stream = existing.Body;
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString('utf8');
    return JSON.parse(text) || {};
  } catch (err) {
    if (err.name !== 'NoSuchKey') {
      console.log('ℹ️ Erro ao carregar status anterior:', err.message);
    }
    return {};
  }
}

async function savePreviousStatus(statusData) {
  try {
    const statusFilename = 'status_anterior.json';
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET?.trim(),
      Key: statusFilename,
      Body: JSON.stringify(statusData, null, 2),
      ContentType: 'application/json',
    });
    await s3Client.send(command);
    console.log('💾 Status anterior salvo no S3');
  } catch (err) {
    console.error('⚠️ Erro ao salvar status anterior:', err);
  }
}

async function detectChangesAndNotify(currentData) {
  if (!EMAIL_USER || !EMAIL_PASS || !EMAIL_TO) {
    console.log(
      'ℹ️ Credenciais de email não configuradas, pulando notificações'
    );
    return;
  }

  console.log('🔍 Verificando mudanças de status...');

  const statusAnterior = await loadPreviousStatus();
  const mudancas = [];

  for (const entry of currentData) {
    const playerName = entry.player;
    const statusNovo = entry.status;
    const jogoNovo = entry.jogo;
    const tsNovo = entry.updatedAt;
    const chave = playerName;

    const anterior = statusAnterior[chave];
    if (
      !anterior ||
      statusNovo !== anterior.status ||
      jogoNovo !== anterior.jogo
    ) {
      // Mudou!
      mudancas.push({
        jogador: playerName,
        statusNovo,
        jogoNovo,
        tsNovo,
        statusAnt: anterior ? anterior.status : 'Primeira detecção',
        jogoAnt: anterior ? anterior.jogo : 'N/A',
      });

      // Atualizar status salvo
      statusAnterior[chave] = {
        status: statusNovo,
        jogo: jogoNovo,
        timestamp: tsNovo,
      };
    }
  }

  // Salvar status atualizado
  await savePreviousStatus(statusAnterior);

  if (mudancas.length === 0) {
    console.log('ℹ️ Nenhuma mudança de status detectada');
    return;
  }

  console.log(
    `📧 ${mudancas.length} mudança(s) detectada(s), enviando email...`
  );
  await enviarNotificacao(mudancas);
}

async function enviarNotificacao(mudancas) {
  try {
    // Montar corpo do email
    let corpo = '🎮 RELATÓRIO DE ATIVIDADE ROBLOX 🎮\n';
    corpo += '='.repeat(50) + '\n\n';

    if (mudancas.length === 1) {
      corpo += '📊 1 mudança de status detectada:\n\n';
    } else {
      corpo += `📊 ${mudancas.length} mudanças de status detectadas:\n\n`;
    }

    for (const m of mudancas) {
      corpo += `👤 JOGADOR: ${m.jogador}\n`;
      corpo += `📅 QUANDO: ${formatDateTime(m.tsNovo)}\n`;
      corpo += `🔄 MUDANÇA: ${m.statusAnt} → ${m.statusNovo}\n`;

      if (m.jogoNovo !== 'N/A' && m.jogoNovo !== 'Website') {
        corpo += `🎯 JOGO: ${m.jogoNovo}\n`;
      }

      if (m.statusNovo === 'Jogando' && m.jogoNovo !== 'N/A') {
        corpo += `⏱️ ATIVIDADE: Jogando ativamente\n`;
      } else if (m.statusNovo === 'Online') {
        corpo += `🟢 ATIVIDADE: Online no Roblox\n`;
      } else if (m.statusNovo === 'Offline') {
        corpo += `🔴 ATIVIDADE: Desconectado\n`;
      }

      corpo += '\n' + '-'.repeat(40) + '\n\n';
    }

    corpo += `🕐 Relatório gerado em: ${applyTimezoneOffset(
      new Date()
    ).toLocaleString('pt-BR')}\n`;
    corpo += '🤖 Monitor Roblox - Sistema Automático';

    // Configurar transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
      },
    });

    // Enviar email
    await transporter.sendMail({
      from: `"🎮 Monitor Roblox" <${EMAIL_USER}>`,
      to: EMAIL_TO,
      subject: `🔔 Atividade Roblox Detectada - ${mudancas.length} mudança(s)`,
      text: corpo,
    });

    console.log('📧 Email de notificação enviado com sucesso!');
  } catch (err) {
    console.error('❌ Erro ao enviar email:', err);
  }
}

async function main() {
  console.log('📡 Buscando presença dos usuários...');

  try {
    const presence = await getUserPresence(PLAYERS);
    console.log('📥 Presença obtida:', JSON.stringify(presence, null, 2));

    const now = new Date();
    now.setMinutes(now.getMinutes() + TZ_OFFSET_MINUTES);
    const filename = `${formatDate(now)}.json`;

    console.log(`📊 Iniciando processamento para ${filename}...`);
    // Salvar dados diários no formato simplificado
    await saveDailyData(filename, presence);

    console.log(`✅ Processamento concluído para ${filename}`);
    console.log('🏁 Script finalizado com sucesso!');

    // Forçar saída após sucesso
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro no monitor:', error);
    process.exit(1);
  }
}

main();

// Opcional: expor um endpoint mínimo que retorna a data que o backend usa
// para nomear os arquivos (útil para clientes sincronizarem timezone).
// Para ativar, defina EXPOSE_SERVER_DATE=1 no ambiente.
if (process.env.EXPOSE_SERVER_DATE === '1') {
  const port = parseInt(process.env.SERVER_DATE_PORT || '3001', 10);
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/server-date') {
      const now = new Date();
      now.setMinutes(now.getMinutes() + TZ_OFFSET_MINUTES);
      const filename = `${formatDate(now)}.json`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ filename: filename, date: formatDate(now) }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  server.listen(port, () =>
    console.log(
      `🔁 Server-date endpoint listening on http://0.0.0.0:${port}/server-date`
    )
  );
}
