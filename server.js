const WebSocket = require("ws");
const http = require("http");
const fs = require("fs"); // <--- MÓDULO NATIVO
const path = require("path"); // <--- MÓDULO NATIVO
const { v4: uuidv4 } = require("uuid");

// --- Configuração da Porta ---
const PORT = process.env.PORT || 8080;

// --- 1. Cria um Servidor HTTP NATIVO ---
const server = http.createServer((req, res) => {
  // ESSENCIAL: Responde ao Health Check do Render
  if (req.url === "/") {
    const filePath = path.join(__dirname, "index.html"); // Tenta ler o arquivo index.html

    fs.readFile(filePath, (err, data) => {
      if (err) {
        console.error("Erro ao ler index.html:", err);
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Erro interno do servidor.");
      } else {
        // SUCESSO: Envia o arquivo HTML
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data);
      }
    });
  } else {
    // Para qualquer outra rota (Health Check do Render, etc.)
    res.writeHead(404);
    res.end("Não encontrado.");
  }
});

// --- 2. Anexa o Servidor WebSocket ao Servidor HTTP ---
// O 'ws' usará o objeto 'server' para lidar com a requisição de Upgrade.
const wss = new WebSocket.Server({ server });

// --- 3. Inicia o Servidor HTTP para escutar na porta ---
server.listen(PORT, () => {
  console.log(`🚀 Servidor HTTP/WS rodando na porta ${PORT}`);
});

const WIDTH = 800;
const HEIGHT = 500;
const DIAGONAL_FACTOR = 0.7071; // Fator para manter a velocidade constante na diagonal (1 / sqrt(2))

// --- NOVAS CONSTANTES DE BOT/TIMES ---
const BOT_IDS = [
  "bot-player-001",
  "bot-player-002",
  "bot-player-003",
  "bot-player-004",
]; // Máximo de 4 bots
const MAX_BOTS = BOT_IDS.length;
const MAX_TEAM_SIZE = 5; // O tamanho final desejado
const MIDFIELD_X = WIDTH / 2; // 400

const BOT_SPEED = 2; // Um pouco mais lento que o humano
const BOT_KICK_DISTANCE = 40; // O Bot chuta quando a bola está próxima
const BOT_KICK_ERROR_MAX = 100; // NOVO: Erro máximo no chute do Bot (em pixels)

// CONSTANTES DE GOL AJUSTADAS
const GOAL_HEIGHT = 100; // Gol de 100px de altura
const GOAL_TOP = (HEIGHT - GOAL_HEIGHT) / 2; // (500 - 100) / 2 = 200
const GOAL_BOTTOM = GOAL_TOP + GOAL_HEIGHT; // 200 + 100 = 300

const PLAYER_RADIUS = 15; // Raio do jogador consistente

const usedNumbers = {
  team1: new Set(),
  team2: new Set(),
};

let players = {};
let bola = {
  x: WIDTH / 2,
  y: HEIGHT / 2,
  vx: 0,
  vy: 0,
  raio: 10,
  lastTouchId: null,
  lastTouchName: null,
};

// --- POSIÇÕES INICIAIS ATUALIZADAS PARA 5 JOGADORES ---
const team1Positions = [
  { x: 100, y: 150 }, // Zagueiro A
  { x: 100, y: 350 }, // Zagueiro B
  { x: 250, y: 250 }, // Meio-campo Central
  { x: 250, y: 100 }, // Lateral A
  { x: 250, y: 400 }, // Lateral B
];

// Time 2 (Direita) - Posições espelhadas
const team2Positions = [
  { x: 700, y: 150 },
  { x: 700, y: 350 },
  { x: 550, y: 250 },
  { x: 550, y: 100 },
  { x: 550, y: 400 },
];
// --- FIM POSIÇÕES INICIAIS ---

let teamCount = { 1: 0, 2: 0 };
const score = { 1: 0, 2: 0 };
let gameTime = 180; // 3 minutos em segundos
let isKickOffActive = false; // NOVO: Controla se o jogo está pausado para o Kick-Off
let kickOffTeam = null; // NOVO: O time que fará a saída de bola (o time que sofreu o gol)
let gameInterval = null;

