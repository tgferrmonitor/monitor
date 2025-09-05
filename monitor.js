// monitor.js
// Coleta presença de jogadores Roblox e salva relatórios JSON no bucket (Magalu Cloud / S3)

import fs from "fs";
import path from "path";
import fetch from "node-fetch"; // v2
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

// ===== Configs Roblox (via RoProxy para evitar bloqueio) =====
const USERS_ENDPOINT = "https://users.roproxy.com/v1/usernames/users";
const PRESENCE_ENDPOINT = "https://presence.roproxy.com/v1/presence/users";

// ===== Leitura de jogadores =====
async function loadPlayers() {
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(process.cwd(), "players.json"), "utf-8"));
    if (Array.isArray(pj.players) && pj.players.length) return pj.players;
  } catch (_) {}

  const envCsv = process.env.PLAYERS || "";
  const arr = envCsv.split(",").map(s => s.trim()).filter(Boolean);
  if (!arr.length) throw new Error("Nenhum jogador definido. Use players.json ou PLAYERS env.");
  return arr;
}

// ===== Funções auxiliares =====
function getLocalDateKey(d = new Date()) {
  const offsetMin = Number(process.env.TZ_OFFSET_MINUTES || 0);
  const t = new Date(d.getTime() + offsetMin * 60000);
  return t.toISOString().slice(0, 10);
}

// ===== S3 Client =====
const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  credentials: { accessKeyId: process.env.S3_KEY, secretAccessKey: process.env.S3_SECRET },
});

// ===== Busca IDs de jogadores =====
async function getUserIds(usernames) {
  const body = JSON.stringify({ usernames });
  const res = await fetch(USERS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error("Erro ao buscar IDs");
  const data = await res.json();
  return data.data.map(u => ({ username: u.requestedUsername, id: u.id }));
}

// ===== Consulta presença =====
async function getPresence(userIds) {
  const body = JSON.stringify({ userIds });
  const res = await fetch(PRESENCE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error("Erro ao buscar presença");
  const data = await res.json();
  return data.userPresences.map(p => ({
    userId: p.userId,
    presenceType: p.userPresenceType, // 0=offline,1=online,2=ingame,3=studio,4=invisible
    lastLocation: p.lastLocation || null,
    placeId: p.placeId || null,
  }));
}

// ===== Carregar relatório existente =====
async function loadReport(dateKey) {
  const Key = `reports/${dateKey}.json`;
  try {
    const cmd = new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key });
    const res = await s3.send(cmd);
    const txt = await res.Body.transformToString();
    return JSON.parse(txt);
  } catch (_) {
    return { date: dateKey, players: {} };
  }
}

// ===== Salvar relatório =====
async function saveReport(dateKey, report) {
  const Key = `reports/${dateKey}.json`;
  const cmd = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key,
    Body: JSON.stringify(report, null, 2),
    ContentType: "application/json",
  });
  await s3.send(cmd);
}

// ===== Atualizar lógica de sessões =====
function updateReport(report, player, presence) {
  if (!report.players[player.username]) {
    report.players[player.username] = { sessions: [], totalOnline: 0, totalPlaying: 0 };
  }
  const entry = report.players[player.username];
  const lastSession = entry.sessions[entry.sessions.length - 1];
  const now = new Date().toISOString();

  if (presence.presenceType === 0) {
    // Offline
    if (lastSession && !lastSession.end) {
      lastSession.end = now;
      const dur = (new Date(lastSession.end) - new Date(lastSession.start)) / 60000;
      lastSession.totalMinutes = Math.round(dur);
      entry.totalOnline += lastSession.totalMinutes;
      if (lastSession.status === "InGame") entry.totalPlaying += lastSession.totalMinutes;
    }
  } else {
    // Online/InGame/InStudio
    if (!lastSession || lastSession.end) {
      entry.sessions.push({
        start: now,
        end: null,
        status: presence.presenceType === 1 ? "Online" :
                presence.presenceType === 2 ? "InGame" :
                presence.presenceType === 3 ? "InStudio" : "Online",
        game: presence.lastLocation,
      });
    }
  }
}

// ===== Main =====
(async () => {
  const usernames = await loadPlayers();
  const players = await getUserIds(usernames);
  const ids = players.map(p => p.id);
  const presences = await getPresence(ids);

  const dateKey = getLocalDateKey();
  const report = await loadReport(dateKey);

  presences.forEach(p => {
    const player = players.find(pl => pl.id === p.userId);
    updateReport(report, player, p);
  });

  await saveReport(dateKey, report);
  console.log("Relatório atualizado:", dateKey);
})();
