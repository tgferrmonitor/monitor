// Debug script para testar a lógica de data do frontend

// Função original do frontend
function setTodayInputs() {
  // Usar o mesmo timezone offset que o backend (-180 minutos = GMT-3)
  const TZ_OFFSET_MINUTES = -180;
  const now = new Date();
  now.setMinutes(now.getMinutes() + TZ_OFFSET_MINUTES);

  const pad = (n) => n.toString().padStart(2, '0');
  const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}`;

  console.log('Frontend setTodayInputs():');
  console.log('  - Data atual UTC:', new Date().toISOString());
  console.log('  - TZ_OFFSET_MINUTES:', TZ_OFFSET_MINUTES);
  console.log('  - Data com offset:', now.toISOString());
  console.log('  - ISO date gerado:', iso);

  return iso;
}

function convertToDDMMYYYY(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return `${day}-${month}-${year}`;
}

// Testar
const isoDate = setTodayInputs();
const ddmmyyyy = convertToDDMMYYYY(isoDate);

console.log('\nResultado final:');
console.log('  - ISO:', isoDate);
console.log('  - DD-MM-YYYY:', ddmmyyyy);
console.log('  - URL seria:', `hours_${ddmmyyyy}.json`);

// Comparar com backend
console.log('\n--- Comparação com backend ---');
const backendNow = new Date();
const TZ_OFFSET_BACKEND = -180; // do .env
backendNow.setMinutes(backendNow.getMinutes() + TZ_OFFSET_BACKEND);

function formatDate(date) {
  const pad = (n) => n.toString().padStart(2, '0');
  return `${pad(date.getDate())}-${pad(
    date.getMonth() + 1
  )}-${date.getFullYear()}`;
}

const backendDate = formatDate(backendNow);
console.log('Backend formatDate():', backendDate);
console.log('Frontend DD-MM-YYYY:', ddmmyyyy);
console.log('São iguais?', backendDate === ddmmyyyy);