// Atualiza física da bola a cada frame
setInterval(() => {
    
  if (!isKickOffActive) {
    // A BOLA SÓ SE MOVE SE O KICK-OFF NÃO ESTIVER ATIVO
    bola.x += bola.vx;
    bola.y += bola.vy; // Atrito da bola

    bola.vx *= 0.98;
    bola.vy *= 0.98;
  } else {
    // Se o Kick-off estiver ativo, a bola fica parada e no centro
    bola.x = WIDTH / 2;
    bola.y = HEIGHT / 2;
    bola.vx = 0;
    bola.vy = 0;
  } // ------------------------------------------------------------------ // NOVO: Colisão entre jogadores

  handlePlayerCollisions(); // ------------------------------------------------------------------ // Colisão com a parede esquerda (FORA da área do gol)
  if (bola.x - bola.raio < 0 && (bola.y < GOAL_TOP || bola.y > GOAL_BOTTOM)) {
    bola.vx *= -1;
    bola.x = bola.raio; // Força a bola a sair da parede
  } // Colisão com a parede direita (FORA da área do gol)
  else if (
    bola.x + bola.raio > WIDTH &&
    (bola.y < GOAL_TOP || bola.y > GOAL_BOTTOM)
  ) {
    bola.vx *= -1;
    bola.x = WIDTH - bola.raio; // Força a bola a sair da parede
  } // Colisão com as paredes superior/inferior

  if (bola.y - bola.raio < 0) {
    bola.vy *= -1;
    bola.y = bola.raio; // Força a bola a sair da parede
  } else if (bola.y + bola.raio > HEIGHT) {
    bola.vy *= -1;
    bola.y = HEIGHT - bola.raio; // Força a bola a sair da parede
  } // ------------------------------------------------------------------ // Colisão com jogadores (Bola vs Jogador)

  for (let id in players) {
    const p = players[id];
    let dx = bola.x - p.x;
    let dy = bola.y - p.y;
    let dist = Math.sqrt(dx * dx + dy * dy);
    const playerRadius = PLAYER_RADIUS; // Usa a constante definida no topo

    if (dist < bola.raio + playerRadius) {
      // 15 = raio do jogador
      let angle = Math.atan2(dy, dx);

      const overlap = bola.raio + playerRadius - dist;
      p.x -= Math.cos(angle) * overlap;
      p.y -= Math.sin(angle) * overlap; // É essencial sincronizar a posição corrigida do jogador

      const conductionFactor = 0.3;

      const playerTouchSpeed = 2; // Simula a velocidade do empurrão do jogador

      bola.vy =
        bola.vy * (1 - conductionFactor) +
        Math.sin(angle) * playerTouchSpeed * conductionFactor;
      bola.vx =
        bola.vx * (1 - conductionFactor) +
        Math.cos(angle) * playerTouchSpeed * conductionFactor;

      bola.lastTouchId = id;
      bola.lastTouchName = p.name;

      broadcast({ type: "playerUpdate", player: p });
    }
  } // ------------------------------------------------------------------

  // --- NOVO: Movimento para TODOS os Bots ativos ---
  for (let id in players) {
    if (BOT_IDS.includes(id)) { // Verifica se é um Bot
      handleBotMovement(players[id], bola);
      // Garante que o cliente tenha a nova posição do bot
      broadcast({ type: "playerUpdate", player: players[id] });
    }
  }
  // --- FIM Movimento Bots ---

  // server.js: Modifique a Lógica de GOL (dentro do loop setInterval)

  if (bola.x - bola.raio <= 0 && bola.y >= GOAL_TOP && bola.y <= GOAL_BOTTOM) {
    if (bola.x < 0) {
      score[2]++;
      const scorerName = bola.lastTouchName || "o time"; // NOVO: Checa a regra de 5 gols (Fim de Jogo)

      if (score[2] >= 5) {
        broadcast({ type: "gameOver", score });
        if (gameInterval) clearInterval(gameInterval);
        return;
      } // NOVO: Inicia o Kick-off (Time 1 sofreu, Time 1 faz a saída)

      isKickOffActive = true;
      kickOffTeam = 1;
      resetAllPlayers();

      broadcast({
        type: "scoreUpdate",
        score,
        scorer: scorerName,
        team: 2,
        kickOff: true,
        kickOffTeam: 1,
      });
      resetBola();
      return;
    }
  } // Gol Time 1 (Direita)
  else if (
    bola.x + bola.raio >= WIDTH &&
    bola.y >= GOAL_TOP &&
    bola.y <= GOAL_BOTTOM
  ) {
    if (bola.x > WIDTH) {
      score[1]++;
      const scorerName = bola.lastTouchName || "o time"; // NOVO: Checa a regra de 5 gols (Fim de Jogo)

      if (score[1] >= 5) {
        broadcast({ type: "gameOver", score });
        if (gameInterval) clearInterval(gameInterval);
        return;
      } // NOVO: Inicia o Kick-off (Time 2 sofreu, Time 2 faz a saída)

      isKickOffActive = true;
      kickOffTeam = 2;
      resetAllPlayers();

      broadcast({
        type: "scoreUpdate",
        score,
        scorer: scorerName,
        team: 1,
        kickOff: true,
        kickOffTeam: 2,
      });
      resetBola();
      return;
    }
  } // ------------------------------------------------------------------ // Envia atualização da bola pra todos
  broadcast({ type: "update", bola });
}, 1000 / 60); // Roda a 60 FPS (melhor para física)

