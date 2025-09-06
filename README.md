```markdown
# monitor
```

Projeto simples para coletar presença de jogadores no Roblox e publicar relatórios JSON em um bucket S3 compatível.

Este repositório contém duas partes principais:

- `monitor.js`: script Node.js que consulta a API de presença do Roblox e grava um arquivo JSON em um bucket S3 (pasta `reports/`).
- `docs/index.html`: visualizador estático que carrega um relatório JSON público hospedado no bucket e gera uma tabela e gráfico.

## Arquitetura - visão rápida

- Coletor (script): `monitor.js` roda periodicamente (cron ou job) para consultar presença de uma lista de jogadores definida em `PLAYERS` (via variável de ambiente). O resultado é gravado no bucket S3 definido pelas variáveis `S3_*`.
- Visualizador (front): `docs/index.html` é um site estático que busca relatórios em `https://<bucket-host>/reports/<YYYY-MM-DD>.json` e exibe dados.

## Dependências principais

- Node.js (v16+ recomendado)
- `@aws-sdk/client-s3`, `node-fetch`, `dotenv` (definidas em `package.json`)

## Como rodar o coletor (`monitor.js`)

1. Copie o arquivo `.env.example` (ou crie um `.env`) com as variáveis abaixo:

```
ROBLOSECURITY=SuaRobloxSecurityCookie
PLAYERS=[12345,67890]
S3_REGION=br-se1
S3_ENDPOINT=https://bucket-tgferr-monitor.br-se1.magaluobjects.com
S3_KEY=SEU_ACCESS_KEY
S3_SECRET=SEU_SECRET_KEY
TZ_OFFSET_MINUTES=0
```

Observações:

- `PLAYERS` deve ser um JSON array serializado (ex.: `[12345, 67890]`).
- `S3_ENDPOINT` no projeto usa um endpoint compatível com objetos (ex.: Magalu Objects). Ajuste conforme seu provedor.

2. Instale dependências:

```bash
npm install
```

3. Execute o script manualmente:

```bash
node monitor.js
```

Automação: o script pode ser disparado via cron, systemd timer ou job em um container. Ele é independente e grava o relatório em `reports/YYYY-MM-DD.json` no bucket.

## Como servir o front (`docs/index.html`)

O front é um site estático. Não abra o arquivo localmente via `file://` pois fetch para um domínio externo pode ser bloqueado por CORS no navegador (ou o navegador bloqueará requisições fetch locais). Use um servidor HTTP estático.

Opções recomendadas (escolha uma):

- Usando `http-server` (npm):

```bash
npx http-server docs -p 8080
# então abra http://localhost:8080
```

- Usando Python (se disponível):

```bash
# Python 3
python3 -m http.server --directory docs 8080
# então abra http://localhost:8080
```

Depois de aberto no navegador, insira a data no seletor e clique em "Carregar"; o front buscará `https://<bucket>/reports/<YYYY-MM-DD>.json` (conforme `BUCKET_URL` embutido em `docs/index.html`).

Se o relatório estiver em um host privado, você pode criar um proxy simples ou tornar os arquivos públicos no bucket.

## Arquivos importantes

- `monitor.js` – coletor/gravador S3. Veja como é feita a requisição para `presence.roblox.com` e o uso de `node-fetch`.
- `package.json` – lista de dependências (sem scripts). O tipo do projeto é `module`.
- `docs/index.html` – visualizador estático (usa Chart.js via CDN). Note que o `BUCKET_URL` está hard-coded no arquivo e pode precisar ser atualizado.

## Debug / dicas

- O script `monitor.js` usa `https.Agent({ rejectUnauthorized: false })` para ignorar problemas de certificado ao buscar a API; em produção, prefira não desabilitar a validação TLS.
- Para logs, rode `node monitor.js` diretamente; mensagens de sucesso e erro são impressas no console.
- Se o upload ao S3 falhar, verifique as credenciais (`S3_KEY`, `S3_SECRET`), o nome do bucket e permissões.

## Exemplo de uso rápido

1. Criar `.env` com as variáveis.
2. `npm install`
3. `node monitor.js` (verifique console e bucket)
4. `npx http-server docs -p 8080` e abra o visualizador

## Como contribuir

- Abra issues descrevendo o problema ou feature.
- Para mudanças em lógica de coleta, modifique `monitor.js` e garanta que os relatórios JSON permaneçam compatíveis com o visualizador.

---

Arquivo gerado automaticamente pelo agente; peça ajustes se quiser mais detalhes ou instruções para deploy em containers.

```
# monitor
monitor
```

## Nota sobre UI / MUI

- MUI (Material-UI) é uma biblioteca de componentes para React. Integrar MUI significa migrar o front estático (`docs/index.html`) para uma pequena aplicação React (por exemplo criada com Vite ou Create React App) e então usar os componentes MUI para construir uma interface mais rica (tabelas, chips, dialogs, etc).
- Alternativas menos invasivas:
  - Usar um CSS framework leve (Bootstrap, Bulma ou Tailwind) diretamente no `docs/index.html` para melhorar a aparência sem reescrever em React.
  - Manter o visual estático atual e, progressivamente, extrair componentes para um pequeno app React quando for conveniente.

Se quiser, eu posso:

- preparar um esqueleto React + MUI em `frontend/` (Vite) que consome os mesmos `reports/*.json` e `players.json`;
- ou aplicar um tema CSS leve no `docs/index.html` agora para melhorar imediatemente a aparência.

## Relatórios de horas e migração

- O prefixo onde os relatórios de horas são gravados é configurável via a variável de ambiente `S3_HOURS_PREFIX` (padrão `reports/hours`).
- Se você prefere manter os relatórios dentro de `reports/` (e não em `reports/hours/`), há um script utilitário para migrar os objetos do bucket:

```bash
# Dry-run (não modifica)
node scripts/migrate-hours-to-reports.js --src=reports/hours --dst=reports

# Executa efetivamente (copia e remove origem)
node scripts/migrate-hours-to-reports.js --no-dryrun --src=reports/hours --dst=reports
```

Use com cuidado e confira os logs; o script respeita as credenciais definidas no `.env`.
