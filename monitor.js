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
  if (!process.env.S3_BUCKET) missing.push('S3_BUCKET');
  if (!process.env.S3_KEY) missing.push('S3_KEY');
  if (!process.env.S3_SECRET) missing.push('S3_SECRET');
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

async function saveDailyData(filename, presenceData) {
  // Buscar dados existentes do dia
  let existingData = [];
  try {
    const existing = await s3Client.send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: filename })
    );
    const stream = existing.Body;
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString('utf8');
    existingData = JSON.parse(text) || [];
  } catch (err) {
    if (err.name !== 'NoSuchKey') {
      console.error('Erro ao ler dados existentes:', err);
    }
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

  // Adicionar novas entradas (cada execução = +5 minutos por player ativo)
  for (const info of presenceData.userPresences || []) {
    // Buscar nome do player usando mapeamento
    const playerName = getPlayerName(info.userId);
    const status = statusMap[info.userPresenceType] || 'Desconhecido';
    const jogo = info.lastLocation || 'N/A';

    // Adicionar entrada (cada linha = +5 minutos para esse player/status)
    existingData.push({
      player: playerName,
      status: status,
      jogo: jogo,
      timestamp: new Date().toISOString(),
    });
  }

  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: filename,
    Body: JSON.stringify(existingData, null, 2),
    ContentType: 'application/json',
  });

  try {
    await s3Client.send(command);
    console.log(
      `✅ Dados salvos: ${filename} (${existingData.length} entradas)`
    );
  } catch (err) {
    console.error('Erro ao enviar para S3:', err);
    throw err;
  }
}

// Funções auxiliares removidas - usando abordagem simplificada

function formatDate(date) {
  const pad = (n) => n.toString().padStart(2, '0');
  const year = date.getFullYear().toString().slice(-2); // YY format
  return `${pad(date.getDate())}${pad(date.getMonth() + 1)}${year}`;
}

async function main() {
  console.log('📡 Buscando presença dos usuários...');

  try {
    const presence = await getUserPresence(PLAYERS);
    console.log('📥 Presença obtida:', JSON.stringify(presence, null, 2));

    const now = new Date();
    now.setMinutes(now.getMinutes() + TZ_OFFSET_MINUTES);
    const filename = `${formatDate(now)}.json`;

    // Salvar dados diários no formato simplificado
    await saveDailyData(filename, presence);

    console.log(`✅ Processamento concluído para ${filename}`);
  } catch (error) {
    console.error('❌ Erro no monitor:', error);
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
