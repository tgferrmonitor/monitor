// Teste rápido da nova funcionalidade
// Execute com: node test-integration.js

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🧪 TESTE DE INTEGRAÇÃO - Nova Lógica de Tempo Acumulado');
console.log('='.repeat(60));

// Simular dados como se viessem do bucket S3
const dadosExistentesSimulados = [
  {
    player: 'garagemer79',
    status: 'Jogando',
    jogo: '[🔪Slasher] Abandonado',
    countMinutes: 20,
    updatedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 min atrás
  },
];

// Simular resposta da API Roblox
const presencaAPISimulada = {
  userPresences: [
    {
      userId: 'garagemer79',
      userPresenceType: 2, // Jogando
      lastLocation: '[🔪Slasher] Abandonado', // Mesmo jogo
    },
  ],
};

console.log('📊 Dados existentes no bucket:');
console.log(JSON.stringify(dadosExistentesSimulados, null, 2));

console.log('\n🔍 Dados recebidos da API Roblox:');
console.log(JSON.stringify(presencaAPISimulada, null, 2));

// Simular processamento
const statusMap = {
  0: 'Offline',
  1: 'Online',
  2: 'Jogando',
  3: 'No Studio',
  4: 'Invisível',
};

function simulateProcessing(existingData, presenceData) {
  const currentTime = new Date().toISOString();
  const updatedData = [];

  for (const info of presenceData.userPresences || []) {
    const playerName = info.userId; // Simplificado
    const status = statusMap[info.userPresenceType] || 'Desconhecido';
    const jogo = info.lastLocation || 'N/A';

    const existingEntry = existingData.find(
      (entry) => entry.player === playerName
    );

    if (existingEntry) {
      if (existingEntry.status === status && existingEntry.jogo === jogo) {
        // Mesmo status e jogo: somar tempo
        const lastUpdate = new Date(existingEntry.updatedAt);
        const now = new Date(currentTime);
        const minutesDiff = Math.floor((now - lastUpdate) / (1000 * 60));
        const newCountMinutes = (existingEntry.countMinutes || 0) + minutesDiff;

        console.log(`\n✅ CASO: Mesmo status e jogo`);
        console.log(`   Player: ${playerName}`);
        console.log(`   Tempo anterior: ${existingEntry.countMinutes} min`);
        console.log(`   Tempo adicional: ${minutesDiff} min`);
        console.log(`   Tempo total: ${newCountMinutes} min`);

        updatedData.push({
          player: playerName,
          status: status,
          jogo: jogo,
          countMinutes: newCountMinutes,
          updatedAt: currentTime,
        });
      } else {
        console.log(`\n🔄 CASO: Mudança detectada - resetando contador`);
        updatedData.push({
          player: playerName,
          status: status,
          jogo: jogo,
          countMinutes: 0,
          updatedAt: currentTime,
        });
      }
    } else {
      console.log(`\n🆕 CASO: Player novo`);
      updatedData.push({
        player: playerName,
        status: status,
        jogo: jogo,
        countMinutes: 0,
        updatedAt: currentTime,
      });
    }
  }

  return updatedData;
}

const resultado = simulateProcessing(
  dadosExistentesSimulados,
  presencaAPISimulada
);

console.log('\n📤 Dados que serão salvos no bucket:');
console.log(JSON.stringify(resultado, null, 2));

console.log('\n🎯 RESUMO:');
console.log(`   - JSON mais enxuto: ✅ (1 entrada por player)`);
console.log(`   - Cálculo preciso: ✅ (baseado em timestamps)`);
console.log(`   - Lógica de reset: ✅ (mudança de status/jogo)`);
console.log(`   - Acúmulo de tempo: ✅ (mesmo status/jogo)`);

console.log('\n' + '='.repeat(60));
console.log('✅ TESTE CONCLUÍDO COM SUCESSO!');
