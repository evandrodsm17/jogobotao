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
  "bot-player-005", // Aumentando para 5 IDs, apenas por segurança
  "bot-player-006",
  "bot-player-007",
  "bot-player-008",
];
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

// --- POSIÇÕES INICIAIS ATUALIZADAS PARA 5 JOGADORES (ZAGA, MEIO-CAMPO, ATAQUE) ---
// Note que as posições já sugerem os papéis
const team1Positions = [
  { x: 100, y: 250, role: "DEFENDER" }, // Zagueiro Central
  { x: 180, y: 100, role: "DEFENDER" }, // Lateral A (Defensivo)
  { x: 180, y: 400, role: "DEFENDER" }, // Lateral B (Defensivo)
  { x: 300, y: 250, role: "MIDFIELD" }, // Meio-campo Armador
  { x: 350, y: 150, role: "ATTACKER" }, // Atacante Ponta
];

// Time 2 (Direita) - Posições espelhadas
const team2Positions = [
  { x: 700, y: 250, role: "DEFENDER" },
  { x: 620, y: 100, role: "DEFENDER" },
  { x: 620, y: 400, role: "DEFENDER" },
  { x: 500, y: 250, role: "MIDFIELD" },
  { x: 450, y: 350, role: "ATTACKER" },
];
// --- FIM POSIÇÕES INICIAIS ---

let teamCount = { 1: 0, 2: 0 };
const score = { 1: 0, 2: 0 };
let gameTime = 180; // 3 minutos em segundos
let isKickOffActive = false; // Controla se o jogo está pausado para o Kick-Off
let kickOffTeam = null; // O time que fará a saída de bola
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
  } // ------------------------------------------------------------------ // Colisão entre jogadores

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
        // Conta apenas os jogadores *humanos* para determinar o próximo índice livre
        const humanPlayersCount = Object.values(players).filter(
          (p) => !BOT_IDS.includes(p.id) && p.team === msg.player.team
        ).length;

        // O índice é baseado no número de humanos. Bots ocuparão as vagas restantes (tratado no balanceTeams/resetAllPlayers)
        const posIndex = humanPlayersCount % MAX_TEAM_SIZE;

        if (msg.player.team === 1) {
          initialPos = team1Positions[posIndex] || { x: 150, y: 200 };
        } else {
          initialPos = team2Positions[posIndex] || { x: 450, y: 200 };
        }
        // --- Fim Lógica Posição ---

        const teamIdString = `team${msg.player.team}`;
        const playerNumber = assignUniquePlayerNumber(teamIdString);

        players[playerId] = {
          id: playerId,
          name: msg.player.name,
          team: msg.player.team,
          x: initialPos.x, // POSIÇÃO ATRIBUÍDA PELO SERVIDOR
          y: initialPos.y, // POSIÇÃO ATRIBUÍDA PELO SERVIDOR
          role: "HUMAN",   // NOVO: Define o papel como humano
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
  bola.lastTouchId = null; // Limpa o marcador
  bola.lastTouchName = null; // Limpa o marcador // broadcast do reset da bola para o cliente
  broadcast({ type: "update", bola });
}

function restartGame() {
  // 1. Resetar placar e tempo
  score[1] = 0;
  score[2] = 0;
  gameTime = 180; // 3 minutos
  isKickOffActive = false; // Limpa o estado de Kick-off
  kickOffTeam = null; // Limpa o time da saída de bola // 2. Limpar e recriar o loop de tempo

  if (gameInterval) clearInterval(gameInterval);
  gameInterval = setInterval(() => {
    if (gameTime > 0) {
      gameTime--;
      broadcast({ type: "update", gameTime });
    } else {
      // Checagem de fim de jogo por tempo (se não for 5x0)
      clearInterval(gameInterval);
      broadcast({ type: "gameOver", score });
    }
  }, 1000); // 3. Resetar a posição dos jogadores

  resetAllPlayers(); // 4. Resetar bola e notificar todos os clientes

  resetBola();
  broadcast({ type: "gameRestarted", score });
}

