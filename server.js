const WebSocket = require("ws");
const http = require("http");
const fs = require("fs");
const path = require("path");
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
const wss = new WebSocket.Server({ server });

// --- 3. Inicia o Servidor HTTP para escutar na porta ---
server.listen(PORT, () => {
  console.log(`🚀 Servidor HTTP/WS rodando na porta ${PORT}`);
});

const WIDTH = 800;
const HEIGHT = 500;
const DIAGONAL_FACTOR = 0.7071;

// --- NOVAS CONSTANTES DE BOT/TIMES (3x3) ---
const BOT_IDS = [
  "bot-player-001",
  "bot-player-002",
  "bot-player-003",
  "bot-player-004",
  "bot-player-005",
  "bot-player-006",
];
const MAX_BOTS = BOT_IDS.length;
const MAX_TEAM_SIZE = 3; // *** TAMANHO MÁXIMO DO TIME: 3 JOGADORES ***
const MIDFIELD_X = WIDTH / 2; // 400

const BOT_SPEED = 2;
const BOT_KICK_DISTANCE = 40;
const BOT_KICK_ERROR_MAX = 100;

// CONSTANTES DE GOL
const GOAL_HEIGHT = 100;
const GOAL_TOP = (HEIGHT - GOAL_HEIGHT) / 2;
const GOAL_BOTTOM = GOAL_TOP + GOAL_HEIGHT;

const PLAYER_RADIUS = 15;

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

// --- POSIÇÕES INICIAIS PARA 3 JOGADORES (ZAGA, MEIO-CAMPO, ATAQUE) ---
const team1Positions = [
  { x: 100, y: 250, role: "DEFENDER" },
  { x: 250, y: 250, role: "MIDFIELD" },
  { x: 350, y: 250, role: "ATTACKER" },
];

// Time 2 (Direita) - Posições espelhadas
const team2Positions = [
  { x: 700, y: 250, role: "DEFENDER" },
  { x: 550, y: 250, role: "MIDFIELD" },
  { x: 450, y: 250, role: "ATTACKER" },
];
// --- FIM POSIÇÕES INICIAIS ---

let teamCount = { 1: 0, 2: 0 };
const score = { 1: 0, 2: 0 };
let gameTime = 180;
let isKickOffActive = false;
let kickOffTeam = null;
let gameInterval = null;

