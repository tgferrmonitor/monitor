import fetch from "node-fetch";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";

dotenv.config();

const s3Client = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_KEY,
    secretAccessKey: process.env.S3_SECRET,
  },
  forcePathStyle: true,
});

const PLAYERS = JSON.parse(process.env.PLAYERS || "[]");
const ROBLOSECURITY = process.env.ROBLOSECURITY;
const TZ_OFFSET_MINUTES = parseInt(process.env.TZ_OFFSET_MINUTES || "0", 10);

async function getUserPresence(userIds) {
  if (!userIds || userIds.length === 0) throw new Error("User IDs cannot be empty");

  const idsString = userIds.join(",");
  const url = `https://presence.roblox.com/v1/presence/users?userIds=${idsString}`;

  const res = await fetch(url, {
    headers: {
      cookie: `.ROBLOSECURITY=${ROBLOSECURITY}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Erro ao buscar IDs: ${res.status} - ${errorBody}`);
  }

  return await res.json();
}

async function saveToS3(filename, data) {
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: filename,
    Body: JSON.stringify(data, null, 2),
    ContentType: "application/json",
  });

  await s3Client.send(command);
  console.log(`Arquivo salvo no bucket em ${filename}`);
}

function formatDate(date) {
  const pad = (n) => n.toString().padStart(2, "0");
  return (
    date.getFullYear() +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate())
  );
}

async function main() {
  console.log("Buscando presença dos usuários...");

  try {
    const presence = await getUserPresence(PLAYERS);
    console.log("Presença obtida:", JSON.stringify(presence, null, 2));

    // Salvar no bucket S3 com nome de arquivo por data
    const now = new Date();
    now.setMinutes(now.getMinutes() + TZ_OFFSET_MINUTES); // aplicar timezone se precisar
    const filename = `presence-${formatDate(now)}.json`;

    await saveToS3(filename, presence);
  } catch (error) {
    console.error("Erro no monitor:", error);
  }
}

main();
