const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

const wss = new WebSocket.Server({ port: 8080 });
console.log("🚀 Servidor rodando na porta 8080");

const WIDTH = 800;
const HEIGHT = 500;
const DIAGONAL_FACTOR = 0.7071; // Fator para manter a velocidade constante na diagonal (1 / sqrt(2))

// CONSTANTES DE GOL AJUSTADAS
const GOAL_HEIGHT = 100; // Gol de 100px de altura
const GOAL_TOP = (HEIGHT - GOAL_HEIGHT) / 2; // (500 - 100) / 2 = 200
const GOAL_BOTTOM = GOAL_TOP + GOAL_HEIGHT; // 200 + 100 = 300

const PLAYER_RADIUS = 15; // Raio do jogador consistente

let players = {};
let bola = { x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0, raio: 10 };

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
let gameInterval = null;

// Atualiza física da bola a cada frame
setInterval(() => {
  // Atualiza posição
  bola.x += bola.vx;
  bola.y += bola.vy; // Atrito da bola

  bola.vx *= 0.98;
  bola.vy *= 0.98; // ------------------------------------------------------------------ // CORREÇÃO 1: NOVA LÓGICA DE REBOTE E COLISÃO DE PAREDES // ------------------------------------------------------------------ // Colisão com a parede esquerda (FORA da área do gol)

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
  } // ------------------------------------------------------------------ // Colisão com jogadores
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

      broadcast({ type: "playerUpdate", player: p });
    }
  } // ------------------------------------------------------------------ // Lógica de GOL (Agora usando GOAL_TOP/BOTTOM e checagem de centro) // ------------------------------------------------------------------ // Gol Time 2 (Esquerda)

  if (bola.x - bola.raio <= 0 && bola.y >= GOAL_TOP && bola.y <= GOAL_BOTTOM) {
    // Para ser gol, o centro da bola deve ter cruzado o limite
    if (bola.x < 0) {
      score[2]++;
      broadcast({ type: "scoreUpdate", score });
      resetBola();
      return;
    }
  } // Gol Time 1 (Direita)
  else if (
    bola.x + bola.raio >= WIDTH &&
    bola.y >= GOAL_TOP &&
    bola.y <= GOAL_BOTTOM
  ) {
    // Para ser gol, o centro da bola deve ter cruzado o limite
    if (bola.x > WIDTH) {
      score[1]++;
      broadcast({ type: "scoreUpdate", score });
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

        players[playerId] = {
          id: playerId,
          name: msg.player.name,
          team: msg.player.team,
          x: initialPos.x, // POSIÇÃO ATRIBUÍDA PELO SERVIDOR
          y: initialPos.y, // POSIÇÃO ATRIBUÍDA PELO SERVIDOR
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

        // NOVO: Lógica para calcular a direção X e Y combinada
        const input = msg.input;

        if (input.includes("up")) dy -= 1;
        if (input.includes("down")) dy += 1;
        if (input.includes("Left")) dx -= 1;
        if (input.includes("Right")) dx += 1;

        // Verifica se é movimento diagonal
        if (dx !== 0 && dy !== 0) {
          finalSpeed = speed * DIAGONAL_FACTOR;
        }

        p.x += dx * finalSpeed;
        p.y += dy * finalSpeed;

        // Lógica de chute
        if (input === "kick") {
          // Agora o chute é uma direção enviada pelo loop
          // ... (A sua lógica de chute original deve vir aqui)
          {
            // direção da bola relativa ao jogador
            const dx_kick = bola.x - p.x;
            const dy_kick = bola.y - p.y;
            const dist = Math.sqrt(dx_kick * dx_kick + dy_kick * dy_kick);
            if (dist < 50) {
              const angle = Math.atan2(dy_kick, dx_kick);
              const force = 36;
              bola.vx = Math.cos(angle) * force;
              bola.vy = Math.sin(angle) * force;
            }
          }
        } // ADICIONE ESTA LÓGICA DE CLAMPING PARA O JOGADOR

        // REMOVA TODO O switch (msg.input) antigo que lidava com 'up', 'down', etc.
        // E substitua pelo novo código de cálculo de dx/dy e chute acima.

        p.x = Math.max(playerRadius, Math.min(p.x, WIDTH - playerRadius));
        p.y = Math.max(playerRadius, Math.min(p.y, HEIGHT - playerRadius)); // envia posição final para todos

        broadcast({ type: "playerUpdate", player: p });
        break;
    }
  });

  ws.on("close", () => {
    console.log(`🔴 Jogador saiu: ${playerId}`);
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
  bola.vy = 0; // broadcast do reset da bola para o cliente
  broadcast({ type: "update", bola });
}
