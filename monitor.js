import https from "https";
import fetch from "node-fetch";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";

dotenv.config();

// Configurar cliente S3
const s3Client = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_KEY,
    secretAccessKey: process.env.S3_SECRET,
  },
  forcePathStyle: true,
});

// Carregar configs
const PLAYERS = JSON.parse(process.env.PLAYERS || "[]");
const ROBLOSECURITY = process.env.ROBLOSECURITY;
const TZ_OFFSET_MINUTES = parseInt(process.env.TZ_OFFSET_MINUTES || "0", 10);

// HTTPS Agent para ignorar certificados inválidos
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function getUserPresence(userIds) {
  if (!userIds || userIds.length === 0) {
    throw new Error("userIds não pode ser vazio.");
  }

  const res = await fetch("https://presence.roblox.com/v1/presence/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `.ROBLOSECURITY=${ROBLOSECURITY}`,
      "User-Agent": "Mozilla/5.0",
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
    Key: `reports/${filename}`,
    Body: JSON.stringify(data, null, 2),
    ContentType: "application/json",
  });

  await s3Client.send(command);
  console.log(`✅ Arquivo salvo no bucket como: reports/${filename}`);
}

function formatDate(date) {
  const pad = (n) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function main() {
  console.log("📡 Buscando presença dos usuários...");

  try {
    const presence = await getUserPresence(PLAYERS);
    console.log("📥 Presença obtida:", JSON.stringify(presence, null, 2));

    const now = new Date();
    now.setMinutes(now.getMinutes() + TZ_OFFSET_MINUTES);
    const filename = `${formatDate(now)}.json`;

    await saveToS3(filename, presence);
  } catch (error) {
    console.error("❌ Erro no monitor:", error);
  }
}

main();
