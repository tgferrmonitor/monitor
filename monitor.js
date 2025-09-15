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

// Ambiente de desenvolvimento (não exige S3)
const IS_DEV = process.env.DEV === '1' || process.env.NO_S3 === '1';

// Configurar cliente S3 com NodeHttpHandler usando httpsAgent (pode não ser usado em DEV)
let s3Client = null;
try {
  s3Client = new S3Client({
    region: process.env.S3_REGION?.trim(),
    endpoint: process.env.S3_ENDPOINT?.trim(),
    credentials: {
      accessKeyId: process.env.S3_KEY?.trim(),
      secretAccessKey: process.env.S3_SECRET?.trim(),
    },
  });
} catch (e) {
  // continuará como null em ambientes sem configuração
  s3Client = null;
}

// Carregar configs
// PLAYERS pode ser um JSON array ou uma lista CSV — suportamos ambos para conveniência
let PLAYERS = [];
try {
  const rawPlayers = process.env.PLAYERS || '[]';
  PLAYERS = JSON.parse(rawPlayers);
  if (!Array.isArray(PLAYERS)) PLAYERS = [];
} catch (e) {
  // tentar interpretar como CSV
  const raw = (process.env.PLAYERS || '').trim();
  if (raw) {
    PLAYERS = raw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  } else {
    PLAYERS = [];
  }
}
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
  if (IS_DEV) {
    console.log('⚠️ Rodando em modo DEV/NO_S3 — validação S3 ignorada');
    return;
  }
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

// Se estamos em DEV e não há PLAYERS definidos, permitir execução sem lançar erro
if (IS_DEV && (!PLAYERS || PLAYERS.length === 0)) {
  console.log(
    '⚠️ DEV mode: PLAYERS vazio — o backend continuará, mas não fará chamadas reais de presença'
  );
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
  console.log(res);
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

  // Processa e acumula minutos com base no histórico existente + presença atual
  // processPlayerData retorna um array com entradas atualizadas (incluindo acumulação de minutos)
  const allEntries = await processPlayerData(
    existingData,
    presenceData,
    statusMap
  );

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
      // acumula minutos
      groupedData[player].statuses[status].countMinutes += countMinutes;
      // manter o updateAt mais recente
      try {
        const existingTs =
          new Date(groupedData[player].statuses[status].updateAt).getTime() ||
          0;
        const incomingTs = new Date(updatedAt).getTime() || 0;
        groupedData[player].statuses[status].updateAt = new Date(
          Math.max(existingTs, incomingTs)
        ).toISOString();
      } catch (e) {
        groupedData[player].statuses[status].updateAt = updatedAt;
      }
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
    if (IS_DEV || !s3Client) {
      console.log(
        'ℹ️ Modo DEV/NO_S3 ativo ou S3 não configurado — salvando somente localmente'
      );
      const fs = await import('fs/promises');
      await fs.writeFile(
        `./docs/${filename}`,
        JSON.stringify(groupedData, null, 2),
        'utf8'
      );
      console.log(`� Cópia local gravada em ./docs/${filename}`);
      console.log('✅ (DEV) Processo de salvamento completo!');
    } else {
      console.log('�📤 Enviando dados agrupados para S3...');
      await s3Client.send(command);
      console.log(`✅ Dados salvos: ${filename}`);
      console.log('🎯 Processo de salvamento completo!');
      // Também gravar uma cópia local em docs/ para facilitar testes locais (frontend pode carregar o arquivo diretamente)
      try {
        const fs = await import('fs/promises');
        await fs.writeFile(
          `./docs/${filename}`,
          JSON.stringify(groupedData, null, 2),
          'utf8'
        );
        console.log(`💾 Cópia local gravada em ./docs/${filename}`);
      } catch (werr) {
        console.log(
          'ℹ️ Não foi possível gravar cópia local:',
          werr.message || werr
        );
      }
    }
  } catch (err) {
    console.error('Erro ao enviar para S3/local:', err);
    if (!IS_DEV) throw err;
  }
}

