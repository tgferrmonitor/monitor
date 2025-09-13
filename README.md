[![Monitor Roblox](https://github.com/tgferrmonitor/monitor/actions/workflows/monitor.yml/badge.svg)](https://github.com/tgferrmonitor/monitor/actions/workflows/monitor.yml)
[![pages-build-deployment](https://github.com/tgferrmonitor/monitor/actions/workflows/pages/pages-build-deployment/badge.svg)](https://github.com/tgferrmonitor/monitor/actions/workflows/pages/pages-build-deployment)

--


Monitor

Projeto simples para registrar e visualizar relatórios de presença/atividade de jogadores.

Principais pontos

- Backend: script principal `monitor.js` processa e persiste dados em `players.json`.
- Frontend: interface estática em `docs/` (abra `docs/index.html` no navegador).

Requisitos

- Node.js (v14+ recomendado)

Uso rápido

1. Instale dependências (se houver):
   npm install
2. Execute o monitor:
   node monitor.js
3. Abra a interface:
   docs/index.html

Arquivos relevantes

- `monitor.js` — coleta/processa dados e grava JSON.
- `players.json` — armazenamento de dados.
- `docs/` — frontend modular (scripts, estilos, componentes).

Licença
Arquivo de licença não incluído; trate como código pessoal.
