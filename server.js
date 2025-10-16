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
const MIDFIELD_X = WIDTH / 2; // 400

const BOT_ID = "bot-player-001";
const BOT_NAME = "RAFABOT";
const BOT_SPEED = 4; // Um pouco mais lento que o humano
const BOT_KICK_DISTANCE = 40; // O Bot chuta quando a bola está próxima

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

const team1Positions = [
  { x: 120, y: 120 },
  { x: 120, y: 250 },
  { x: 120, y: 380 },
];

const team2Positions = [
  { x: 680, y: 120 },
  { x: 680, y: 250 },
  { x: 680, y: 380 },
];

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
    bola.y += bola.vy;

    // Atrito da bola
    bola.vx *= 0.98;
    bola.vy *= 0.98;
  } else {
    // Se o Kick-off estiver ativo, a bola fica parada e no centro
    bola.x = WIDTH / 2;
    bola.y = HEIGHT / 2;
    bola.vx = 0;
    bola.vy = 0;
  }
  // Colisão com a parede esquerda (FORA da área do gol)

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
  } // ------------------------------------------------------------------ 

// Colisão com jogadores
  for (let id in players) {
    const p = players[id];
    let dx = bola.x - p.x;
    let dy = bola.y - p.y;
    let dist = Math.sqrt(dx * dx + dy * dy);
    const playerRadius = PLAYER_RADIUS; // Usa a constante definida no topo

    if (dist < bola.raio + playerRadius) {
      // 15 = raio do jogador
      let angle = Math.atan2(dy, dx);
      let force = 12;
      bola.vx = Math.cos(angle) * force;
      bola.vy = Math.sin(angle) * force; // Empurra jogador levemente pra fora da bola
      const overlap = bola.raio + playerRadius - dist;
      p.x -= Math.cos(angle) * overlap;
      p.y -= Math.sin(angle) * overlap; // É essencial sincronizar a posição corrigida do jogador

      bola.lastTouchId = id;
      bola.lastTouchName = p.name;
      broadcast({ type: "playerUpdate", player: p });
    }
  } // ------------------------------------------------------------------ // Lógica de GOL (Agora usando GOAL_TOP/BOTTOM e checagem de centro) // ------------------------------------------------------------------ // Gol Time 2 (Esquerda) // Gol Time 2 (Esquerda)

  if (players[BOT_ID]) {
        handleBotMovement(players[BOT_ID], bola);
        // Garante que o cliente tenha a nova posição do bot
        broadcast({ type: "playerUpdate", player: players[BOT_ID] }); 
    }

  // server.js: Modifique a Lógica de GOL (dentro do loop setInterval)

  if (bola.x - bola.raio <= 0 && bola.y >= GOAL_TOP && bola.y <= GOAL_BOTTOM) {
    if (bola.x < 0) {
      score[2]++;
      const scorerName = bola.lastTouchName || "o time";

      // NOVO: Checa a regra de 5 gols (Fim de Jogo)
      if (score[2] >= 5) {
        broadcast({ type: "gameOver", score });
        if (gameInterval) clearInterval(gameInterval);
        return;
      }

      // NOVO: Inicia o Kick-off (Time 1 sofreu, Time 1 faz a saída)
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
      const scorerName = bola.lastTouchName || "o time";

      // NOVO: Checa a regra de 5 gols (Fim de Jogo)
      if (score[1] >= 5) {
        broadcast({ type: "gameOver", score });
        if (gameInterval) clearInterval(gameInterval);
        return;
      }

      // NOVO: Inicia o Kick-off (Time 2 sofreu, Time 2 faz a saída)
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

        let initialPos;

        // Usa o time vindo do cliente (e corrigido acima)
        if (msg.player.team === 1) {
          const index = Math.min(teamCount[1] - 1, team1Positions.length - 1);
          initialPos = team1Positions[index] || { x: 150, y: 200 };
        } else {
          const index = Math.min(teamCount[2] - 1, team2Positions.length - 1);
          initialPos = team2Positions[index] || { x: 450, y: 200 };
        }

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
            const force = 24; // Força do chute
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

// server.js: Adicione esta nova função no final do arquivo (após resetBola())

function restartGame() {
  // 1. Resetar placar e tempo
  score[1] = 0;
  score[2] = 0;
  gameTime = 180; // 3 minutos
  isKickOffActive = false; // NOVO: Limpa o estado de Kick-off
  kickOffTeam = null; // NOVO: Limpa o time da saída de bola

  // 2. Limpar e recriar o loop de tempo
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
  }, 1000);

  // 3. Resetar a posição dos jogadores
  resetAllPlayers(); // NOVO: Usando a nova função

  // 4. Resetar bola e notificar todos os clientes
  resetBola();
  broadcast({ type: "gameRestarted", score });
}