// Loop de Tempo e Fim de Jogo (1 FPS)
gameInterval = setInterval(() => {
  if (gameTime > 0) {
    gameTime--;
    broadcast({ type: "update", gameTime }); // Envia o tempo para o cliente
  } else {
    clearInterval(gameInterval);
    broadcast({ type: "gameOver", score });
  }
}, 1000);

wss.on("connection", (ws) => {
  const playerId = uuidv4();

  ws.id = playerId;
  console.log(`🟢 Novo jogador conectado: ${playerId}`); // Envia ID e estado inicial

  ws.send(JSON.stringify({ type: "welcome", playerId }));
  ws.send(JSON.stringify({ type: "stateSync", players, bola }));

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    switch (msg.type) {
      case "restartGame":
        restartGame();
        break;

      case "newPlayer":
        const incomingTeam = msg.player.team; // Pega o time escolhido pelo cliente // ATRIBUIÇÃO DE POSIÇÃO NO SERVIDOR

        if (incomingTeam === 1 || incomingTeam === 2) {
          teamCount[incomingTeam]++;
        } else {
          // Se o time for inválido, defina um padrão seguro (Time 1)
          msg.player.team = 1;
          teamCount[1]++;
        }

        let initialPos; // Usa o time vindo do cliente (e corrigido acima)

        // --- Lógica de Posição Inicial de Novo Jogador Humano ---
        const humanPlayersCount = Object.values(players).filter(p => !BOT_IDS.includes(p.id) && p.team === msg.player.team).length;
        
        if (msg.player.team === 1) {
          // O índice é baseado no número de humanos (já que os bots preenchem as vagas restantes)
          const index = humanPlayersCount % team1Positions.length; 
          initialPos = team1Positions[index] || { x: 150, y: 200 };
        } else {
          const index = humanPlayersCount % team2Positions.length;
          initialPos = team2Positions[index] || { x: 450, y: 200 };
        }
        // --- Fim Lógica Posição ---
        
        // *** CÓDIGO NOVO: ATRIBUIÇÃO DE NÚMERO ***

        const teamIdString = `team${msg.player.team}`;
        const playerNumber = assignUniquePlayerNumber(teamIdString);

        players[playerId] = {
          id: playerId,
          name: msg.player.name,
          team: msg.player.team,
          x: initialPos.x, // POSIÇÃO ATRIBUÍDA PELO SERVIDOR
          y: initialPos.y, // POSIÇÃO ATRIBUÍDA PELO SERVIDOR
          number: playerNumber, // <--- ADICIONA O NÚMERO
        };
        console.log(
          `Jogador ${msg.player.name} (${playerId}) se juntou ao Time ${msg.player.team}`
        );

        broadcast({ type: "newPlayer", player: players[playerId] });
        break;

      case "input":
        const p = players[msg.playerId];
        if (!p) return;
        const speed = 5;
        const playerRadius = PLAYER_RADIUS;

        let dx = 0;
        let dy = 0;
        let finalSpeed = speed; // Lógica para calcular a direção X e Y combinada

        const input = msg.input;

        if (input.includes("up")) dy -= 1;
        if (input.includes("down")) dy += 1;
        if (input.includes("Left")) dx -= 1;
        if (input.includes("Right")) dx += 1; // Se for movimento diagonal, reduz a velocidade

        if (dx !== 0 && dy !== 0) {
          finalSpeed = speed * DIAGONAL_FACTOR;
        } // 1. Calcula a Posição Desejada

        let tempX = p.x + dx * finalSpeed;
        let tempY = p.y + dy * finalSpeed; // ------------------------------------------------------------- // REGRAS DE RESTRIÇÃO DE POSIÇÃO // ------------------------------------------------------------- // 2. Restrição de Meio de Campo (Regra da Saída de Bola)

        if (isKickOffActive) {
          if (p.team === 1) {
            // Time 1 (Esquerda)
            // Não pode ir além do centro.
            // O jogador tem que parar no meio (MIDFIELD_X) MENOS o raio.
            tempX = Math.min(tempX, MIDFIELD_X - playerRadius);
          } else if (p.team === 2) {
            // Time 2 (Direita)
            // Não pode ir aquém do centro.
            // O jogador tem que parar no meio (MIDFIELD_X) MAIS o raio.
            tempX = Math.max(tempX, MIDFIELD_X + playerRadius);
          }
        } // 3. Restrição de Borda do Campo (Garante que o jogador não saia da tela) // Aplica o clamping na posição X (com as restrições de meio de campo já aplicadas em tempX)

        p.x = Math.max(playerRadius, Math.min(tempX, WIDTH - playerRadius)); // Aplica o clamping na posição Y
        p.y = Math.max(playerRadius, Math.min(tempY, HEIGHT - playerRadius)); // Lógica de chute

        if (input === "kick") {
          // ... O código de chute abaixo deve permanecer exatamente como está
          // ... (ele usa p.x e p.y que agora estão atualizados e restritos)
          const dx_kick = bola.x - p.x;
          const dy_kick = bola.y - p.y;
          const dist = Math.sqrt(dx_kick * dx_kick + dy_kick * dy_kick); // Checagem de distância e permissão para chutar

          if (dist < 50) {
            if (isKickOffActive) {
              // Se o Kick-Off estiver ativo, checa se é o time certo
              if (p.team === kickOffTeam) {
                // Time correto iniciando o Kick-Off. O jogo é reativado.
                isKickOffActive = false;
                kickOffTeam = null;
                broadcast({ type: "kickOffStarted" }); // Notifica clientes
              } else {
                return; // Bloqueia o chute do time errado
              }
            } // Aplica o impulso (seja ele um Kick-Off recém-iniciado ou um chute normal)

            const angle = Math.atan2(dy_kick, dx_kick);
            const force = 12; // Força do chute
            bola.vx = Math.cos(angle) * force;
            bola.vy = Math.sin(angle) * force; // Atualiza o último toque

            bola.lastTouchId = p.id;
            bola.lastTouchName = p.name;
          }
        } // envia posição final para todos

        broadcast({ type: "playerUpdate", player: p });
        break;
    }
  });

  ws.on("close", () => {
    const player = players[playerId]; // Precisamos obter o objeto player antes de deletá-lo

    console.log(`🔴 Jogador saiu: ${playerId}`);

    if (player) {
      const teamIdString = `team${player.team}`;
      releasePlayerNumber(teamIdString, player.number); // <--- LIBERA O NÚMERO
    }

    delete players[playerId];
    broadcast({ type: "playerLeft", playerId });
  });
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(data);
  });
}

