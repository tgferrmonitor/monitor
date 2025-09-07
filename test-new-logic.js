import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Simular a nova lógica de processamento
function simulatePlayerData(existingData, presenceData, statusMap) {
  const currentTime = new Date().toISOString();
  const updatedData = [];

  console.log(
    `🧪 TESTE: Processando dados para ${
      presenceData.userPresences?.length || 0
    } players...`
  );
  console.log(`📅 Hora atual: ${currentTime}`);
  console.log(`📊 Dados existentes:`, JSON.stringify(existingData, null, 2));

  // Processar cada player da presença atual
  for (const info of presenceData.userPresences || []) {
    const playerName = `Player ${info.userId}`; // Simplificado para teste
    const status = statusMap[info.userPresenceType] || 'Desconhecido';
    const jogo = info.lastLocation || 'N/A';

    // Encontrar entrada existente para este player
    const existingEntry = existingData.find(
      (entry) => entry.player === playerName
    );

    if (existingEntry) {
      console.log(`\n🔍 Player encontrado: ${playerName}`);
      console.log(
        `   Status anterior: ${existingEntry.status}, atual: ${status}`
      );
      console.log(`   Jogo anterior: ${existingEntry.jogo}, atual: ${jogo}`);

      if (existingEntry.status === status && existingEntry.jogo === jogo) {
        // Mesmo status e mesmo jogo: calcular minutos baseado na diferença de tempo
        const lastUpdate = new Date(existingEntry.updatedAt);
        const now = new Date(currentTime);
        const minutesDiff = Math.floor((now - lastUpdate) / (1000 * 60));
        const newCountMinutes = (existingEntry.countMinutes || 0) + minutesDiff;

        console.log(
          `   ⏱️ MESMO STATUS/JOGO: +${minutesDiff} min (total: ${newCountMinutes})`
        );

        updatedData.push({
          player: playerName,
          status: status,
          jogo: jogo,
          countMinutes: newCountMinutes,
          updatedAt: currentTime,
        });
      } else {
        // Status diferente OU jogo diferente: começar novo nó com 0 minutos
        console.log(`   🔄 MUDANÇA DETECTADA: Resetando contador para 0`);

        updatedData.push({
          player: playerName,
          status: status,
          jogo: jogo,
          countMinutes: 0,
          updatedAt: currentTime,
        });
      }
    } else {
      // Player novo: criar entrada com 0 minutos
      console.log(`\n🆕 NOVO PLAYER: ${playerName} - ${status} em ${jogo}`);

      updatedData.push({
        player: playerName,
        status: status,
        jogo: jogo,
        countMinutes: 0,
        updatedAt: currentTime,
      });
    }
  }

  console.log(`\n✅ RESULTADO FINAL:`, JSON.stringify(updatedData, null, 2));
  return updatedData;
}

// Mapear status codes para strings legíveis
const statusMap = {
  0: 'Offline',
  1: 'Online',
  2: 'Jogando',
  3: 'No Studio',
  4: 'Invisível',
};

// Cenário de teste 1: Player continuando no mesmo jogo
console.log('='.repeat(60));
console.log('CENÁRIO 1: Player continuando no mesmo jogo (deve somar minutos)');
console.log('='.repeat(60));

const existingData1 = [
  {
    player: 'Player 123',
    status: 'Jogando',
    jogo: '[🔪Slasher] Abandonado',
    countMinutes: 15,
    updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 minutos atrás
  },
];

const presenceData1 = {
  userPresences: [
    {
      userId: 123,
      userPresenceType: 2, // Jogando
      lastLocation: '[🔪Slasher] Abandonado',
    },
  ],
};

simulatePlayerData(existingData1, presenceData1, statusMap);

// Cenário de teste 2: Player mudou de jogo
console.log('\n' + '='.repeat(60));
console.log('CENÁRIO 2: Player mudou de jogo (deve resetar contador)');
console.log('='.repeat(60));

const existingData2 = [
  {
    player: 'Player 123',
    status: 'Jogando',
    jogo: '[🔪Slasher] Abandonado',
    countMinutes: 25,
    updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutos atrás
  },
];

const presenceData2 = {
  userPresences: [
    {
      userId: 123,
      userPresenceType: 2, // Jogando
      lastLocation: 'Brookhaven RP',
    },
  ],
};

simulatePlayerData(existingData2, presenceData2, statusMap);

// Cenário de teste 3: Player mudou de status
console.log('\n' + '='.repeat(60));
console.log('CENÁRIO 3: Player mudou de status (deve resetar contador)');
console.log('='.repeat(60));

const existingData3 = [
  {
    player: 'Player 123',
    status: 'Jogando',
    jogo: '[🔪Slasher] Abandonado',
    countMinutes: 30,
    updatedAt: new Date(Date.now() - 7 * 60 * 1000).toISOString(), // 7 minutos atrás
  },
];

const presenceData3 = {
  userPresences: [
    {
      userId: 123,
      userPresenceType: 1, // Online (não jogando)
      lastLocation: 'N/A',
    },
  ],
};

simulatePlayerData(existingData3, presenceData3, statusMap);

// Cenário de teste 4: Player novo
console.log('\n' + '='.repeat(60));
console.log('CENÁRIO 4: Player novo (deve começar com 0 minutos)');
console.log('='.repeat(60));

const existingData4 = []; // Sem dados existentes

const presenceData4 = {
  userPresences: [
    {
      userId: 456,
      userPresenceType: 2, // Jogando
      lastLocation: 'Adopt Me!',
    },
  ],
};

simulatePlayerData(existingData4, presenceData4, statusMap);
