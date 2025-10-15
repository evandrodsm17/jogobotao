const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

const wss = new WebSocket.Server({ port: 8080 });
console.log("🚀 Servidor rodando na porta 8080");

const WIDTH = 800, HEIGHT = 500;
let players = {};
let bola = { x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0, raio: 10 }; // NOVO: Raio da bola (ex: 10)

const team1Positions = [
  { x: 120, y: 120 }, // Posições mais distantes das bordas
  { x: 120, y: 250 },
  { x: 120, y: 380 },
];

const team2Positions = [
  { x: 680, y: 120 }, // Posições no lado oposto (800 - 120 = 680)
  { x: 680, y: 250 },
  { x: 680, y: 380 },
];

// ADICIONE ESTA LINHA:
let teamCount = { 1: 0, 2: 0 };
const score = { 1: 0, 2: 0 };
let gameTime = 180; // 3 minutos em segundos
let gameInterval = null;
// Atualiza física da bola a cada frame
setInterval(() => {
  // Atualiza posição
  bola.x += bola.vx;
  bola.y += bola.vy;

  // Atrito da bola
  bola.vx *= 0.98;
  bola.vy *= 0.98;

  // Rebote nas paredes
  if (bola.x - bola.raio < 0 && (bola.y < 150 || bola.y > 250)) bola.vx *= -1;
  if (bola.x + bola.raio > WIDTH && (bola.y < 150 || bola.y > 250))
    bola.vx *= -1;
  if (bola.y - bola.raio < 0 || bola.y + bola.raio > HEIGHT) bola.vy *= -1;

  // Colisão com jogadores
  for (let id in players) {
    const p = players[id];
    let dx = bola.x - p.x;
    let dy = bola.y - p.y;
    let dist = Math.sqrt(dx * dx + dy * dy);
    const playerRadius = 15;

    if (dist < bola.raio + playerRadius) {
      // 15 = raio do jogador
      let angle = Math.atan2(dy, dx);
      let force = 12;
      bola.vx = Math.cos(angle) * force;
      bola.vy = Math.sin(angle) * force;
      // Empurra jogador levemente pra fora da bola
      const overlap = bola.raio + playerRadius - dist;
      p.x -= Math.cos(angle) * overlap;
      p.y -= Math.sin(angle) * overlap;

      // É essencial sincronizar a posição corrigida do jogador
      broadcast({ type: "playerUpdate", player: p });
    }
  }

  // Lógica de GOL (Reinserida)
  const goalLineY1 = (HEIGHT - 100) / 2; // (500 - 100) / 2 = 200
  const goalLineY2 = goalLineY1 + 100; // 200 + 100 = 300

  // Gol Time 2 (Esquerda)
  if (bola.x - bola.raio <= 0 && bola.y >= goalLineY1 && bola.y <= goalLineY2) {
    score[2]++;
    broadcast({ type: "scoreUpdate", score });
    resetBola();
  }
  // Gol Time 1 (Direita)
  else if (
    bola.x + bola.raio >= WIDTH &&
    bola.y >= goalLineY1 &&
    bola.y <= goalLineY2
  ) {
    score[1]++;
    broadcast({ type: "scoreUpdate", score });
    resetBola();
  }

  // Envia atualização da bola pra todos
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
  const team = teamCount[1] <= teamCount[2] ? 1 : 2; // Servidor calcula o time
  teamCount[team]++;
  ws.id = playerId;
  console.log(`🟢 Novo jogador conectado: ${playerId}`);

  // Envia ID e estado inicial
  ws.send(JSON.stringify({ type: "welcome", playerId, team }));
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
        // ATRIBUIÇÃO DE POSIÇÃO NO SERVIDOR (NOVO CÓDIGO)
        let initialPos = null;
        // Usa a contagem atualizada. teamCount[team] - 1 deve ser o índice correto.
        if (msg.player.team === 1) {
          // Garante que não ultrapassa o limite do array
          const index = Math.min(teamCount[1] - 1, team1Positions.length - 1);
          initialPos = team1Positions[index] || { x: 150, y: 200 };
        } else {
          const index = Math.min(teamCount[2] - 1, team2Positions.length - 1);
          initialPos = team2Positions[index] || { x: 450, y: 200 };
        }

        players[playerId] = {
          id: playerId,
          name: msg.player.name, // <--- USA O NOME ENVIADO PELO CLIENTE
          team: msg.player.team, // Adicione o team para garantir consistência          x: msg.player.x || 150,
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
        const playerRadius = 12; // Já definido para a bola, mas bom explicitar aqui também

        switch (msg.input) {
          case "up":
            p.y -= speed;
            break;
          case "down":
            p.y += speed;
            break;
          case "left":
            p.x -= speed;
            break;
          case "right":
            p.x += speed;
            break;
          case "kick": // chute
            {
              // direção da bola relativa ao jogador
              const dx = bola.x - p.x;
              const dy = bola.y - p.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < 50) {
                // só permite chute se a bola estiver perto do jogador
                const angle = Math.atan2(dy, dx);
                const force = 36; // 12 (normal) * 3
                bola.vx = Math.cos(angle) * force;
                bola.vy = Math.sin(angle) * force;
              }
            }
            break;
        }

        // ADICIONE ESTA LÓGICA DE CLAMPING PARA O JOGADOR
        p.x = Math.max(playerRadius, Math.min(p.x, WIDTH - playerRadius));
        p.y = Math.max(playerRadius, Math.min(p.y, HEIGHT - playerRadius));

        // envia posição final para todos
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
  bola.vy = 0;
  // broadcast do reset da bola para o cliente
  broadcast({ type: "update", bola });
}
