import dotenv from 'dotenv';
dotenv.config();
// Necessário: node-fetch@2 e nodemailer instalados
import fs from 'fs';
import nodemailer from 'nodemailer';

// Carrega variáveis de ambiente
const EMAIL_USER = process.env.EMAIL_USER || process.env.S3_EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS || process.env.S3_EMAIL_PASS;
const EMAIL_TO = process.env.EMAIL_TO || process.env.S3_EMAIL_TO;

// Debug das credenciais (remover depois)
console.log('EMAIL_USER:', EMAIL_USER ? 'definido' : 'indefinido');
console.log('EMAIL_PASS:', EMAIL_PASS ? 'definido' : 'indefinido');
console.log('EMAIL_TO:', EMAIL_TO ? 'definido' : 'indefinido');

// Carregar mapeamento de players
let playersMap = new Map();
try {
  const playersData = JSON.parse(fs.readFileSync('./players.json', 'utf8'));

  // Formato novo: array de objetos {id, name, displayName}
  if (playersData.players && Array.isArray(playersData.players)) {
    for (const player of playersData.players) {
      if (typeof player === 'object' && player.id) {
        // Usar displayName se disponível, senão name, senão o próprio ID
        const playerName =
          player.displayName || player.name || String(player.id);
        playersMap.set(String(player.id), playerName);
      } else if (typeof player === 'string') {
        // Formato antigo: array de strings (IDs/nomes)
        playersMap.set(String(player), player);
      }
    }
  }

  console.log(`📝 Mapeamento de players carregado: ${playersMap.size} players`);
  if (playersMap.size > 0) {
    console.log('🎯 Players encontrados:', Array.from(playersMap.entries()));
  }
} catch (err) {
  console.log('ℹ️ Arquivo players.json não encontrado, usando IDs como nomes');
  console.error('Erro ao carregar players:', err.message);
}

function getPlayerName(userId) {
  // Remove "Player " do início se existir para pegar apenas o ID
  const cleanId = userId.replace('Player ', '');
  return playersMap.get(cleanId) || userId;
}

function formatDateTime(dateString) {
  if (!dateString || dateString === 'undefined') {
    return new Date().toLocaleString('pt-BR');
  }
  try {
    return new Date(dateString).toLocaleString('pt-BR');
  } catch (e) {
    return new Date().toLocaleString('pt-BR');
  }
}

// Carrega arquivo do dia
let dataAtual = [];
try {
  dataAtual = JSON.parse(fs.readFileSync('daily.json', 'utf-8'));
} catch (e) {
  console.error('Arquivo daily.json não encontrado ou inválido');
  process.exit(1);
}

// Carrega status anterior
const ARQUIVO_STATUS = '.github/scripts/status_anterior.json';
let statusAnterior = {};
if (fs.existsSync(ARQUIVO_STATUS)) {
  try {
    statusAnterior = JSON.parse(fs.readFileSync(ARQUIVO_STATUS, 'utf-8'));
  } catch (e) {
    statusAnterior = {};
  }
}

// Detecta mudanças de status
const mudancas = [];
for (const entry of dataAtual) {
  const jogador = getPlayerName(entry.player);
  const statusNovo = entry.status;
  const jogoNovo = entry.jogo;
  const tsNovo = entry.updatedAt || entry.timestamp || new Date().toISOString(); // Usar updatedAt primeiro
  const chave = entry.player; // Usar o ID original como chave

  const anterior = statusAnterior[chave];
  if (
    !anterior ||
    statusNovo !== anterior.status ||
    jogoNovo !== anterior.jogo
  ) {
    // Mudou!
    mudancas.push({
      jogador,
      statusNovo,
      jogoNovo,
      tsNovo,
      statusAnt: anterior ? anterior.status : 'Primeira detecção',
      jogoAnt: anterior ? anterior.jogo : 'N/A',
      tsAnt: anterior ? anterior.timestamp : 'N/A',
    });
    // Atualiza status salvo
    statusAnterior[chave] = {
      status: statusNovo,
      jogo: jogoNovo,
      timestamp: tsNovo,
    };
  }
}

// Se não houve mudanças, encerra
if (mudancas.length === 0) {
  console.log('Nenhuma mudança de status detectada.');
  process.exit(0);
}

// Monta corpo do e-mail
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

corpo += `🕐 Relatório gerado em: ${new Date().toLocaleString('pt-BR')}\n`;
corpo += '🤖 Monitor Roblox - Sistema Automático';

// Envia e-mail
async function enviaEmail() {
  let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS,
    },
  });

  await transporter.sendMail({
    from: `"🎮 Monitor Roblox" <${EMAIL_USER}>`,
    to: EMAIL_TO,
    subject: `🔔 Atividade Roblox Detectada - ${mudancas.length} mudança(s)`,
    text: corpo,
  });
  console.log('📧 E-mail enviado com sucesso!');
}

// Salva status anterior atualizado para próxima execução
fs.writeFileSync(ARQUIVO_STATUS, JSON.stringify(statusAnterior, null, 2));

// Envia o e-mail
enviaEmail().catch((err) => {
  console.error('Erro ao enviar e-mail:', err);
  process.exit(1);
});