function resetAllPlayers() {
  let team1Index = 0;
  let team2Index = 0;
  for (let id in players) {
    const p = players[id];
    let initialPos;
    if (p.team === 1) {
      // Usa o array de posições do time 1
      initialPos = team1Positions[team1Index++ % team1Positions.length];
    } else {
      // Usa o array de posições do time 2
      initialPos = team2Positions[team2Index++ % team2Positions.length];
    }
    p.x = initialPos.x;
    p.y = initialPos.y;
    // Broadcast para que os clientes atualizem a posição do jogador
    broadcast({ type: "playerUpdate", player: p });
  }
}

function assignUniquePlayerNumber(teamId) {
  const teamSet = usedNumbers[teamId];
  // Define o limite de números (1 a 11)
  const availableNumbers = Array.from({ length: 11 }, (_, i) => i + 1).filter(
    (num) => !teamSet.has(num)
  );

  // Se não houver números disponíveis (o que só aconteceria com mais de 11 jogadores), retorna null
  if (availableNumbers.length === 0) {
    return null;
  }

  // Escolhe um número aleatório entre os disponíveis
  const randomIndex = Math.floor(Math.random() * availableNumbers.length);
  const newNumber = availableNumbers[randomIndex];

  // Adiciona o número ao set de usados
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
    const goalX = bot.team === 1 ? 0 : WIDTH; // Gol do Time 1 em X=0, Time 2 em X=800
    const goalY = HEIGHT / 2;
    const playerRadius = PLAYER_RADIUS;

    // 1. Encontra o vetor da bola para o gol
    const dxGoal = goalX - ball.x;
    const dyGoal = goalY - ball.y;

    // 2. Normaliza e define a distância do Bot em relação ao gol.
    // O Bot deve tentar ficar a uma distância segura da bola, mas entre ela e o gol.
    // Distância do gol: ex: 150 pixels
    const botDistanceToGoal = 150; 
    
    // 3. Calcula a posição ideal (ponto na linha bola -> gol, a 150px do gol)
    const totalDistance = Math.sqrt(dxGoal * dxGoal + dyGoal * dyGoal);
    
    let idealX;
    let idealY;

    if (totalDistance > 0) {
        // Interpolação linear: calcula o ponto na linha
        const ratio = (totalDistance - botDistanceToGoal) / totalDistance;
        idealX = ball.x + dxGoal * ratio;
        idealY = ball.y + dyGoal * ratio;
    } else {
        // Bola parada no centro: Bot volta para a posição inicial
        idealX = bot.team === 1 ? WIDTH / 4 : WIDTH * 3 / 4;
        idealY = HEIGHT / 2;
    }

    // 4. Limita a posição X para o lado do campo do Bot (para defesa)
    if (bot.team === 1) {
        // Time 1 (esquerda): X deve ser < MIDFIELD_X
        idealX = Math.min(idealX, MIDFIELD_X - playerRadius);
    } else {
        // Time 2 (direita): X deve ser > MIDFIELD_X
        idealX = Math.max(idealX, MIDFIELD_X + playerRadius);
    }
    
    // 5. Aplica clamping de bordas (como em um jogador normal)
    idealX = Math.max(playerRadius, Math.min(idealX, WIDTH - playerRadius));
    idealY = Math.max(playerRadius, Math.min(idealY, HEIGHT - playerRadius));

    return { x: idealX, y: idealY };
}