// Atualiza física da bola a cada frame
setInterval(() => {
    
  if (!isKickOffActive) {
    bola.x += bola.vx;
    bola.y += bola.vy;

    bola.vx *= 0.98;
    bola.vy *= 0.98;
  } else {
    bola.x = WIDTH / 2;
    bola.y = HEIGHT / 2;
    bola.vx = 0;
    bola.vy = 0;
  }

  handlePlayerCollisions();

  // Colisão com as paredes (fora da área do gol)
  if (bola.x - bola.raio < 0 && (bola.y < GOAL_TOP || bola.y > GOAL_BOTTOM)) {
    bola.vx *= -1;
    bola.x = bola.raio;
  } else if (
    bola.x + bola.raio > WIDTH &&
    (bola.y < GOAL_TOP || bola.y > GOAL_BOTTOM)
  ) {
    bola.vx *= -1;
    bola.x = WIDTH - bola.raio;
  }

  if (bola.y - bola.raio < 0) {
    bola.vy *= -1;
    bola.y = bola.raio;
  } else if (bola.y + bola.raio > HEIGHT) {
    bola.vy *= -1;
    bola.y = HEIGHT - bola.raio;
  }

  // Colisão com jogadores (Bola vs Jogador)
  for (let id in players) {
    const p = players[id];
    let dx = bola.x - p.x;
    let dy = bola.y - p.y;
    let dist = Math.sqrt(dx * dx + dy * dy);
    const playerRadius = PLAYER_RADIUS;

    if (dist < bola.raio + playerRadius) {
      let angle = Math.atan2(dy, dx);

      const overlap = bola.raio + playerRadius - dist;
      p.x -= Math.cos(angle) * overlap;
      p.y -= Math.sin(angle) * overlap;

      const conductionFactor = 0.3;
      const playerTouchSpeed = 2;

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
  }

  // --- Movimento para TODOS os Bots ativos ---
  for (let id in players) {
    if (BOT_IDS.includes(id)) {
      handleBotMovement(players[id], bola);
      broadcast({ type: "playerUpdate", player: players[id] });
    }
  }

  // Lógica de GOL (Time 2 marca)
  if (bola.x - bola.raio <= 0 && bola.y >= GOAL_TOP && bola.y <= GOAL_BOTTOM) {
    if (bola.x < 0) {
      score[2]++;
      const scorerName = bola.lastTouchName || "o time";

      if (score[2] >= 5) {
        broadcast({ type: "gameOver", score });
        if (gameInterval) clearInterval(gameInterval);
        return;
      }

      isKickOffActive = true;
      kickOffTeam = 1; // Time 1 sofreu, Time 1 faz a saída
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
  }
  // Lógica de GOL (Time 1 marca)
  else if (
    bola.x + bola.raio >= WIDTH &&
    bola.y >= GOAL_TOP &&
    bola.y <= GOAL_BOTTOM
  ) {
    if (bola.x > WIDTH) {
      score[1]++;
      const scorerName = bola.lastTouchName || "o time";

      if (score[1] >= 5) {
        broadcast({ type: "gameOver", score });
        if (gameInterval) clearInterval(gameInterval);
        return;
      }

      isKickOffActive = true;
      kickOffTeam = 2; // Time 2 sofreu, Time 2 faz a saída
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
  }

  broadcast({ type: "update", bola });
}, 1000 / 60);

// Loop de Tempo e Fim de Jogo
gameInterval = setInterval(() => {
  if (gameTime > 0) {
    gameTime--;
    broadcast({ type: "update", gameTime });
  } else {
    clearInterval(gameInterval);
    broadcast({ type: "gameOver", score });
  }
}, 1000);

wss.on("connection", (ws) => {
  const playerId = uuidv4();

  ws.id = playerId;
  console.log(`🟢 Novo jogador conectado: ${playerId}`);

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
        const incomingTeam = msg.player.team;

        if (incomingTeam === 1 || incomingTeam === 2) {
          teamCount[incomingTeam]++;
        } else {
          msg.player.team = 1;
          teamCount[1]++;
        }

        // Calcula a posição inicial correta com base no número de humanos.
        const humanPlayersCount = Object.values(players).filter(
          (p) => !BOT_IDS.includes(p.id) && p.team === msg.player.team
        ).length;

        // Índice da posição a ser ocupada pelo novo humano (0, 1 ou 2)
        const posIndex = humanPlayersCount % MAX_TEAM_SIZE;
        
        const initialPosArray = msg.player.team === 1 ? team1Positions : team2Positions;
        const initialPos = initialPosArray[posIndex] || initialPosArray[0];

        const teamIdString = `team${msg.player.team}`;
        const playerNumber = assignUniquePlayerNumber(teamIdString);

        players[playerId] = {
          id: playerId,
          name: msg.player.name,
          team: msg.player.team,
          x: initialPos.x,
          y: initialPos.y,
          role: initialPos.role, // O humano ocupa um papel na formação
          number: playerNumber,
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
        let finalSpeed = speed;

        const input = msg.input;

        if (input.includes("up")) dy -= 1;
        if (input.includes("down")) dy += 1;
        if (input.includes("Left")) dx -= 1;
        if (input.includes("Right")) dx += 1;

        if (dx !== 0 && dy !== 0) {
          finalSpeed = speed * DIAGONAL_FACTOR;
        }

        let tempX = p.x + dx * finalSpeed;
        let tempY = p.y + dy * finalSpeed;

        // Restrição de Meio de Campo (Regra da Saída de Bola)
        if (isKickOffActive) {
          if (p.team === 1) {
            tempX = Math.min(tempX, MIDFIELD_X - playerRadius);
          } else if (p.team === 2) {
            tempX = Math.max(tempX, MIDFIELD_X + playerRadius);
          }
        }

        // Restrição de Borda do Campo
        p.x = Math.max(playerRadius, Math.min(tempX, WIDTH - playerRadius));
        p.y = Math.max(playerRadius, Math.min(tempY, HEIGHT - playerRadius));

        // Lógica de chute
        if (input === "kick") {
          const dx_kick = bola.x - p.x;
          const dy_kick = bola.y - p.y;
          const dist = Math.sqrt(dx_kick * dx_kick + dy_kick * dy_kick);

          if (dist < 50) {
            if (isKickOffActive) {
              if (p.team === kickOffTeam) {
                isKickOffActive = false;
                kickOffTeam = null;
                broadcast({ type: "kickOffStarted" });
              } else {
                return;
              }
            }

            const angle = Math.atan2(dy_kick, dx_kick);
            const force = 12;
            bola.vx = Math.cos(angle) * force;
            bola.vy = Math.sin(angle) * force;

            bola.lastTouchId = p.id;
            bola.lastTouchName = p.name;
          }
        }

        broadcast({ type: "playerUpdate", player: p });
        break;
    }
  });

  ws.on("close", () => {
    const player = players[playerId];

    console.log(`🔴 Jogador saiu: ${playerId}`);

    if (player) {
      const teamIdString = `team${player.team}`;
      releasePlayerNumber(teamIdString, player.number);
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

function resetBola() {
  bola.x = WIDTH / 2;
  bola.y = HEIGHT / 2;
  bola.vx = 0;
  bola.vy = 0;
  bola.lastTouchId = null;
  bola.lastTouchName = null;
  broadcast({ type: "update", bola });
}

function restartGame() {
  score[1] = 0;
  score[2] = 0;
  gameTime = 180;
  isKickOffActive = false;
  kickOffTeam = null;

  if (gameInterval) clearInterval(gameInterval);
  gameInterval = setInterval(() => {
    if (gameTime > 0) {
      gameTime--;
      broadcast({ type: "update", gameTime });
    } else {
      clearInterval(gameInterval);
      broadcast({ type: "gameOver", score });
    }
  }, 1000);

  resetAllPlayers();

  resetBola();
  broadcast({ type: "gameRestarted", score });
}

// Redefine a posição de TODOS os jogadores, humanos e bots, para o Kick-Off/Reset.
function resetAllPlayers() {
  // 1. Separa os jogadores (garantindo a ordem de posições fixas)
  const team1Players = Object.values(players).filter(p => p.team === 1).sort((a, b) => {
        // Coloca humanos primeiro, depois bots, e ordena pelo role implícito (DEFENDER, MIDFIELD, ATTACKER)
        if (!BOT_IDS.includes(a.id) && BOT_IDS.includes(b.id)) return -1;
        if (BOT_IDS.includes(a.id) && !BOT_IDS.includes(b.id)) return 1;
        return 0;
    });
    
    const team2Players = Object.values(players).filter(p => p.team === 2).sort((a, b) => {
        if (!BOT_IDS.includes(a.id) && BOT_IDS.includes(b.id)) return -1;
        if (BOT_IDS.includes(a.id) && !BOT_IDS.includes(b.id)) return 1;
        return 0;
    });


  // 2. Reposiciona Time 1
  for (let i = 0; i < team1Players.length; i++) {
    const p = team1Players[i];
    const posIndex = i % team1Positions.length;
    const initialPos = team1Positions[posIndex];

    p.x = initialPos.x;
    p.y = initialPos.y;
    // Garante que o role seja o da posição, especialmente para bots
    p.role = initialPos.role;
    broadcast({ type: "playerUpdate", player: p });
  }

  // 3. Reposiciona Time 2
  for (let i = 0; i < team2Players.length; i++) {
    const p = team2Players[i];
    const posIndex = i % team2Positions.length;
    const initialPos = team2Positions[posIndex];

    p.x = initialPos.x;
    p.y = initialPos.y;
    p.role = initialPos.role;
    broadcast({ type: "playerUpdate", player: p });
  }
}

function assignUniquePlayerNumber(teamId) {
  const teamSet = usedNumbers[teamId];
  const availableNumbers = Array.from({ length: 11 }, (_, i) => i + 1).filter(
    (num) => !teamSet.has(num)
  );

  if (availableNumbers.length === 0) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * availableNumbers.length);
  const newNumber = availableNumbers[randomIndex];

  teamSet.add(newNumber);

  return newNumber;
}

function releasePlayerNumber(teamId, number) {
  if (number) {
    usedNumbers[teamId].delete(number);
  }
}

// [CÁLCULO TÁTICO DE POSIÇÃO]
function calculateIdealBotPosition(bot, ball) {
    const playerRadius = PLAYER_RADIUS;
    const isBotTeam1 = bot.team === 1;
    const botRole = bot.role || "MIDFIELD";
    
    let idealX, idealY;
    
    // Posição de retorno (Home Position) baseada na formação inicial
    const teamPositions = isBotTeam1 ? team1Positions : team2Positions;
    let homePos = teamPositions.find(pos => pos.role === botRole) || teamPositions[0];

    const isBallInOurHalf = isBotTeam1 ? ball.x < MIDFIELD_X : ball.x > MIDFIELD_X;

    // -------------------------------------------------------------
    // 1. Definição da Posição Base Tática
    // -------------------------------------------------------------

    if (botRole === "DEFENDER") {
        // MISSÃO: Evitar gols, ficar na defesa e chutar pra longe.
        const defensiveDistance = 120; 
        const goalX = isBotTeam1 ? 0 : WIDTH;
        const goalY = HEIGHT / 2;
        
        const dxGoal = goalX - ball.x;
        const dyGoal = goalY - ball.y;
        const totalDistance = Math.sqrt(dxGoal * dxGoal + dyGoal * dyGoal);

        if (totalDistance > 0) {
            const ratio = (totalDistance - defensiveDistance) / totalDistance;
            idealX = ball.x + dxGoal * ratio;
            idealY = ball.y + dyGoal * ratio;
        } else {
            idealX = homePos.x;
            idealY = homePos.y;
        }
        
        // Limita o defensor estritamente ao seu campo
        const maxDefensiveX = isBotTeam1 ? MIDFIELD_X - 10 : MIDFIELD_X + 10;
        idealX = isBotTeam1 ? Math.min(idealX, maxDefensiveX) : Math.max(idealX, maxDefensiveX);
        
        // Se a bola estiver no campo adversário, retorna para a posição base.
        if(!isBallInOurHalf) {
            idealX = homePos.x;
            idealY = homePos.y;
        }

    } else if (botRole === "MIDFIELD") {
        // MISSÃO: Equilíbrio. Busca a bola na transição.
        idealX = ball.x;
        idealY = ball.y;

        // Se a bola estiver muito recuada, recua para ajudar
        if (isBallInOurHalf) {
            idealX = isBotTeam1 ? Math.max(ball.x, homePos.x - 50) : Math.min(ball.x, homePos.x + 50);
            idealY = ball.y;
        }
        
        // Limita a área de atuação do Meio-Campo
        const minX = isBotTeam1 ? 150 : WIDTH - 350;
        const maxX = isBotTeam1 ? WIDTH - 200 : 200;
        
        idealX = Math.max(minX, Math.min(idealX, maxX));

    } else if (botRole === "ATTACKER") {
        // MISSÃO: Marcar gols.
        
        idealX = ball.x;
        idealY = ball.y;

        // Garante que o atacante fique no campo ofensivo e perto da bola
        const minOffensiveX = isBotTeam1 ? MIDFIELD_X + 10 : MIDFIELD_X - 10;
        idealX = isBotTeam1 ? Math.max(idealX, minOffensiveX) : Math.min(idealX, minOffensiveX);

        // Limita a profundidade para evitar que fique no canto
        const safeZoneX = isBotTeam1 ? WIDTH - playerRadius * 3 : playerRadius * 3;
        idealX = isBotTeam1
            ? Math.min(idealX, safeZoneX)
            : Math.max(idealX, safeZoneX);
    }
    
    // -------------------------------------------------------------
    // 2. Comportamento de Desagregação (Evitar Aglomeração)
    // -------------------------------------------------------------
    for (const id in players) {
        const p = players[id];
        if (p.team === bot.team && p.id !== bot.id) {
            const dx = idealX - p.x;
            const dy = idealY - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < playerRadius * 3) {
                const angle = Math.atan2(dy, dx);
                idealX = p.x + Math.cos(angle) * (playerRadius * 3.5); 
                idealY = p.y + Math.sin(angle) * (playerRadius * 3.5);
            }
        }
    }
  
    // 3. Aplica clamping de bordas
    idealX = Math.max(playerRadius, Math.min(idealX, WIDTH - playerRadius));
    idealY = Math.max(playerRadius, Math.min(idealY, HEIGHT - playerRadius));

    return { x: idealX, y: idealY };
}


// [MOVIMENTO DO BOT E LÓGICA DE CHUTE TÁTICO]
function handleBotMovement(bot, bola) {
  // 1. LÓGICA DE KICK-OFF DO BOT (Prioridade)
  if (isKickOffActive && bot.team === kickOffTeam) {
    
    // Encontra o bot mais próximo da bola (o que deve chutar)
    let closestBot = null;
    let minDist = Infinity;
    
    const botsInTeam = Object.values(players).filter(p => p.team === kickOffTeam && BOT_IDS.includes(p.id));

    for (const p of botsInTeam) {
      const dist = Math.sqrt(Math.pow(bola.x - p.x, 2) + Math.pow(bola.y - p.y, 2));
      if (dist < minDist) {
        minDist = dist;
        closestBot = p;
      }
    }

    if (closestBot && closestBot.id !== bot.id) {
        // Encontra a posição inicial do bot para ele não atrapalhar
        const teamPositions = bot.team === 1 ? team1Positions : team2Positions;
        
        const humanPlayersCount = Object.values(players).filter(p => !BOT_IDS.includes(p.id) && p.team === bot.team).length;
        const botIndexInTeam = botsInTeam.findIndex(b => b.id === bot.id);
        const posIndex = (humanPlayersCount + botIndexInTeam) % MAX_TEAM_SIZE;
        
        const initialPos = teamPositions[posIndex];
        
        // Move o bot para a posição inicial com velocidade BOT_SPEED
        const dx_move = initialPos.x - bot.x;
        const dy_move = initialPos.y - bot.x;
        const distToInitial = Math.sqrt(dx_move * dx_move + dy_move * dy_move);

        if (distToInitial > 1) {
            const ratio = BOT_SPEED / distToInitial;
            bot.x += dx_move * ratio;
            bot.y += dy_move * ratio;
        }

        return;
    }
    
    // Se este bot É o mais próximo, move-se para a bola e chuta
    if (closestBot && closestBot.id === bot.id) {
        
        const dx_move = bola.x - bot.x;
        const dy_move = bola.y - bot.y;
        const distToBall = Math.sqrt(dx_move * dx_move + dy_move * dy_move);

        if (distToBall < 50) {
            isKickOffActive = false;
            kickOffTeam = null;
            broadcast({ type: "kickOffStarted" });
            
            // Chuta suavemente para o meio-campo adversário
            const targetX = bot.team === 1 ? WIDTH * 0.75 : WIDTH * 0.25; 
            const targetY = HEIGHT / 2;

            const dx_target = targetX - bola.x;
            const dy_target = targetY - bola.y;
            const angle = Math.atan2(dy_target, dx_target);
            const force = 10; 

            bola.vx = Math.cos(angle) * force;
            bola.vy = Math.sin(angle) * force;

            bola.lastTouchId = bot.id;
            bola.lastTouchName = bot.name;

            return;
        }
        
        // Move para a bola
        if (distToBall > 1) {
            const ratio = BOT_SPEED / distToBall;
            bot.x += dx_move * ratio;
            bot.y += dy_move * ratio;
            
            bot.x = Math.max(PLAYER_RADIUS, Math.min(bot.x, WIDTH - PLAYER_RADIUS));
            bot.y = Math.max(PLAYER_RADIUS, Math.min(bot.y, HEIGHT - PLAYER_RADIUS));
        }
        
        return;
    }
  } 
  
  // 2. MOVIMENTO SUAVE (Evita Teletransporte e Agregação)
  const idealPos = calculateIdealBotPosition(bot, bola);

  let dx = idealPos.x - bot.x;
  let dy = idealPos.y - bot.y;
  const distToIdeal = Math.sqrt(dx * dx + dy * dy);

  const smoothingFactor = 0.4; // Movimenta até 40% da distância ideal por frame
  const maxMoveSpeed = BOT_SPEED * 1.5; // Velocidade máxima que pode ser usada

  if (distToIdeal > 1) {
    const moveDistance = Math.min(distToIdeal * smoothingFactor, maxMoveSpeed);
    const ratio = moveDistance / distToIdeal;

    bot.x += dx * ratio;
    bot.y += dy * ratio; 
    
    bot.x = Math.max(PLAYER_RADIUS, Math.min(bot.x, WIDTH - PLAYER_RADIUS));
    bot.y = Math.max(PLAYER_RADIUS, Math.min(bot.y, HEIGHT - PLAYER_RADIUS));
  } 
  
  // 3. LÓGICA DE CHUTE TÁTICO
  const dx_kick = bola.x - bot.x;
  const dy_kick = bola.y - bot.y;
  const distToBall = Math.sqrt(dx_kick * dx_kick + dy_kick * dy_kick);

  if (distToBall < BOT_KICK_DISTANCE) {
        let targetX, targetY;
        let force = 18; 
        let errorFactor = 1;

        if (bot.role === "DEFENDER") {
            // Defensor: Chuta para longe (meio-campo adversário)
            targetX = bot.team === 1 ? WIDTH * 0.75 : WIDTH * 0.25; 
            targetY = HEIGHT / 2;
            force = 15;
            errorFactor = 2.0;
        } else if (bot.role === "MIDFIELD") {
            // Meio-Campo: Chute controlado no gol
            targetX = bot.team === 1 ? WIDTH : 0; 
            targetY = HEIGHT / 2;
            force = 12;
            errorFactor = 0.5;
        } else { // ATTACKER
            // Atacante: Chute forte no gol
            targetX = bot.team === 1 ? WIDTH : 0; 
            targetY = HEIGHT / 2;
            force = 20;
            errorFactor = 0.8;
        }

        const kickError = (Math.random() * 2 - 1) * BOT_KICK_ERROR_MAX * errorFactor;
        targetY += kickError; 

        const dx_target = targetX - bola.x;
        const dy_target = targetY - bola.y;
        const angle = Math.atan2(dy_target, dx_target);

        bola.vx = Math.cos(angle) * force;
        bola.vy = Math.sin(angle) * force;

        bola.lastTouchId = bot.id;
        bola.lastTouchName = bot.name;
  }
}


// [LÓGICA DE BALANCEAMENTO 3x3]
function balanceTeams() {
    let humanCount = { 1: 0, 2: 0 };
    let currentBots = { 1: [], 2: [] };
    const availableBotIds = new Set(BOT_IDS);
    
    // 1. Contar Humanos e separar Bots ativos
    for (const id in players) {
        const p = players[id];
        if (BOT_IDS.includes(p.id)) {
            currentBots[p.team].push(p);
            availableBotIds.delete(p.id); 
        } else {
            humanCount[p.team]++;
        }
    }

    // 2. Loop para balancear ambos os times
    for (let team = 1; team <= 2; team++) {
        const requiredBots = MAX_TEAM_SIZE - humanCount[team];
        const botsInTeam = currentBots[team];

        // 2a. REMOVER Bots em EXCESSO
        if (botsInTeam.length > requiredBots) {
            const botsToRemove = botsInTeam.slice(requiredBots);
            botsToRemove.forEach(bot => {
                console.log(`[BOT] Removendo Bot ${bot.id} (Excesso) do Time ${team}.`);
                delete players[bot.id];
                broadcast({ type: "playerLeft", playerId: bot.id });
                availableBotIds.add(bot.id); 
            });
            botsInTeam.splice(requiredBots); 
        }

        // 2b. ADICIONAR Bots FALTANTES
        let botsToCreate = requiredBots - botsInTeam.length;
        
        while (botsToCreate > 0 && availableBotIds.size > 0) {
            const botId = Array.from(availableBotIds).shift();
            availableBotIds.delete(botId);
            
            const initialPosArray = team === 1 ? team1Positions : team2Positions;
            
            const initialPosIndex = humanCount[team] + botsInTeam.length;
            
            if (initialPosIndex >= MAX_TEAM_SIZE) {
                 console.error(`[BOT] Limite de posições excedido no Time ${team}.`);
                 break;
            }
            
            const initialPos = initialPosArray[initialPosIndex];
            const BOT_NAME = team === 1 ? `RAFAEL-BOT-${botId.slice(-3)}` : `MARCELAO-BOT-${botId.slice(-3)}`;

            const newBot = {
                id: botId,
                name: BOT_NAME,
                team: team,
                x: initialPos.x,
                y: initialPos.y,
                role: initialPos.role, 
                number: 90 + BOT_IDS.indexOf(botId) + 1,
            };
            
            players[botId] = newBot;
            botsInTeam.push(newBot);
            
            console.log(`[BOT] Adicionando Bot ${botId} (${initialPos.role}) no Time ${team}. Posição: ${initialPosIndex}`);
            broadcast({ type: "newPlayer", player: players[botId] });

            botsToCreate--;
        }
    }
}

// Colisão entre Jogadores (Repulsão)
function handlePlayerCollisions() {
  const playerIds = Object.keys(players);
  const radius = PLAYER_RADIUS;
  const diameter = radius * 2;

  for (let i = 0; i < playerIds.length; i++) {
    const p1 = players[playerIds[i]];

    for (let j = i + 1; j < playerIds.length; j++) {
      const p2 = players[playerIds[j]];

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.sqrt(dx * dx + dy * dy); 

      if (dist < diameter && dist > 0) {
        const overlap = diameter - dist;
        const angle = Math.atan2(dy, dx);
        const sin = Math.sin(angle);
        const cos = Math.cos(angle); 

        const moveX = (cos * overlap) / 2;
        const moveY = (sin * overlap) / 2; 

        p1.x -= moveX;
        p1.y -= moveY;
        p2.x += moveX;
        p2.y += moveY; 

        broadcast({ type: "playerUpdate", player: p1 });
        broadcast({ type: "playerUpdate", player: p2 });
      }
    }
  }
}

setInterval(balanceTeams, 5000); // Roda o balanceamento a cada 5 segundos