// Reset da bola no centro
function resetBola() {
  bola.x = WIDTH / 2;
  bola.y = HEIGHT / 2;
  bola.vx = 0;
  bola.vy = 0;
  bola.lastTouchId = null; // NOVO: Limpa o marcador
  bola.lastTouchName = null; // NOVO: Limpa o marcador // broadcast do reset da bola para o cliente
  broadcast({ type: "update", bola });
}

function restartGame() {
  // 1. Resetar placar e tempo
  score[1] = 0;
  score[2] = 0;
  gameTime = 180; // 3 minutos
  isKickOffActive = false; // NOVO: Limpa o estado de Kick-off
  kickOffTeam = null; // NOVO: Limpa o time da saída de bola // 2. Limpar e recriar o loop de tempo

  if (gameInterval) clearInterval(gameInterval);
  gameInterval = setInterval(() => {
    if (gameTime > 0) {
      gameTime--;
      broadcast({ type: "update", gameTime });
    } else {
      // NOVO: Checagem de fim de jogo por tempo (se não for 5x0)
      clearInterval(gameInterval);
      broadcast({ type: "gameOver", score });
    }
  }, 1000); // 3. Resetar a posição dos jogadores

  resetAllPlayers(); // NOVO: Usando a nova função // 4. Resetar bola e notificar todos os clientes

  resetBola();
  broadcast({ type: "gameRestarted", score });
}