function handleBotMovement(bot, bola) {
    // 1. Calculamos onde o Bot *deveria* estar
    const idealPos = calculateIdealBotPosition(bot, bola);
    
    // 2. Calculamos o vetor de movimento do Bot para a posição ideal
    let dx = idealPos.x - bot.x;
    let dy = idealPos.y - bot.y;
    const distToIdeal = Math.sqrt(dx * dx + dy * dy);
    
    // 3. Normaliza o vetor e move o Bot na velocidade definida
    if (distToIdeal > 1) { // Só move se estiver longe da posição ideal
        dx = dx / distToIdeal;
        dy = dy / distToIdeal;
        
        bot.x += dx * BOT_SPEED;
        bot.y += dy * BOT_SPEED;
        
        // Aplica o clamping de borda do campo (garante que não saia)
        bot.x = Math.max(PLAYER_RADIUS, Math.min(bot.x, WIDTH - PLAYER_RADIUS));
        bot.y = Math.max(PLAYER_RADIUS, Math.min(bot.y, HEIGHT - PLAYER_RADIUS));
    }
    
    // 4. Lógica de CHUTE (Se a bola estiver perto)
    const dx_kick = bola.x - bot.x;
    const dy_kick = bola.y - bot.y;
    const distToBall = Math.sqrt(dx_kick * dx_kick + dy_kick * dy_kick);

    if (distToBall < BOT_KICK_DISTANCE) {
        // Chute simples: apenas empurra a bola para longe
        const angle = Math.atan2(dy_kick, dx_kick);
        const force = 18; // Força do chute do Bot
        
        // O Bot só chuta se a bola estiver se movendo *em direção* ao gol dele (lógica defensiva)
        // O bot do time 1 (esquerda) só chuta se a bola estiver movendo para X crescente (para a direita)
        if (bot.team === 1 && bola.vx > 0) {
             bola.vx = Math.cos(angle) * force;
             bola.vy = Math.sin(angle) * force;
             bola.lastTouchId = bot.id;
             bola.lastTouchName = bot.name;
        } 
        // O bot do time 2 (direita) só chuta se a bola estiver movendo para X decrescente (para a esquerda)
        else if (bot.team === 2 && bola.vx < 0) {
             bola.vx = Math.cos(angle) * force;
             bola.vy = Math.sin(angle) * force;
             bola.lastTouchId = bot.id;
             bola.lastTouchName = bot.name;
        }
        
        // IMPORTANTE: Bloqueamos o movimento do bot durante o kick-off para evitar que ele inicie o jogo
        // Apenas jogadores humanos devem fazer o kick-off
        // Se a lógica do kick-off for baseada no player, essa parte não será executada pelo Bot
    }
}


function balanceTeams() {
    let teamCount = { 1: 0, 2: 0 };
    let botIsActive = false;
    let botTeam = null;

    // 1. Conta jogadores e checa Bot
    for (const id in players) {
        if (id === BOT_ID) {
            botIsActive = true;
            botTeam = players[id].team;
        } else {
            teamCount[players[id].team]++;
        }
    }

    const diff = Math.abs(teamCount[1] - teamCount[2]);
    let teamToHelp = null;

    if (diff >= 1) { // Decide se precisa de Bot
        if (teamCount[1] < teamCount[2]) {
            teamToHelp = 1;
        } else if (teamCount[2] < teamCount[1]) {
            teamToHelp = 2;
        }
    }
    
    // 2. Lógica de Adicionar/Mover/Remover Bot
    
    // Caso 1: Bot necessário e não está presente, ou está no time errado
    if (teamToHelp && (!botIsActive || botTeam !== teamToHelp)) {
        console.log(`[BOT] Adicionando/Movendo BOT para o Time ${teamToHelp}`);
        
        // Posição inicial do Bot (zagueiro no meio-campo)
        const startX = teamToHelp === 1 ? MIDFIELD_X - 100 : MIDFIELD_X + 100;
        const startY = HEIGHT / 2;

        players[BOT_ID] = {
            id: BOT_ID,
            name: BOT_NAME,
            team: teamToHelp,
            x: startX,
            y: startY,
            number: 99, // Um número distintivo
        };
        // Notifica todos os clientes que um novo "jogador" (Bot) se juntou
        broadcast({ type: "newPlayer", player: players[BOT_ID] });
        return;
    }
    
    // Caso 2: Equipe balanceada e Bot está presente (Bot deve ser removido)
    if (!teamToHelp && botIsActive) {
        console.log("[BOT] Removendo BOT. Times equilibrados.");
        delete players[BOT_ID];
        // Notifica todos os clientes que o Bot saiu
        broadcast({ type: "playerLeft", playerId: BOT_ID });
        return;
    }
    
    // Caso 3: Bot está presente e no time correto (apenas atualiza sua posição no loop principal)
    // Nenhuma ação aqui, a atualização do Bot é feita no gameLoop.
}

setInterval(balanceTeams, 5000);