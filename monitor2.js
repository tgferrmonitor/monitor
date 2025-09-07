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

// Função que agrega minutos por jogador/jogo
function updateMinutes(data, presenceData) {
  for (const info of presenceData.userPresences || []) {
    const playerId = String(info.userId);
    const game = info.lastLocation || 'N/A';
    const status = info.userPresenceType;
    // Status 2 = Jogando
    if (status === 2) {
      if (!data[playerId]) data[playerId] = {};
      if (!data[playerId][game]) data[playerId][game] = 0;
      data[playerId][game] += EXEC_MINUTES;
    }
  }
  return data;
}

async function updateDailyMinutes(filename, presenceData) {
  let dailyData = {};
  try {
    const existing = await s3Client.send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: filename })
    );
    const stream = existing.Body;
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString('utf8');
    dailyData = JSON.parse(text) || {};
  } catch (err) {
    // Se arquivo não existe, começa do zero
    if (err.name !== 'NoSuchKey') {
      console.error('Erro ao ler dados existentes:', err);
    }
  }

  dailyData = updateMinutes(dailyData, presenceData);

  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: filename,
    Body: JSON.stringify(dailyData, null, 2),
    ContentType: 'application/json',
  });

  try {
    await s3Client.send(command);
    console.log(`✅ Minutos agregados salvos em ${filename}`);
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
    await updateDailyMinutes(filename, presence);
    console.log(`✅ Processamento concluído para ${filename}`);
  } catch (error) {
    console.error('❌ Erro no monitor:', error);
  }
}

main();