// [AJUSTE] - Usa o módulo para circular entre as 5 posições definidas
function resetAllPlayers() {
  // Filtra e separa os jogadores de cada time
  const team1Players = Object.values(players).filter((p) => p.team === 1);
  const team2Players = Object.values(players).filter((p) => p.team === 2);

  // Reposiciona Time 1
  for (let i = 0; i < team1Players.length; i++) {
    const p = team1Players[i];
    // Usa o módulo para circular entre as 5 posições.
    const posIndex = i % team1Positions.length;
    const initialPos = team1Positions[posIndex];

    p.x = initialPos.x;
    p.y = initialPos.y;
    broadcast({ type: "playerUpdate", player: p });
  }

  // Reposiciona Time 2
  for (let i = 0; i < team2Players.length; i++) {
    const p = team2Players[i];
    const posIndex = i % team2Positions.length;
    const initialPos = team2Positions[posIndex];

    p.x = initialPos.x;
    p.y = initialPos.y;
    broadcast({ type: "playerUpdate", player: p });
  }
}

function assignUniquePlayerNumber(teamId) {
  const teamSet = usedNumbers[teamId]; // Define o limite de números (1 a 11)
  const availableNumbers = Array.from({ length: 11 }, (_, i) => i + 1).filter(
    (num) => !teamSet.has(num)
  ); // Se não houver números disponíveis (o que só aconteceria com mais de 11 jogadores), retorna null

  if (availableNumbers.length === 0) {
    return null;
  } // Escolhe um número aleatório entre os disponíveis

  const randomIndex = Math.floor(Math.random() * availableNumbers.length);
  const newNumber = availableNumbers[randomIndex]; // Adiciona o número ao set de usados

  teamSet.add(newNumber);

  return newNumber;
}

// Função para liberar o número quando um jogador desconecta
function releasePlayerNumber(teamId, number) {
  if (number) {
    usedNumbers[teamId].delete(number);
  }
}

