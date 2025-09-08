import fs from 'fs';
import nodemailer from 'nodemailer';

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_TO   = process.env.EMAIL_TO;

let dataAtual = [];
try {
  dataAtual = JSON.parse(fs.readFileSync('daily.json', 'utf-8'));
} catch (e) {
  console.error('Arquivo daily.json não encontrado ou inválido');
  process.exit(1);
}

const ARQUIVO_STATUS = '.github/scripts/status_anterior.json';
let statusAnterior = {};
if (fs.existsSync(ARQUIVO_STATUS)) {
  try {
    statusAnterior = JSON.parse(fs.readFileSync(ARQUIVO_STATUS, 'utf-8'));
  } catch (e) { statusAnterior = {}; }
}

// Filtrar apenas jogadores que estão online ou jogando atualmente
const jogadoresAtivos = dataAtual.filter(entry => 
  entry.status === 'Online' || entry.status === 'Jogando'
);

// Verificar mudanças apenas para jogadores ativos
const mudancasRelevantes = [];
for (const entry of jogadoresAtivos) {
  const jogador = entry.player;
  const statusNovo = entry.status;
  const jogoNovo = entry.jogo;
  const tsNovo = entry.timestamp;
  const chave = `${jogador}`;

  const anterior = statusAnterior[chave];
  
  // Só notificar se:
  // 1. É uma mudança de status (não havia registro anterior)
  // 2. Houve mudança de status offline para online/jogando
  // 3. Houve mudança de jogo enquanto está jogando
  const deveNotificar = !anterior || 
                       (anterior.status !== 'Online' && anterior.status !== 'Jogando' && 
                        (statusNovo === 'Online' || statusNovo === 'Jogando')) ||
                       (statusNovo === 'Jogando' && anterior.status === 'Jogando' && jogoNovo !== anterior.jogo);

  if (deveNotificar) {
    mudancasRelevantes.push({
      jogador, statusNovo, jogoNovo, tsNovo,
      statusAnt: anterior ? anterior.status : 'N/A',
      jogoAnt: anterior ? anterior.jogo : 'N/A',
      tsAnt: anterior ? anterior.timestamp : 'N/A'
    });
  }

  // Atualizar status anterior independentemente de notificação
  statusAnterior[chave] = {
    status: statusNovo,
    jogo: jogoNovo,
    timestamp: tsNovo
  };
}

// Se não houver mudanças relevantes, sair sem enviar email
if (mudancasRelevantes.length === 0) {
  console.log('Nenhuma mudança relevante de status detectada (apenas online/jogando).');
  fs.writeFileSync(ARQUIVO_STATUS, JSON.stringify(statusAnterior, null, 2));
  process.exit(0);
}

// Preparar corpo do email apenas com mudanças relevantes
let corpo = 'Mudança de status detectada (jogadores online/jogando):\n\n';
for (const m of mudancasRelevantes) {
  corpo += `Jogador: ${m.jogador}\nDe: ${m.statusAnt} (${m.jogoAnt}) para: ${m.statusNovo} (${m.jogoNovo})\nQuando: ${m.tsNovo}\n\n`;
}

// Adicionar resumo de jogadores ativos atualmente
corpo += '\n--- RESUMO DOS JOGADORES ATIVOS ---\n';
const jogadoresUnicos = [...new Set(jogadoresAtivos.map(j => j.player))];
for (const jogador of jogadoresUnicos) {
  const atividades = jogadoresAtivos.filter(j => j.player === jogador);
  const ultimaAtividade = atividades[atividades.length - 1]; // Último status
  
  corpo += `\n${jogador}: ${ultimaAtividade.status}`;
  if (ultimaAtividade.status === 'Jogando') {
    corpo += ` (${ultimaAtividade.jogo})`;
  }
  corpo += ` - desde ${ultimaAtividade.timestamp}`;
}

async function enviaEmail() {
  let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS
    }
  });

  await transporter.sendMail({
    from: `"Monitor Roblox" <${EMAIL_USER}>`,
    to: EMAIL_TO,
    subject: 'Jogadores Roblox Online/Jogando!',
    text: corpo
  });
  console.log('E-mail enviado!');
}

// Salvar status atualizado e enviar email
fs.writeFileSync(ARQUIVO_STATUS, JSON.stringify(statusAnterior, null, 2));
enviaEmail().catch(err => {
  console.error('Erro ao enviar e-mail:', err);
  process.exit(1);
});