// [AJUSTE CRÍTICO] - Redefine a posição de TODOS os jogadores, humanos e bots.
function resetAllPlayers() {
  // 1. Separa os jogadores (garantindo a ordem de posições fixas)
  const team1Humans = [];
  const team1Bots = [];
  const team2Humans = [];
  const team2Bots = [];

  for (const id in players) {
    const p = players[id];
    if (BOT_IDS.includes(id)) {
      if (p.team === 1) team1Bots.push(p);
      else if (p.team === 2) team2Bots.push(p);
    } else {
      if (p.team === 1) team1Humans.push(p);
      else if (p.team === 2) team2Humans.push(p);
    }
  }

  // 2. Reposiciona Time 1 (Humanos primeiro, depois Bots)
  const team1Players = [...team1Humans, ...team1Bots];
  for (let i = 0; i < team1Players.length; i++) {
    const p = team1Players[i];
    // Usa a posição fixa da formação
    const posIndex = i % team1Positions.length; 
    const initialPos = team1Positions[posIndex];

    p.x = initialPos.x;
    p.y = initialPos.y;
    // O Bot herda o papel da posição, se for um bot
    if(BOT_IDS.includes(p.id)) {
        p.role = initialPos.role;
    }
    broadcast({ type: "playerUpdate", player: p });
  }

  // 3. Reposiciona Time 2 (Humanos primeiro, depois Bots)
  const team2Players = [...team2Humans, ...team2Bots];
  for (let i = 0; i < team2Players.length; i++) {
    const p = team2Players[i];
    const posIndex = i % team2Positions.length;
    const initialPos = team2Positions[posIndex];

    p.x = initialPos.x;
    p.y = initialPos.y;
    // O Bot herda o papel da posição, se for um bot
    if(BOT_IDS.includes(p.id)) {
        p.role = initialPos.role;
    }
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

// [AJUSTE CRÍTICO] - Lógica de Posicionamento com base no Papel
function calculateIdealBotPosition(bot, ball) {
  const playerRadius = PLAYER_RADIUS;
  const isBotTeam1 = bot.team === 1;
  const botRole = bot.role || "MIDFIELD"; // Garante um papel padrão

  // Determina se a bola está no campo do BOT
  const isBallInBotSide = isBotTeam1
    ? ball.x <= MIDFIELD_X
    : ball.x >= MIDFIELD_X;

  let idealX;
  let idealY;

  // -------------------------------------------------------------
  // 1. Comportamento Defensivo (DEFENDER)
  // -------------------------------------------------------------
  if (botRole === "DEFENDER" || (botRole === "MIDFIELD" && isBallInBotSide)) {
    // Objetivo: Ficar entre a bola e o próprio gol.
    const goalX = isBotTeam1 ? 0 : WIDTH;
    const goalY = HEIGHT / 2;

    // Distância que o Bot tenta manter-se entre a bola e o gol.
    // Defensor mais profundo: 150. Meio-campo defensivo: 250
    const botDistanceToGoal = botRole === "DEFENDER" ? 150 : 250;

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
    }

    // Garante que o defensor fique no campo defensivo (exceção para o meio-campo)
    if (botRole === "DEFENDER") {
      const maxDefensiveX = isBotTeam1
        ? MIDFIELD_X - 50 
        : MIDFIELD_X + 50; 
      idealX = isBotTeam1 ? Math.min(idealX, maxDefensiveX) : Math.max(idealX, maxDefensiveX);
    }

  // -------------------------------------------------------------
  // 2. Comportamento Ofensivo (ATTACKER)
  // -------------------------------------------------------------
  } else if (botRole === "ATTACKER" || (botRole === "MIDFIELD" && !isBallInBotSide)) {
    // Objetivo: Perseguir a bola e se posicionar para o ataque.
    
    // Atacante é mais agressivo, tenta sempre a bola
    idealX = ball.x;
    idealY = ball.y;

    // Atacantes e Meias devem ir além do meio de campo
    const minOffensiveX = isBotTeam1 
      ? MIDFIELD_X + 50
      : MIDFIELD_X - 50;
    
    idealX = isBotTeam1 ? Math.max(idealX, minOffensiveX) : Math.min(idealX, minOffensiveX);

    // Aplica uma margem de segurança para evitar que ele fique colado no gol adversário
    const safeZoneX = isBotTeam1 ? WIDTH - 150 : 150;
    idealX = isBotTeam1
      ? Math.min(idealX, safeZoneX)
      : Math.max(idealX, safeZoneX);
  } 
  // -------------------------------------------------------------
  // 3. Se for Meio-Campo (e o código acima não cobriu), vai para o centro
  // -------------------------------------------------------------
  else {
      // Meio-campo fica na posição de armação no meio, se a bola estiver muito longe.
      idealX = isBotTeam1 ? MIDFIELD_X - 100 : MIDFIELD_X + 100;
      idealY = HEIGHT / 2;
  }
  
  // 4. Aplica clamping de bordas (Garante que nunca saia do campo)
  idealX = Math.max(playerRadius, Math.min(idealX, WIDTH - playerRadius));
  idealY = Math.max(playerRadius, Math.min(idealY, HEIGHT - playerRadius));

  return { x: idealX, y: idealY };
}

// [AJUSTE] - Prioriza o bot mais próximo para dar o Kick-Off
function handleBotMovement(bot, bola) {
  // 1. LÓGICA DE KICK-OFF DO BOT
  if (isKickOffActive && bot.team === kickOffTeam) {
    
    // Encontra o bot mais próximo da bola (o que deve chutar)
    let closestBot = null;
    let minDist = Infinity;
    
    // Filtra apenas os bots do kickOffTeam
    const botsInTeam = Object.values(players).filter(p => p.team === kickOffTeam && BOT_IDS.includes(p.id));

    for (const p of botsInTeam) {
      const dist = Math.sqrt(Math.pow(bola.x - p.x, 2) + Math.pow(bola.y - p.y, 2));
      if (dist < minDist) {
        minDist = dist;
        closestBot = p;
      }
    }

    // Se este bot não é o mais próximo, ele se move para sua posição inicial para não atrapalhar
    if (closestBot && closestBot.id !== bot.id) {
        // Encontra a posição inicial do bot (baseado no resetAllPlayers)
        const teamPositions = bot.team === 1 ? team1Positions : team2Positions;
        
        // Encontra o índice da posição que ele deveria estar
        const humanPlayersCount = Object.values(players).filter(p => !BOT_IDS.includes(p.id) && p.team === bot.team).length;
        const botIndexInTeam = botsInTeam.findIndex(b => b.id === bot.id);
        const posIndex = (humanPlayersCount + botIndexInTeam) % MAX_TEAM_SIZE;
        
        const initialPos = teamPositions[posIndex];
        
        // Move o bot para a posição inicial com velocidade BOT_SPEED
        const dx_move = initialPos.x - bot.x;
        const dy_move = initialPos.y - bot.y;
        const distToInitial = Math.sqrt(dx_move * dx_move + dy_move * dy_move);

        if (distToInitial > 1) {
            const ratio = BOT_SPEED / distToInitial;
            bot.x += dx_move * ratio;
            bot.y += dy_move * ratio;
        }

        return; // Moveu para posição, não chuta
    }
    
    // Se este bot É o mais próximo, move-se para a bola
    if (closestBot && closestBot.id === bot.id) {
        
        const dx_move = bola.x - bot.x;
        const dy_move = bola.y - bot.y;
        const distToBall = Math.sqrt(dx_move * dx_move + dy_move * dy_move);

        // Se o bot estiver perto o suficiente, ele chuta imediatamente
        if (distToBall < 50) {
            // Vira o Kick-Off para "inativo"
            isKickOffActive = false;
            kickOffTeam = null;
            broadcast({ type: "kickOffStarted" }); // Notifica clientes para iniciar
            
            // Chuta em direção ao meio-campo adversário
            const targetX = bot.team === 1 ? WIDTH * 0.75 : WIDTH * 0.25; 
            const targetY = HEIGHT / 2;

            const dx_target = targetX - bola.x;
            const dy_target = targetY - bola.y;
            const angle = Math.atan2(dy_target, dx_target);
            const force = 10; // Chute suave

            bola.vx = Math.cos(angle) * force;
            bola.vy = Math.sin(angle) * force;

            bola.lastTouchId = bot.id;
            bola.lastTouchName = bot.name;

            return; // Sai da função, Kick-Off realizado
        }
        
        // Se o bot precisa se mover para a bola
        if (distToBall > 1) {
            const ratio = BOT_SPEED / distToBall;
            bot.x += dx_move * ratio;
            bot.y += dy_move * ratio;
            
            // Aplica clamping para garantir que o bot mais próximo chegue na bola
            bot.x = Math.max(PLAYER_RADIUS, Math.min(bot.x, WIDTH - PLAYER_RADIUS));
            bot.y = Math.max(PLAYER_RADIUS, Math.min(bot.y, HEIGHT - PLAYER_RADIUS));
        }
        
        return; // Não executa o movimento/chute normal
    }
  } 
  
  // 2. MOVIMENTO SUAVE (CORREÇÃO DO TREMOR)
  const idealPos = calculateIdealBotPosition(bot, bola);

  let dx = idealPos.x - bot.x;
  let dy = idealPos.y - bot.y;
  const distToIdeal = Math.sqrt(dx * dx + dy * dy);
// Usa um fator de suavização (0.1 ou 0.2) para que o bot não teletransporte, mas deslize até a posição.
const smoothingFactor = 0.15; 
const currentSpeed = BOT_SPEED * smoothingFactor;
 
 if (distToIdeal > 1) {
    // Calcula o quanto mover, limitado pela velocidade e pelo fator de suavização
    const moveDistance = Math.min(distToIdeal, currentSpeed);
    
    // Normaliza o vetor de direção
    const ratio = moveDistance / distToIdeal;

    bot.x += dx * ratio;
    bot.y += dy * ratio; 
    
    // Aplica o clamping de borda do campo
    const playerRadius = PLAYER_RADIUS;
    bot.x = Math.max(playerRadius, Math.min(bot.x, WIDTH - playerRadius));
    bot.y = Math.max(playerRadius, Math.min(bot.y, HEIGHT - playerRadius));
}
  
  // 3. LÓGICA DE CHUTE (OFENSIVA/DEFENSIVA)
  const dx_kick = bola.x - bot.x;
  const dy_kick = bola.y - bot.y;
  const distToBall = Math.sqrt(dx_kick * dx_kick + dy_kick * dy_kick);

  if (distToBall < BOT_KICK_DISTANCE) {
    // O alvo do chute é o gol adversário (X=800 para Time 1, X=0 para Time 2)
    const targetX = bot.team === 1 ? WIDTH : 0; 
    const centerGoalY = HEIGHT / 2; 

    // Ajuste do erro de chute com base no papel
    let errorFactor = 1;
    if(bot.role === "DEFENDER") errorFactor = 1.5; // Zagueiro erra mais
    if(bot.role === "MIDFIELD") errorFactor = 0.5; // Meio-campo chuta com mais precisão
    if(bot.role === "ATTACKER") errorFactor = 0.8; // Atacante com erro moderado

    const kickError = (Math.random() * 2 - 1) * BOT_KICK_ERROR_MAX * errorFactor;
    let targetY = centerGoalY + kickError; 

    targetY = Math.max(GOAL_TOP - 50, Math.min(targetY, GOAL_BOTTOM + 50)); 
    
    // Calcula a direção do chute (em direção ao alvo imperfeito)
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

// [REVISADO E OTIMIZADO] - Lógica para garantir MAX_TEAM_SIZE (10 jogadores no total)
function balanceTeams() {
    let humanCount = { 1: 0, 2: 0 };
    let currentBots = { 1: [], 2: [] };
    const availableBotIds = new Set(BOT_IDS);
    
    // 1. Contar Humanos e separar Bots ativos
    for (const id in players) {
        const p = players[id];
        if (BOT_IDS.includes(id)) {
            currentBots[p.team].push(p);
            availableBotIds.delete(id); // Remove ID do bot ativo
        } else {
            humanCount[p.team]++;
        }
    }

    // 2. Loop para balancear ambos os times
    for (let team = 1; team <= 2; team++) {
        const requiredBots = MAX_TEAM_SIZE - humanCount[team];
        const botsInTeam = currentBots[team];

        // 2a. REMOVER Bots em EXCESSO (Ex: 3 humanos, 3 bots = 6 jogadores. Deve remover 1 bot)
        if (botsInTeam.length > requiredBots) {
            const botsToRemove = botsInTeam.slice(requiredBots);
            botsToRemove.forEach(bot => {
                console.log(`[BOT] Removendo Bot ${bot.id} (Excesso) do Time ${team}.`);
                delete players[bot.id];
                broadcast({ type: "playerLeft", playerId: bot.id });
                availableBotIds.add(bot.id); // Libera o ID
            });
            // O vetor botsInTeam agora tem o tamanho correto
            botsInTeam.splice(requiredBots); 
        }

        // 2b. ADICIONAR Bots FALTANTES
        let botsToCreate = requiredBots - botsInTeam.length;
        
        while (botsToCreate > 0 && availableBotIds.size > 0) {
            // Pega o primeiro ID disponível (Set não tem índice, então converte para Array)
            const botId = Array.from(availableBotIds).shift();
            availableBotIds.delete(botId); // Remove da lista de disponíveis
            
            // O índice inicial deve ser a próxima posição VAZIA:
            const initialPosIndex = humanCount[team] + botsInTeam.length;

            const initialPosArray = team === 1 ? team1Positions : team2Positions;
            // Se o índice for maior que o array de posições, algo está errado
            if (initialPosIndex >= initialPosArray.length) {
                 console.error(`[BOT] Limite de posições excedido no Time ${team}. Parando.`);
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
            botsInTeam.push(newBot); // Adiciona ao array temporário
            
            console.log(`[BOT] Adicionando Bot ${botId} (${initialPos.role}) no Time ${team}. Posição: ${initialPosIndex}`);
            broadcast({ type: "newPlayer", player: players[botId] });

            botsToCreate--;
        }
    }
}

// ------------------------------------------------------------------
// NOVA FUNÇÃO: Colisão entre Jogadores
// ------------------------------------------------------------------
function handlePlayerCollisions() {
  const playerIds = Object.keys(players);
  const radius = PLAYER_RADIUS;
  const diameter = radius * 2;
  const repulsionForce = 0.5; // Fator de força para afastar os jogadores 

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
// ------------------------------------------------------------------

setInterval(balanceTeams, 5000); // Roda a cada 5 segundos