function calculateIdealBotPosition(bot, ball) {
  const playerRadius = PLAYER_RADIUS;
  const isBotTeam1 = bot.team === 1; // Determina se a bola está no campo do BOT (DEFESA) ou no campo oposto (ATAQUE)

  const isBallInBotSide = isBotTeam1
    ? ball.x <= MIDFIELD_X
    : ball.x >= MIDFIELD_X;

  let idealX;
  let idealY;
  let xLimit;

  if (isBallInBotSide) {
    // === MODO ZAGUEIRO (DEFESA) ===
    // Objetivo: Ficar entre a bola e o próprio gol.

    const goalX = isBotTeam1 ? 0 : WIDTH;
    const goalY = HEIGHT / 2; // Distância que o Bot tenta manter-se entre a bola e o gol
    const botDistanceToGoal = 150;

    const dxGoal = goalX - ball.x;
    const dyGoal = goalY - ball.y;
    const totalDistance = Math.sqrt(dxGoal * dxGoal + dyGoal * dyGoal);

    if (totalDistance > 0) {
      const ratio = (totalDistance - botDistanceToGoal) / totalDistance;
      idealX = ball.x + dxGoal * ratio;
      idealY = ball.y + dyGoal * ratio;
    } else {
      // Bola parada: volta para a posição defensiva centralizada
      idealX = isBotTeam1 ? WIDTH / 4 : (WIDTH * 3) / 4;
      idealY = HEIGHT / 2;
    } // Limita a posição X ao próprio campo (defesa)

    xLimit = isBotTeam1 ? MIDFIELD_X - playerRadius : MIDFIELD_X + playerRadius;
    idealX = isBotTeam1 ? Math.min(idealX, xLimit) : Math.max(idealX, xLimit);
  } else {
    // === MODO ATACANTE (OFENSIVA) ===
    // Objetivo: Ir atrás da bola no campo adversário.

    // O Bot persegue a bola no campo adversário (posição alvo é a própria bola)
    idealX = ball.x;
    idealY = ball.y; // Limita a posição X ao campo adversário (ataque)

    xLimit = isBotTeam1 ? MIDFIELD_X + playerRadius : MIDFIELD_X - playerRadius;
    idealX = isBotTeam1 ? Math.max(idealX, xLimit) : Math.min(idealX, xLimit); // Aplica uma margem de segurança para evitar que ele fique colado no gol adversário, atrapalhando a si mesmo

    const safeZoneX = isBotTeam1 ? WIDTH - 150 : 150;
    idealX = isBotTeam1
      ? Math.min(idealX, safeZoneX)
      : Math.max(idealX, safeZoneX);
  } // 5. Aplica clamping de bordas (Garante que nunca saia do campo)

  idealX = Math.max(playerRadius, Math.min(idealX, WIDTH - playerRadius));
  idealY = Math.max(playerRadius, Math.min(idealY, HEIGHT - playerRadius));

  return { x: idealX, y: idealY };
}

function handleBotMovement(bot, bola) {
  // 1. LÓGICA DE KICK-OFF DO BOT
  if (isKickOffActive && bot.team === kickOffTeam) {
    // Se o Bot for o time que tem que chutar, ele chuta imediatamente
    const dx_kick = bola.x - bot.x;
    const dy_kick = bola.y - bot.y;
    const distToBall = Math.sqrt(dx_kick * dx_kick + dy_kick * dy_kick); // O Bot deve estar perto o suficiente

    if (distToBall < 50) {
      // Vira o Kick-Off para "inativo"
      isKickOffActive = false;
      kickOffTeam = null;
      broadcast({ type: "kickOffStarted" }); // Notifica clientes para iniciar // Chuta em direção ao meio-campo para iniciar o jogo

      const targetX = bot.team === 1 ? MIDFIELD_X + 50 : MIDFIELD_X - 50;
      const targetY = HEIGHT / 2;

      const dx_target = targetX - bola.x;
      const dy_target = targetY - bola.y;
      const angle = Math.atan2(dy_target, dx_target);
      const force = 10; // Chute suave

      bola.vx = Math.cos(angle) * force;
      bola.vy = Math.sin(angle) * force;

      bola.lastTouchId = bot.id;
      bola.lastTouchName = bot.name;

      return; // Sai da função, pois o Bot já deu o Kick-Off
    }
  } // 2. MOVIMENTO SUAVE (CORREÇÃO DO TREMOR)

  const idealPos = calculateIdealBotPosition(bot, bola);

  let dx = idealPos.x - bot.x;
  let dy = idealPos.y - bot.y;
  const distToIdeal = Math.sqrt(dx * dx + dy * dy);

  if (distToIdeal > 1) {
    dx = dx / distToIdeal;
    dy = dy / distToIdeal; // NOVO CÓDIGO: Velocidade proporcional à distância (corrige o tremor) // O fator 0.8 aqui garante que ele desacelere ao se aproximar do alvo.

    const currentSpeed = Math.min(BOT_SPEED, distToIdeal * 0.8);

    bot.x += dx * currentSpeed;
    bot.y += dy * currentSpeed; // Aplica o clamping de borda do campo

    bot.x = Math.max(PLAYER_RADIUS, Math.min(bot.x, WIDTH - PLAYER_RADIUS));
    bot.y = Math.max(PLAYER_RADIUS, Math.min(bot.y, HEIGHT - PLAYER_RADIUS));
  } // 3. LÓGICA DE CHUTE (OFENSIVA/DEFENSIVA)

  const dx_kick = bola.x - bot.x;
  const dy_kick = bola.y - bot.y;
  const distToBall = Math.sqrt(dx_kick * dx_kick + dy_kick * dy_kick);

  if (distToBall < BOT_KICK_DISTANCE) {
    // O alvo do chute é o gol adversário (X=800 para Time 1, X=0 para Time 2)
    const targetX = bot.team === 1 ? WIDTH : 0; // O alvo vertical padrão é o centro do gol (Y=250)
    const centerGoalY = HEIGHT / 2; // --- NOVO: INTRODUZINDO O ERRO DE CHUTE --- // Gera um desvio aleatório entre -BOT_KICK_ERROR_MAX e +BOT_KICK_ERROR_MAX

    const kickError = (Math.random() * 2 - 1) * BOT_KICK_ERROR_MAX;
    let targetY = centerGoalY + kickError; // Opcional: Garante que o alvo não esteja muito fora do campo verticalmente

    targetY = Math.max(GOAL_TOP - 50, Math.min(targetY, GOAL_BOTTOM + 50)); // ------------------------------------------ // Calcula a direção do chute (em direção ao alvo imperfeito)
    const dx_target = targetX - bola.x;
    const dy_target = targetY - bola.y;
    const angle = Math.atan2(dy_target, dx_target);

    const force = 18; // Força do chute do Bot // Aplica o impulso

    bola.vx = Math.cos(angle) * force;
    bola.vy = Math.sin(angle) * force;

    bola.lastTouchId = bot.id;
    bola.lastTouchName = bot.name;
  }
}

