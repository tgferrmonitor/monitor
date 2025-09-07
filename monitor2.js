import https from 'https';
import fetch from 'node-fetch';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import dotenv from 'dotenv';

dotenv.config();

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const s3Client = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_KEY,
    secretAccessKey: process.env.S3_SECRET,
  },
  forcePathStyle: true,
  requestHandler: new NodeHttpHandler({ httpsAgent }),
});

const PLAYERS = JSON.parse(process.env.PLAYERS || '[]');
const ROBLOSECURITY = process.env.ROBLOSECURITY;
const TZ_OFFSET_MINUTES = parseInt(process.env.TZ_OFFSET_MINUTES || '0', 10);

function formatDate(date) {
  const pad = (n) => n.toString().padStart(2, '0');
  const year = date.getFullYear().toString().slice(-2); // YY format
  return `${pad(date.getDate())}${pad(date.getMonth() + 1)}${year}`;
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

// Tempo de cada execução (minutos)
const EXEC_MINUTES = 5;

// Agrega minutos por jogador/jogo/status
function aggregateMinutes(existingData, presenceData) {
  // Mapa para controlar minutos acumulados por jogador/jogo
  const minutesMap = {};

  // Carrega histórico já salvo
  for (const entry of existingData) {
    const key = `${entry.player}|${entry.jogo}`;
    if (!minutesMap[key]) {
      minutesMap[key] = { player: entry.player, jogo: entry.jogo, minutos: 0 };
    }
    // Se status for Jogando, soma minutos
    if (entry.status === 'Jogando') {
      minutesMap[key].minutos += EXEC_MINUTES;
    }
  }

  // Adiciona novas presenças
  const now = new Date().toISOString();
  for (const info of presenceData.userPresences || []) {
    const player = `Player ${info.userId}`;
    const jogo = info.lastLocation || 'N/A';
    const status =
      info.userPresenceType === 2
        ? 'Jogando'
        : info.userPresenceType === 1
        ? 'Online'
        : 'Offline';
    const key = `${player}|${jogo}`;
    if (!minutesMap[key]) {
      minutesMap[key] = { player, jogo, minutos: 0 };
    }
    if (status === 'Jogando') {
      minutesMap[key].minutos += EXEC_MINUTES;
    }
    // Adiciona a presença ao histórico
    existingData.push({
      player,
      status,
      jogo,
      timestamp: now,
    });
  }

  // Retorna histórico e agregados
  return {
    history: existingData,
    aggregated: Object.values(minutesMap),
  };
}

async function updateDailyFile(filename, presenceData) {
  let dailyData = [];
  try {
    const existing = await s3Client.send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: filename })
    );
    const stream = existing.Body;
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString('utf8');
    dailyData = JSON.parse(text) || [];
  } catch (err) {
    if (err.name !== 'NoSuchKey') {
      console.error('Erro ao ler dados existentes:', err);
    }
  }

  const { history } = aggregateMinutes(dailyData, presenceData);

  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: filename,
    Body: JSON.stringify(history, null, 2),
    ContentType: 'application/json',
  });

  try {
    await s3Client.send(command);
    console.log(`✅ Histórico e minutos salvos em ${filename}`);
  } catch (err) {
    console.error('Erro ao enviar para S3:', err);
    throw err;
  }
}

async function main() {
  console.log('📡 Buscando presença dos usuários...');
  try {
    const presence = await getUserPresence(PLAYERS);
    const now = new Date();
    now.setMinutes(now.getMinutes() + TZ_OFFSET_MINUTES);
    const filename = `${formatDate(now)}.json`;
    await updateDailyFile(filename, presence);
    console.log(`✅ Processamento concluído para ${filename}`);
  } catch (error) {
    console.error('❌ Erro no monitor:', error);
  }
}

main();