// Necessário: node-fetch@2 e nodemailer instalados
const fs = require('fs');
const nodemailer = require('nodemailer');

// Carrega variáveis de ambiente
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_TO   = process.env.EMAIL_TO;

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
  } catch (e) { statusAnterior = {}; }
}

// Detecta mudanças de status
const mudancas = [];
for (const entry of dataAtual) {
  const jogador = entry.player;
  const statusNovo = entry.status;
  const jogoNovo = entry.jogo;
  const tsNovo = entry.timestamp;
  const chave = `${jogador}`;

  const anterior = statusAnterior[chave];
  if (!anterior || statusNovo !== anterior.status || jogoNovo !== anterior.jogo) {
    // Mudou!
    mudancas.push({
      jogador, statusNovo, jogoNovo, tsNovo,
      statusAnt: anterior ? anterior.status : 'N/A',
      jogoAnt: anterior ? anterior.jogo : 'N/A',
      tsAnt: anterior ? anterior.timestamp : 'N/A'
    });
    // Atualiza status salvo
    statusAnterior[chave] = {
      status: statusNovo,
      jogo: jogoNovo,
      timestamp: tsNovo
    };
  }
}

// Se não houve mudanças, encerra
if (mudancas.length === 0) {
  console.log('Nenhuma mudança de status detectada.');
  process.exit(0);
}

// Monta corpo do e-mail
let corpo = 'Mudança de status detectada:\n\n';
for (const m of mudancas) {
  corpo += `Jogador: ${m.jogador}\nDe: ${m.statusAnt} (${m.jogoAnt}) para: ${m.statusNovo} (${m.jogoNovo})\nQuando: ${m.tsNovo}\n\n`;
}

// Envia e-mail
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
    subject: 'Mudança de status de jogador Roblox!',
    text: corpo
  });
  console.log('E-mail enviado!');
}

// Salva status anterior atualizado para próxima execução
fs.writeFileSync(ARQUIVO_STATUS, JSON.stringify(statusAnterior, null, 2));

// Envia o e-mail
enviaEmail().catch(err => {
  console.error('Erro ao enviar e-mail:', err);
  process.exit(1);
});