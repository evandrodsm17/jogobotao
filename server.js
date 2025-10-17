const WebSocket = require("ws");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

// --- Configuração da Porta ---
const PORT = process.env.PORT || 8080;

// --- 1. Cria um Servidor HTTP NATIVO ---
const server = http.createServer((req, res) => {
    // ESSENCIAL: Responde ao Health Check do Render e serve o index.html
    if (req.url === "/") {
        const filePath = path.join(__dirname, "index.html"); 

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
        // Para qualquer outra rota
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

// --- CONSTANTES DE JOGO ---
const WIDTH = 800;
const HEIGHT = 500;
const DIAGONAL_FACTOR = 0.7071;

const BOT_IDS = [
    "bot-player-001", "bot-player-002", "bot-player-003",
    "bot-player-004", "bot-player-005", "bot-player-006",
];

const MAX_TEAM_SIZE = 3; // *** TAMANHO MÁXIMO DO TIME: 3 JOGADORES ***
const MIDFIELD_X = WIDTH / 2;

// Ajuste fino na velocidade e força para evitar que os bots fiquem muito rápidos
const BOT_SPEED = 1.2; 
const BOT_KICK_DISTANCE = 40;
const BOT_KICK_ERROR_MAX = 100;

// CONSTANTES DE GOL
const GOAL_HEIGHT = 100;
const GOAL_TOP = (HEIGHT - GOAL_HEIGHT) / 2;
const GOAL_BOTTOM = GOAL_TOP + GOAL_HEIGHT;

const PLAYER_RADIUS = 15;

// --- POSIÇÕES INICIAIS PARA 3 JOGADORES (FIXAS POR ROLE) ---
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

// --- VARIÁVEIS DE ESTADO ---
let players = {};
let hostId = null; // ID do jogador que é o Host
let bola = {
    x: WIDTH / 2,
    y: HEIGHT / 2,
    vx: 0,
    vy: 0,
    raio: 10,
    lastTouchId: null,
    lastTouchName: null,
};

const usedNumbers = {
    team1: new Set(),
    team2: new Set(),
};

const score = { 1: 0, 2: 0 };
let gameTime = 180;
let isKickOffActive = false;
let kickOffTeam = null;
let gameInterval = null;

// --- FUNÇÕES DE UTENSÍLIOS ---

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

function assignUniquePlayerNumber(teamId) {
    const teamSet = usedNumbers[teamId];
    const availableNumbers = Array.from({ length: 11 }, (_, i) => i + 1).filter(
        (num) => !teamSet.has(num)
    );

    if (availableNumbers.length === 0) return null;

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


// --- FUNÇÕES DE GERENCIAMENTO DE JOGO (HOST) ---

function resetAllPlayers() {
    // 1. Separa os jogadores (garantindo a ordem de posições fixas por role)
    const team1Players = Object.values(players).filter(p => p.team === 1);
    const team2Players = Object.values(players).filter(p => p.team === 2);

    // Mapeia jogadores para suas posições de formação (baseado no role)
    const positionMap = (teamPlayers, teamPositions) => {
        const roles = teamPositions.map(p => p.role);
        // Cria uma lista ordenada: DEFENDER, MIDFIELD, ATTACKER
        const sortedPlayers = [];
        
        for (const role of roles) {
            const playerInRole = teamPlayers.find(p => p.role === role);
            if (playerInRole) {
                sortedPlayers.push(playerInRole);
            }
        }
        return sortedPlayers;
    };
    
    const sortedTeam1 = positionMap(team1Players, team1Positions);
    const sortedTeam2 = positionMap(team2Players, team2Positions);

    // 2. Reposiciona Time 1
    for (let i = 0; i < sortedTeam1.length; i++) {
        const p = sortedTeam1[i];
        const initialPos = team1Positions[i]; // Usa o índice de 0 a 2 para pegar o Def, Mid ou Att.

        p.x = initialPos.x;
        p.y = initialPos.y;
        p.role = initialPos.role; 
        broadcast({ type: "playerUpdate", player: p });
    }

    // 3. Reposiciona Time 2
    for (let i = 0; i < sortedTeam2.length; i++) {
        const p = sortedTeam2[i];
        const initialPos = team2Positions[i];

        p.x = initialPos.x;
        p.y = initialPos.y;
        p.role = initialPos.role;
        broadcast({ type: "playerUpdate", player: p });
    }
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
    console.log("[HOST] Jogo Reiniciado.");
}

function startGame() {
    if (gameTime <= 0) {
        restartGame();
        return;
    }
    
    if (isKickOffActive) {
        isKickOffActive = false;
        kickOffTeam = null;
        broadcast({ type: "kickOffStarted" });
    }
    console.log("[HOST] Partida iniciada/despausada pelo Host.");
}

// --- FUNÇÕES DE CONTROLE DE BOT DO HOST ---

function getAvailableBotId() {
    const activeBotIds = new Set(Object.keys(players).filter(id => BOT_IDS.includes(id)));
    for (const botId of BOT_IDS) {
        if (!activeBotIds.has(botId)) {
            return botId;
        }
    }
    return null;
}

function addBot(team, role) {
    const currentTeamSize = Object.values(players).filter(p => p.team === team).length;
    if (currentTeamSize >= MAX_TEAM_SIZE) {
        console.log(`[BOT MANAGER] Time ${team} já está no tamanho máximo.`);
        return;
    }

    const botId = getAvailableBotId();
    if (!botId) {
        console.log("[BOT MANAGER] Sem IDs de bot disponíveis.");
        return;
    }

    const initialPosArray = team === 1 ? team1Positions : team2Positions;
    const existingRoles = Object.values(players).filter(p => p.team === team).map(p => p.role);
    
    let initialPos = null;
    // Tenta encontrar a primeira posição disponível que corresponda ao ROLE desejado
    const targetRolePos = initialPosArray.find(pos => pos.role === role);
    if (targetRolePos && !existingRoles.includes(role)) {
         initialPos = targetRolePos;
    } else {
        // Se o ROLE já estiver ocupado ou não existir, pega a próxima vaga livre na formação
        initialPos = initialPosArray.find(pos => !existingRoles.includes(pos.role));
    }

    if (!initialPos) {
        console.log(`[BOT MANAGER] Todas as posições da formação estão ocupadas no Time ${team}.`);
        return;
    }
    
    const BOT_NAME = team === 1 ? `RAFAEL-BOT-${botId.slice(-3)}` : `MARCELAO-BOT-${botId.slice(-3)}`;

    const newBot = {
        id: botId,
        name: BOT_NAME,
        team: team,
        x: initialPos.x,
        y: initialPos.y,
        role: initialPos.role, // O bot assume o papel da vaga
        number: 90 + BOT_IDS.indexOf(botId) + 1,
    };
    
    players[botId] = newBot;
    console.log(`[BOT MANAGER] Host adicionou Bot ${botId} (${newBot.role}) no Time ${team}.`);
    broadcast({ type: "newPlayer", player: players[botId] });
    
    resetAllPlayers(); // Reposiciona todos para a nova formação
}

function removeBot(team, role) {
    // 1. Tenta encontrar um bot com o papel exato para remoção
    const botToRemove = Object.values(players).find(p => 
        BOT_IDS.includes(p.id) && p.team === team && p.role === role
    );
    
    if (botToRemove) {
        removeBotById(botToRemove.id);
        resetAllPlayers(); // Reposiciona o time após a remoção
        return;
    } 
    
    // 2. Se não encontrar o papel exato, remove o primeiro bot que encontrar
    const anyBot = Object.values(players).find(p => BOT_IDS.includes(p.id) && p.team === team);
    if (anyBot) {
        removeBotById(anyBot.id);
        resetAllPlayers(); // Reposiciona o time após a remoção
        return;
    }
    
    console.log(`[BOT MANAGER] Nenhum bot encontrado para remover no Time ${team} com papel ${role}.`);
}

function removeBotById(botId) {
    if (players[botId]) {
        console.log(`[BOT MANAGER] Host removeu Bot ${botId}.`);
        delete players[botId];
        broadcast({ type: "playerLeft", playerId: botId });
    }
}

// --- LÓGICA DE MOVIMENTO E IA DO BOT ---

function calculateIdealBotPosition(bot, ball) {
    const playerRadius = PLAYER_RADIUS;
    const isBotTeam1 = bot.team === 1;
    const botRole = bot.role || "MIDFIELD";
    
    let idealX, idealY;
    
    const teamPositions = isBotTeam1 ? team1Positions : team2Positions;
    let homePos = teamPositions.find(pos => pos.role === botRole) || teamPositions[0];

    const isBallInOurHalf = isBotTeam1 ? ball.x < MIDFIELD_X : ball.x > MIDFIELD_X;

    // 1. Definição da Posição Base Tática
    if (botRole === "DEFENDER") {
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
        
        const maxDefensiveX = isBotTeam1 ? MIDFIELD_X - 10 : MIDFIELD_X + 10;
        idealX = isBotTeam1 ? Math.min(idealX, maxDefensiveX) : Math.max(idealX, maxDefensiveX);
        
        if(!isBallInOurHalf) {
            idealX = homePos.x;
            idealY = homePos.y;
        }

    } else if (botRole === "MIDFIELD") {
        idealX = ball.x;
        idealY = ball.y;

        if (isBallInOurHalf) {
            idealX = isBotTeam1 ? Math.max(ball.x, homePos.x - 50) : Math.min(ball.x, homePos.x + 50);
            idealY = ball.y;
        }
        
        const minX = isBotTeam1 ? 150 : WIDTH - 350;
        const maxX = isBotTeam1 ? WIDTH - 200 : 200;
        
        idealX = Math.max(minX, Math.min(idealX, maxX));

    } else if (botRole === "ATTACKER") {
        idealX = ball.x;
        idealY = ball.y;

        const minOffensiveX = isBotTeam1 ? MIDFIELD_X + 10 : MIDFIELD_X - 10;
        idealX = isBotTeam1 ? Math.max(idealX, minOffensiveX) : Math.min(idealX, minOffensiveX);

        const safeZoneX = isBotTeam1 ? WIDTH - playerRadius * 3 : playerRadius * 3;
        idealX = isBotTeam1
            ? Math.min(idealX, safeZoneX)
            : Math.max(idealX, safeZoneX);
    }
    
    // 2. Comportamento de Desagregação (Evitar Aglomeração)
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

function handleBotMovement(bot, bola) {
    // 1. LÓGICA DE KICK-OFF DO BOT (Prioridade)
    if (isKickOffActive && bot.team === kickOffTeam) {
        
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
            // Move o bot para a posição inicial (para não atrapalhar)
            const teamPositions = bot.team === 1 ? team1Positions : team2Positions;
            const initialPos = teamPositions.find(p => p.role === bot.role);
            
            if(initialPos) {
                 const dx_move = initialPos.x - bot.x;
                 const dy_move = initialPos.y - bot.y;
                 const distToInitial = Math.sqrt(dx_move * dx_move + dy_move * dy_move);

                 if (distToInitial > 1) {
                     const ratio = BOT_SPEED / distToInitial;
                     bot.x += dx_move * ratio;
                     bot.y += dy_move * ratio;
                 }
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
    
    // 2. MOVIMENTO SUAVE
    const idealPos = calculateIdealBotPosition(bot, bola);

    let dx = idealPos.x - bot.x;
    let dy = idealPos.y - bot.y;
    const distToIdeal = Math.sqrt(dx * dx + dy * dy);

    const smoothingFactor = 0.4;
    const maxMoveSpeed = BOT_SPEED * 1.2; // Velocidade ajustada

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
        let force = 10; 
        let errorFactor = 1;

        if (bot.role === "DEFENDER") {
            targetX = bot.team === 1 ? WIDTH * 0.75 : WIDTH * 0.25; 
            targetY = HEIGHT / 2;
            force = 8; // Chute fraco para alívio
            errorFactor = 2.0;
        } else if (bot.role === "MIDFIELD") {
            targetX = bot.team === 1 ? WIDTH : 0; 
            targetY = HEIGHT / 2;
            force = 7; // Chute controlado
            errorFactor = 0.5;
        } else { // ATTACKER
            targetX = bot.team === 1 ? WIDTH : 0; 
            targetY = HEIGHT / 2;
            force = 12; // Chute forte
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

// --- LOOP DE JOGO PRINCIPAL ---
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

    // Colisão com as paredes e jogadores... (restante do loop)
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

    // Lógica de GOL
    let goalScored = false;
    let scoringTeam = null;
    let kickOffStartTeam = null;
    
    if (bola.x - bola.raio <= 0 && bola.y >= GOAL_TOP && bola.y <= GOAL_BOTTOM) {
        if (bola.x < 0) {
            score[2]++;
            scoringTeam = 2;
            kickOffStartTeam = 1;
            goalScored = true;
        }
    } else if (
        bola.x + bola.raio >= WIDTH &&
        bola.y >= GOAL_TOP &&
        bola.y <= GOAL_BOTTOM
    ) {
        if (bola.x > WIDTH) {
            score[1]++;
            scoringTeam = 1;
            kickOffStartTeam = 2;
            goalScored = true;
        }
    }

    if (goalScored) {
        const scorerName = bola.lastTouchName || "o time";

        if (score[1] >= 5 || score[2] >= 5) {
            broadcast({ type: "gameOver", score });
            if (gameInterval) clearInterval(gameInterval);
            return;
        }

        isKickOffActive = true;
        kickOffTeam = kickOffStartTeam;
        resetAllPlayers();
        resetBola();

        broadcast({
            type: "scoreUpdate",
            score,
            scorer: scorerName,
            team: scoringTeam,
            kickOff: true,
            kickOffTeam: kickOffStartTeam,
        });
        return;
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

// --- CONEXÃO E HOST MANAGEMENT ---
wss.on("connection", (ws) => {
    const playerId = uuidv4();
    ws.id = playerId;
    
    // LÓGICA DO HOST
    if (!hostId) {
        hostId = playerId;
        console.log(`⭐ Jogador ${playerId} é o NOVO HOST.`);
        ws.send(JSON.stringify({ type: "hostStatus", isHost: true }));
    } else {
        ws.send(JSON.stringify({ type: "hostStatus", isHost: false, hostId: hostId }));
    }

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
                if (msg.playerId === hostId) {
                    restartGame();
                }
                break;
            
            case "hostStartGame":
                if (msg.playerId === hostId) {
                    startGame();
                }
                break;

            case "addBot":
                if (msg.playerId === hostId && msg.team && msg.role) {
                    addBot(parseInt(msg.team), msg.role);
                }
                break;

            case "removeBot":
                if (msg.playerId === hostId && msg.team && msg.role) {
                    removeBot(parseInt(msg.team), msg.role);
                }
                break;

            case "newPlayer":
                const incomingTeam = msg.player.team;

                const teamIdString = `team${incomingTeam}`;
                const playerNumber = assignUniquePlayerNumber(teamIdString);

                // Encontrar a primeira posição livre para o humano
                const initialPosArray = incomingTeam === 1 ? team1Positions : team2Positions;
                const existingRoles = Object.values(players).filter(p => p.team === incomingTeam).map(p => p.role);
                
                let initialPos = initialPosArray.find(pos => !existingRoles.includes(pos.role));
                
                // Se não houver vaga (time cheio), usa a primeira posição como fallback
                if (!initialPos) {
                     initialPos = initialPosArray[0];
                }

                players[playerId] = {
                    id: playerId,
                    name: msg.player.name,
                    team: incomingTeam,
                    x: initialPos.x,
                    y: initialPos.y,
                    role: initialPos.role, // O humano ocupa um papel na formação
                    number: playerNumber,
                };
                console.log(
                    `Jogador ${msg.player.name} (${playerId}) se juntou ao Time ${incomingTeam}`
                );

                broadcast({ type: "newPlayer", player: players[playerId] });
                resetAllPlayers(); // Reposiciona todos para a nova formação

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

                if (isKickOffActive) {
                    if (p.team === 1) {
                        tempX = Math.min(tempX, MIDFIELD_X - playerRadius);
                    } else if (p.team === 2) {
                        tempX = Math.max(tempX, MIDFIELD_X + playerRadius);
                    }
                }

                p.x = Math.max(playerRadius, Math.min(tempX, WIDTH - playerRadius));
                p.y = Math.max(playerRadius, Math.min(tempY, HEIGHT - playerRadius));

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

        // LÓGICA DE TRANSFERÊNCIA DO HOST
        if (playerId === hostId) {
            const remainingPlayers = Object.values(players).filter(p => !BOT_IDS.includes(p.id));

            if (remainingPlayers.length > 0) {
                // O primeiro jogador humano restante se torna o novo Host
                hostId = remainingPlayers[0].id;
                console.log(`⭐ HOST transferido para ${hostId}`);

                // Envia a notificação para o novo Host
                wss.clients.forEach(c => {
                    if (c.id === hostId) {
                        c.send(JSON.stringify({ type: "hostStatus", isHost: true }));
                    }
                });
                broadcast({ type: "hostChanged", newHostId: hostId, newHostName: remainingPlayers[0].name });

            } else {
                hostId = null; // Não há mais jogadores humanos
            }
        }
    });
});