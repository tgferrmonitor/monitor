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
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_KEY,
    secretAccessKey: process.env.S3_SECRET,
  },
  forcePathStyle: true,
  requestHandler: new NodeHttpHandler({ httpsAgent }),
});

// Carregar configs
const PLAYERS = JSON.parse(process.env.PLAYERS || '[]');
const ROBLOSECURITY = process.env.ROBLOSECURITY;
const TZ_OFFSET_MINUTES = parseInt(process.env.TZ_OFFSET_MINUTES || '0', 10);

// ...existing code...

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

async function saveToS3(filename, data) {
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: `results_${filename}`,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json',
  });

  try {
    await s3Client.send(command);
  } catch (err) {
    console.error('Erro ao enviar para S3:', err);
    throw err;
  }
  console.log(`✅ Arquivo salvo no bucket como: results_${filename}`);
}

// Helper: read JSON object from S3 key, returns null if not exists
async function getJsonFromS3(key) {
  try {
    const res = await s3Client.send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key })
    );
    const stream = res.Body;
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString('utf8');
    return JSON.parse(text);
  } catch (err) {
    if (err.name === 'NoSuchKey') {
      return null;
    }
    console.error('Erro ao ler S3:', err);
    throw err;
  }
}

// Atualiza relatório diário de horas: incrementa N minutos (padrão 5) para usuários ativos
async function updateDailyHours(presenceData, minutesIncrement = 5) {
  try {
    const now = new Date();
    now.setMinutes(now.getMinutes() + TZ_OFFSET_MINUTES);
    const filename = `${formatDate(now)}.json`;
    const key = `hours_${filename}`;

    const existing = (await getJsonFromS3(key)) || {
      date: filename.replace('.json', ''),
      minutesByUser: {},
      lastUpdatedAt: null,
    };

    const activeTypes = new Set([1, 2, 3]); // Online, InGame, InStudio considered active

    // Evita duplicação: se o arquivo foi atualizado recentemente (menos que windowMinutes), não incrementa
    const windowMinutes = 4; // tolerância menor que 5min cron
    if (existing.lastUpdatedAt) {
      const last = new Date(existing.lastUpdatedAt);
      const diffMin = (now - last) / (1000 * 60);
      if (diffMin < windowMinutes) {
        console.log(
          `⚠️ Ignorando incremento: última atualização há ${diffMin.toFixed(
            2
          )} minutos (< ${windowMinutes})`
        );
        // Regrava para atualizar hoursByUser field
        const hoursByUser = {};
        for (const [uid, mins] of Object.entries(existing.minutesByUser)) {
          hoursByUser[uid] = Math.round((mins / 60) * 100) / 100;
        }
        const payload = {
          date: existing.date,
          minutesByUser: existing.minutesByUser,
          hoursByUser,
          lastUpdatedAt: existing.lastUpdatedAt,
        };
        await s3Client.send(
          new PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: key,
            Body: JSON.stringify(payload, null, 2),
            ContentType: 'application/json',
          })
        );
        console.log(`ℹ️ Regravado relatório diário sem incremento: ${key}`);
        return;
      }
    }

    for (const info of presenceData.userPresences || []) {
      const userId = String(info.userId);
      if (activeTypes.has(info.userPresenceType)) {
        existing.minutesByUser[userId] =
          (existing.minutesByUser[userId] || 0) + minutesIncrement;
      }
    }

    // Also compute hours convenience field (rounded to 2 decimals)
    const hoursByUser = {};
    for (const [uid, mins] of Object.entries(existing.minutesByUser)) {
      hoursByUser[uid] = Math.round((mins / 60) * 100) / 100;
    }

    const payload = {
      date: existing.date,
      minutesByUser: existing.minutesByUser,
      hoursByUser,
      lastUpdatedAt: now.toISOString(),
    };

    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: JSON.stringify(payload, null, 2),
        ContentType: 'application/json',
      })
    );
    console.log(`✅ Relatório diário de horas atualizado: ${key}`);
  } catch (err) {
    console.error('Erro ao atualizar relatório diário de horas:', err);
  }
}

function formatDate(date) {
  const pad = (n) => n.toString().padStart(2, '0');
  return `${pad(date.getDate())}-${pad(
    date.getMonth() + 1
  )}-${date.getFullYear()}`;
}

async function main() {
  console.log('📡 Buscando presença dos usuários...');

  try {
    const presence = await getUserPresence(PLAYERS);
    console.log('📥 Presença obtida:', JSON.stringify(presence, null, 2));

    const now = new Date();
    now.setMinutes(now.getMinutes() + TZ_OFFSET_MINUTES);
    const filename = `${formatDate(now)}.json`;

    await saveToS3(filename, presence);
    // Atualiza o relatório diário de horas (incremento por execução do cron)
    await updateDailyHours(presence, 5);
  } catch (error) {
    console.error('❌ Erro no monitor:', error);
  }
}

main();