async function processPlayerData(existingData, presenceData, statusMap) {
  // Agora -> usar o algoritmo pedido:
  // 1) obter último updatedAt entre os status gravados do jogador
  // 2) calcular minutos entre esse updatedAt e agora
  // 3) somar esses minutos no status retornado pelo endpoint (criar se necessário)
  // Use UTC now for stored timestamps to avoid confusion; timezone offset only for display
  const nowDate = new Date();
  const nowISO = nowDate.toISOString();

  // Começa com cópia dos eventos anteriores
  const updatedData = [...existingData];

  console.log(
    `🔄 Processando dados para ${
      presenceData.userPresences?.length || 0
    } players (algoritmo novo)...`
  );

  for (const info of presenceData.userPresences || []) {
    const playerName = getPlayerName(info.userId);
    const returnedStatus = statusMap[info.userPresenceType] || 'Desconhecido';
    const returnedJogo =
      returnedStatus === 'Jogando' ? info.lastLocation || '' : '';

    // Encontrar todas as entradas existentes para esse player
    const playerEntries = (existingData || []).filter(
      (e) => e.player === playerName
    );

    // Determinar lastUpdatedAt (maior) entre as entradas existentes
    let lastUpdatedAt = null;
    for (const e of playerEntries) {
      const ts = e && e.updatedAt ? new Date(e.updatedAt).getTime() : 0;
      if (!lastUpdatedAt || ts > lastUpdatedAt) lastUpdatedAt = ts;
    }

    const minutesDiff = lastUpdatedAt
      ? Math.floor((nowDate.getTime() - lastUpdatedAt) / (1000 * 60))
      : 0;
    const validMinutes = Math.max(0, Math.min(minutesDiff, 60));

    // Procurar se já existe uma entrada gravada para o status retornado (considerando jogo quando apropriado)
    const existsIndex = updatedData.findIndex((e) => {
      if (!e || e.player !== playerName) return false;
      if (e.status !== returnedStatus) return false;
      if (returnedStatus === 'Jogando') return (e.jogo || '') === returnedJogo;
      return true; // para outros status, jogo não importa
    });

    if (existsIndex >= 0) {
      // Soma minutos ao status retornado e atualiza timestamp
      updatedData[existsIndex].countMinutes =
        (updatedData[existsIndex].countMinutes || 0) + validMinutes;
      updatedData[existsIndex].updatedAt = nowISO;
    } else {
      // Cria nova entrada para o status retornado com os minutos calculados
      updatedData.push({
        player: playerName,
        status: returnedStatus,
        jogo: returnedJogo,
        countMinutes: validMinutes,
        updatedAt: nowISO,
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
  // Apenas comparar o último status conhecido por jogador (baseado em updatedAt / updateAt).
  // Usar uma chave canônica por jogador: primeiro tentar extrair ID de 'Player <id>'
  const changes = [];
  const currentTime = new Date().toISOString();

  const eArr = Array.isArray(existingData) ? existingData : [];
  const nArr = Array.isArray(newData) ? newData : [];

  function canonicalKey(playerField) {
    if (!playerField) return null;
    if (/^\d+$/.test(String(playerField))) return String(playerField);
    const m = String(playerField).match(/Player\s*(\d+)/i);
    if (m) return m[1];
    return String(playerField);
  }

  const DEBUG = process.env.DETECT_CHANGES_DEBUG !== '0';

  // Construir um map { chaveCanonica -> lastEntry } a partir de existingData
  const lastExistingByKey = new Map();
  for (const e of eArr) {
    if (!e || !e.player) continue;
    const key = canonicalKey(e.player);
    const ts =
      e.updatedAt || e.updateAt
        ? new Date(e.updatedAt || e.updateAt).getTime()
        : 0;
    const prev = lastExistingByKey.get(key);
    if (!prev || (prev._ts || 0) < ts) {
      lastExistingByKey.set(key, { ...e, _ts: ts });
      if (DEBUG) {
        console.log(
          '[detectChanges][existing] key=',
          key,
          'status=',
          e.status,
          'jogo=',
          e.jogo,
          'ts=',
          new Date(ts).toISOString()
        );
      }
    }
  }

  // Construir um map { chaveCanonica -> lastEntry } a partir de newData
  const lastNewByKey = new Map();
  for (const n of nArr) {
    if (!n || !n.player) continue;
    const key = canonicalKey(n.player);
    const ts =
      n.updatedAt || n.updateAt
        ? new Date(n.updatedAt || n.updateAt).getTime()
        : 0;
    const prev = lastNewByKey.get(key);
    if (!prev || (prev._ts || 0) < ts) {
      lastNewByKey.set(key, { ...n, _ts: ts });
      if (DEBUG) {
        console.log(
          '[detectChanges][new] key=',
          key,
          'status=',
          n.status,
          'jogo=',
          n.jogo,
          'ts=',
          new Date(ts).toISOString()
        );
      }
    }
  }

  // Comparar últimos estados por chave canônica
  for (const [key, newEntry] of lastNewByKey.entries()) {
    const existingEntry = lastExistingByKey.get(key);
    const playerLabel = newEntry.player || existingEntry?.player || key;
    if (DEBUG) {
      console.log(
        '[detectChanges][compare] key=',
        key,
        'existing=',
        existingEntry
          ? `${existingEntry.status}/${existingEntry.jogo}`
          : 'NONE',
        'new=',
        `${newEntry.status}/${newEntry.jogo}`
      );
    }

    if (!existingEntry) {
      // Só considerar novo se status/jogo estiverem definidos
      if (newEntry.status || newEntry.jogo) {
        changes.push({
          player: playerLabel,
          changeType: 'new',
          from: { status: 'N/A', jogo: 'N/A' },
          to: { status: newEntry.status, jogo: newEntry.jogo },
          timestamp: currentTime,
        });
      }
      continue;
    }

    // Comparar somente status e jogo — ignorar countMinutes/updatedAt
    const existingStatus = existingEntry.status || '';
    const existingJogo = existingEntry.jogo || '';
    const newStatus = newEntry.status || '';
    const newJogo = newEntry.jogo || '';

    if (existingStatus !== newStatus || existingJogo !== newJogo) {
      changes.push({
        player: playerLabel,
        changeType: 'change',
        from: { status: existingStatus, jogo: existingJogo },
        to: { status: newStatus, jogo: newJogo },
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