// [SUBSTITUIÇÃO COMPLETA] - Lógica para garantir MAX_TEAM_SIZE
function balanceTeams() {
  let humanCount = { 1: 0, 2: 0 };
  let activeBotCount = { 1: 0, 2: 0 };
  let playersToRemove = [];
  let activeBotData = {}; // Para rastrear os times dos bots ativos

  // 1. Contar Humanos e Bots e separar IDs
  for (const id in players) {
    if (BOT_IDS.includes(id)) {
      activeBotCount[players[id].team]++;
      activeBotData[id] = players[id].team;
    } else {
      humanCount[players[id].team]++;
    }
  }

  // 2. Calcular e identificar Bots para remoção
  for (let team = 1; team <= 2; team++) {
    const requiredBots = MAX_TEAM_SIZE - humanCount[team];
    const currentBots = activeBotCount[team];

    // Se há Bots demais no time (excesso que precisa ser removido)
    if (currentBots > requiredBots) {
      // Identifica Bots no time para remoção (o excesso)
      for (const botId of BOT_IDS) {
            if (players[botId] && players[botId].team === team && playersToRemove.length < currentBots - requiredBots) {
                playersToRemove.push(botId);
            }
      }
    }
  }

  // 3. Remover Bots excessivos
  playersToRemove.forEach((botId) => {
    console.log(`[BOT] Removendo Bot ${botId}. Times balanceados.`);
    delete players[botId];
    broadcast({ type: "playerLeft", playerId: botId });
  });

  // 4. Adicionar/Mover Bots faltantes
  let nextBotIdIndex = 0;
  for (let team = 1; team <= 2; team++) {
    const requiredBots = MAX_TEAM_SIZE - humanCount[team];
    let botsToCreate = requiredBots;
    
    // Contar quantos bots DO TIME JÁ ESTÃO ATIVOS (que não foram removidos)
    let activeBotsInTeam = 0;
    for (const botId of BOT_IDS) {
        if (players[botId] && players[botId].team === team) {
            activeBotsInTeam++;
        }
    }
    
    botsToCreate = requiredBots - activeBotsInTeam;


    while (botsToCreate > 0 && nextBotIdIndex < MAX_BOTS) {
      const botId = BOT_IDS[nextBotIdIndex];

      // Se este ID de Bot já está ativo e no time correto (ou foi recém-removido, o que não deve acontecer aqui), pula
      // Garantir que estamos pegando um BOT_ID que não está em uso, ou que está em uso no time errado
      if (players[botId] && players[botId].team === team) {
        nextBotIdIndex++;
        continue;
      }
      
      // Se o Bot está no time oposto, remove ele de lá para colocar no time atual
      if (players[botId] && players[botId].team !== team) {
          console.log(`[BOT] Movendo Bot ${botId} do Time ${players[botId].team} para o Time ${team}`);
          delete players[botId]; // Remove temporariamente para recriar
          broadcast({ type: "playerLeft", playerId: botId });
      }

      const BOT_NAME = team === 1 ? `RAFAEL-${nextBotIdIndex + 1}` : `MARCELAO-${nextBotIdIndex + 1}`;

      // Calcula o índice da posição que este bot vai ocupar.
      // É o número de humanos (humanCount[team]) mais o número de bots já ativos no time.
      const initialPosIndex = humanCount[team] + (requiredBots - botsToCreate);
      
      const initialPosArray = team === 1 ? team1Positions : team2Positions;
      const initialPos = initialPosArray[initialPosIndex % initialPosArray.length];

      if (!initialPos) {
        console.error(`[BOT] Posição inicial não encontrada para o Bot ${botId} no Time ${team}`);
        break;
      }

      players[botId] = {
        id: botId,
        name: BOT_NAME,
        team: team,
        x: initialPos.x,
        y: initialPos.y,
        number: 90 + nextBotIdIndex + 1, // Números altos para Bots (91, 92...)
      };

      console.log(`[BOT] Criando Bot ${botId} para o Time ${team}`);
      broadcast({ type: "newPlayer", player: players[botId] });

      botsToCreate--;
      nextBotIdIndex++;
    }
  }
  
  // Garante que todos os jogadores estão nas posições corretas após o balanceamento
  resetAllPlayers();
}

