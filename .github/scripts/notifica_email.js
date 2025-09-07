const fs = require('fs');
const nodemailer = require('nodemailer');

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

const mudancas = [];
for (const entry of dataAtual) {
  const jogador = entry.player;
  const statusNovo = entry.status;
  const jogoNovo = entry.jogo;
  const tsNovo = entry.timestamp;
  const chave = `${jogador}`;

  const anterior = statusAnterior[chave];
  if (!anterior || statusNovo !== anterior.status || jogoNovo !== anterior.jogo) {
    mudancas.push({
      jogador, statusNovo, jogoNovo, tsNovo,
      statusAnt: anterior ? anterior.status : 'N/A',
      jogoAnt: anterior ? anterior.jogo : 'N/A',
      tsAnt: anterior ? anterior.timestamp : 'N/A'
    });
    statusAnterior[chave] = {
      status: statusNovo,
      jogo: jogoNovo,
      timestamp: tsNovo
    };
  }
}

if (mudancas.length === 0) {
  console.log('Nenhuma mudança de status detectada.');
  process.exit(0);
}

let corpo = 'Mudança de status detectada:\n\n';
for (const m of mudancas) {
  corpo += `Jogador: ${m.jogador}\nDe: ${m.statusAnt} (${m.jogoAnt}) para: ${m.statusNovo} (${m.jogoNovo})\nQuando: ${m.tsNovo}\n\n`;
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
    subject: 'Mudança de status de jogador Roblox!',
    text: corpo
  });
  console.log('E-mail enviado!');
}

fs.writeFileSync(ARQUIVO_STATUS, JSON.stringify(statusAnterior, null, 2));
enviaEmail().catch(err => {
  console.error('Erro ao enviar e-mail:', err);
  process.exit(1);
});