# Nova Lógica de Monitoramento - Cálculo de Tempo Acumulado

## Visão Geral

O sistema foi adaptado para calcular de forma mais eficiente o tempo que cada player passa em diferentes atividades, mantendo um JSON mais enxuto no bucket com base nas seguintes regras:

## Formato do Arquivo JSON

Cada entrada no bucket agora segue o formato:

```json
[
  {
    "player": "Player 123",
    "status": "Jogando",
    "jogo": "[🔪Slasher] Abandonado",
    "countMinutes": 25,
    "updatedAt": "2025-09-07T19:59:35.780Z"
  }
]
```

## Regras de Processamento (PASSO 1)

### 1. Mesmo Status e Mesmo Jogo

- **Condição**: `status` igual E `jogo` igual ao registro anterior
- **Ação**: Calcula o tempo decorrido desde `updatedAt` e soma ao `countMinutes`
- **Resultado**: Tempo acumulado preciso

### 2. Mesmo Status, Jogo Diferente

- **Condição**: `status` igual MAS `jogo` diferente
- **Ação**: Cria novo registro com `countMinutes = 0`
- **Resultado**: Reset do contador para novo jogo

### 3. Status Diferente

- **Condição**: `status` diferente (independente do jogo)
- **Ação**: Cria novo registro com `countMinutes = 0`
- **Resultado**: Reset do contador para nova atividade

### 4. Player Novo

- **Condição**: Player não existe no arquivo do dia
- **Ação**: Cria novo registro com `countMinutes = 0`
- **Resultado**: Início do monitoramento

## Benefícios

1. **JSON Enxuto**: Apenas uma entrada por player por status/jogo
2. **Cálculo Preciso**: Tempo baseado em timestamps reais
3. **Eficiência**: Menos dados armazenados por dia
4. **Flexibilidade**: Fácil de agregar dados posteriormente

## Exemplo de Execução

### Situação Inicial

```json
[
  {
    "player": "Player 123",
    "status": "Jogando",
    "jogo": "[🔪Slasher] Abandonado",
    "countMinutes": 15,
    "updatedAt": "2025-09-07T19:50:00.000Z"
  }
]
```

### Player Continua no Mesmo Jogo (10 minutos depois)

```json
[
  {
    "player": "Player 123",
    "status": "Jogando",
    "jogo": "[🔪Slasher] Abandonado",
    "countMinutes": 25, // 15 + 10 minutos
    "updatedAt": "2025-09-07T20:00:00.000Z"
  }
]
```

### Player Muda de Jogo

```json
[
  {
    "player": "Player 123",
    "status": "Jogando",
    "jogo": "Brookhaven RP",
    "countMinutes": 0, // Reset para novo jogo
    "updatedAt": "2025-09-07T20:00:00.000Z"
  }
]
```

## Implementação

A lógica foi implementada na função `processPlayerData()` no arquivo `monitor.js`, que:

1. Carrega dados existentes do S3
2. Compara status/jogo atual vs anterior
3. Aplica regras de cálculo de tempo
4. Salva JSON atualizado no bucket

## Logs de Monitoramento

O sistema agora fornece logs detalhados:

- `⏱️`: Tempo sendo acumulado (mesmo status/jogo)
- `🔄`: Mudança detectada (reset de contador)
- `🆕`: Novo player detectado
- `✅`: Processamento concluído

Isso permite acompanhar facilmente o que está acontecendo com cada player em tempo real.