// ------------------------------------------------------------------
// NOVA FUNÇÃO: Colisão entre Jogadores
// ------------------------------------------------------------------
function handlePlayerCollisions() {
  const playerIds = Object.keys(players);
  const radius = PLAYER_RADIUS;
  const diameter = radius * 2;
  const repulsionForce = 0.5; // Fator de força para afastar os jogadores // Itera sobre todos os pares de jogadores (evitando duplas e auto-colisão)

  for (let i = 0; i < playerIds.length; i++) {
    const p1 = players[playerIds[i]];

    for (let j = i + 1; j < playerIds.length; j++) {
      const p2 = players[playerIds[j]];

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.sqrt(dx * dx + dy * dy); // Se a distância for menor que o diâmetro (eles estão se sobrepondo)

      if (dist < diameter && dist > 0) {
        const overlap = diameter - dist;
        const angle = Math.atan2(dy, dx);
        const sin = Math.sin(angle);
        const cos = Math.cos(angle); // Distância a ser movida por cada jogador (metade da sobreposição)

        const moveX = (cos * overlap) / 2;
        const moveY = (sin * overlap) / 2; // 1. Reposiciona os jogadores

        p1.x -= moveX;
        p1.y -= moveY;
        p2.x += moveX;
        p2.y += moveY; // 2. (Opcional) Adiciona uma pequena força de repulsão // Como os jogadores não têm vetores de velocidade (vx/vy), // o movimento é puramente baseado no input. Aplicar a força // aqui apenas garante que eles se "soltem" mais facilmente. // Neste modelo, basta que o reposicionamento (1) seja feito // antes de processar o próximo input. // Notificamos os clientes sobre as novas posições corrigidas. // Isso é importante para que o cliente desenhe a posição final correta.

        broadcast({ type: "playerUpdate", player: p1 });
        broadcast({ type: "playerUpdate", player: p2 });
      }
    }
  }
}
// ------------------------------------------------------------------

setInterval(balanceTeams, 5000);