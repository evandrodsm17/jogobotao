const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

const wss = new WebSocket.Server({ port: 8080 });
console.log("🚀 Servidor rodando na porta 8080");

let players = {};
let bola = { x: 300, y: 200, vx: 0, vy: 0, raio: 8 };
const WIDTH = 600,  HEIGHT = 400;

// ADICIONE ESTA LINHA:
let teamCount = {1:0, 2:0}; 

// Atualiza física da bola a cada frame
setInterval(() => {
  // Atualiza posição
  bola.x += bola.vx;
  bola.y += bola.vy;

  // Atrito da bola
  bola.vx *= 0.95;
  bola.vy *= 0.95;

  // Rebote nas paredes
  if (bola.x - bola.raio < 0 || bola.x + bola.raio > WIDTH) bola.vx *= -1;
  if (bola.y - bola.raio < 0 || bola.y + bola.raio > HEIGHT) bola.vy *= -1;

  // Colisão com jogadores
  for (let id in players) {
    const p = players[id];
    let dx = bola.x - p.x;
    let dy = bola.y - p.y;
    let dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bola.raio + 12) {
      // 12 = raio do jogador
      let angle = Math.atan2(dy, dx);
      let force = 12;
      bola.vx = Math.cos(angle) * force;
      bola.vy = Math.sin(angle) * force;
      // Empurra jogador levemente pra fora da bola
      const overlap = bola.raio + 12 - dist;
      p.x -= Math.cos(angle) * overlap;
      p.y -= Math.sin(angle) * overlap;
    }
  }

  // Envia atualização da bola pra todos
  broadcast({ type: "update", bola });
}, 30); // ~33 FPS

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
        players[playerId] = {
          id: playerId,
          ...msg.player,
          x: msg.player.x || 150,
          y: msg.player.y || 200,
        };
        broadcast({ type: "newPlayer", player: players[playerId] });
        break;

      case "input":
        const p = players[msg.playerId];
        if (!p) return;
        const speed = 5;
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
