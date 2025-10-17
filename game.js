// ----------------- VARIÁVEIS E ELEMENTOS -----------------
//const ws = new WebSocket("ws://10.60.0.99:8080"); // IP do host
const ws = new WebSocket("wss://bavi-online.onrender.com"); // Para testes locais
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const status = document.getElementById("status");
const scoreEl = document.getElementById("score");
const eventMessageEl = document.getElementById("eventMessage");
const gameOverScreenEl = document.getElementById("gameOverScreen");
const winnerMessageEl = document.getElementById("winnerMessage");
const restartButton = document.getElementById("restartButton");
const timeEl = document.getElementById("time");
const team1List = document.getElementById("team1List");
const team2List = document.getElementById("team2List"); // Goal overlay elements

const goalVideoOverlay = document.getElementById("goalVideoOverlay");
const goalImage = document.getElementById("goalImage");
const goalText = document.getElementById("goalText"); // NOVOS ELEMENTOS DO MENU

const initialSetupScreen = document.getElementById("initialSetupScreen");
const playerNameInput = document.getElementById("playerNameInput");
const teamCards = document.querySelectorAll(".teamCard");
const connectButton = document.getElementById("connectButton");

// 🟢 NOVO: Variáveis do Host
const hostControlsEl = document.getElementById("host-controls");
const gameStatusDisplayEl = document.getElementById("game-status-display");
let isHost = false; // Rastreia se este cliente é o host

const WIDTH = canvas.width; // 800
const HEIGHT = canvas.height; // 500

let playerId = null;
let players = {};
let bola = { x: 300, y: 200, raio: 8 };
let keysPressed = {};
let inputInterval = null; // Para o loop de envio de input
let score = { 1: 0, 2: 0 };
let gameTime = 180;
let isKickOffActive = false;
let kickOffTeam = null;
let selectedTeam = null; // RASTREIA O TIME SELECIONADO NO NOVO MENU // ----------------- FUNÇÕES DE CONTROLE DO HOST (CLIENTE) -----------------

function startGameClient() {
  if (isHost) {
    ws.send(JSON.stringify({ type: "hostStartGame", playerId: playerId }));
  }
}

function restartGameClient() {
  if (isHost) {
    ws.send(JSON.stringify({ type: "restartGame", playerId: playerId }));
  }
}

function addBotClient(team, role) {
  if (isHost) {
    ws.send(
      JSON.stringify({
        type: "addBot",
        playerId: playerId,
        team: team,
        role: role,
      })
    );
  }
}

function removeBotClient(team, role) {
  if (isHost) {
    ws.send(
      JSON.stringify({
        type: "removeBot",
        playerId: playerId,
        team: team,
        role: role,
      })
    );
  }
} // ----------------- FUNÇÕES DE MENU/CONEXÃO -----------------
// ----------------- FIM: FUNÇÕES DE CONTROLE DO HOST (CLIENTE) -----------------

function attemptConnection() {
  const playerName = playerNameInput.value.trim();
  const maxLength = 10;

  if (playerName.length === 0 || playerName.length > maxLength) {
    alert(`Por favor, digite um nome válido (máx. ${maxLength} caracteres).`);
    return;
  }

  if (!selectedTeam) {
    alert("Por favor, selecione um time.");
    return;
  }

  initialSetupScreen.style.display = "none";
  status.textContent = "Aguardando partida..."; // Envia as informações do novo jogador para o servidor

  ws.send(
    JSON.stringify({
      type: "newPlayer",
      player: {
        id: playerId,
        name: playerName,
        team: selectedTeam,
      },
    })
  );
} // NOVO: Adiciona a lógica de seleção de time e validação

teamCards.forEach((card) => {
  card.addEventListener("click", function () {
    // Remove a seleção de todos os cards
    teamCards.forEach((c) => c.classList.remove("selected")); // Adiciona a seleção ao card clicado

    this.classList.add("selected");
    selectedTeam = parseInt(this.getAttribute("data-team")); // Habilita o botão de conexão se o nome for válido

    if (playerNameInput.value.trim().length > 0) {
      connectButton.disabled = false;
    }
  });
}); // NOVO: Validação do nome em tempo real

playerNameInput.addEventListener("input", function () {
  this.value = this.value.substring(0, 10); // Garante max length
  if (this.value.trim().length > 0 && selectedTeam) {
    connectButton.disabled = false;
  } else {
    connectButton.disabled = true;
  }
}); // NOVO: Ação do botão Conectar

connectButton.addEventListener("click", attemptConnection); // ----------------- DESENHO / RENDER -----------------

function drawField() {
  // Cores de grama para o efeito de faixa
  const lightGreen = "#0b572d"; // Cor de fundo do canvas (mais escura)
  const darkGreen = "#084122"; // Uma cor um pouco mais escura
  const stripeWidth = 50; // Largura da faixa // 1. Desenha as faixas de grama (antes de tudo)

  for (let i = 0; i * stripeWidth < WIDTH; i++) {
    const x = i * stripeWidth;
    const color = i % 2 === 0 ? darkGreen : lightGreen; // Alterna as cores
    ctx.fillStyle = color;
    ctx.fillRect(x, 0, stripeWidth, HEIGHT);
  } // Constantes de dimensão (mantidas)

  const playerGoalWidth = 15;
  const goalAreaWidth = 70;
  const goalAreaHeight = 100;
  const goalY = (HEIGHT - goalAreaHeight) / 2; // 100

  ctx.strokeStyle = "white";
  ctx.lineWidth = 2;
  ctx.fillStyle = "white"; // Desenha as traves (Gols) - Retângulos preenchidos

  ctx.fillRect(0, goalY, playerGoalWidth, goalAreaHeight);
  ctx.fillRect(WIDTH - playerGoalWidth, goalY, playerGoalWidth, goalAreaHeight); // --- GRUPO 1: LINHAS RETAS E ÁREAS (USAM UM ÚNICO STROKE) ---

  ctx.beginPath(); // Linha externa do campo (opcional, mas boa prática)

  ctx.rect(0, 0, WIDTH, HEIGHT); // Linha do meio de campo

  ctx.moveTo(WIDTH / 2, 0);
  ctx.lineTo(WIDTH / 2, HEIGHT); // Área de Gol Esquerda

  ctx.rect(playerGoalWidth, goalY, goalAreaWidth, goalAreaHeight); // Área de Gol Direita

  ctx.rect(
    WIDTH - playerGoalWidth - goalAreaWidth,
    goalY,
    goalAreaWidth,
    goalAreaHeight
  );

  ctx.stroke(); // FIM DO GRUPO 1 // --- GRUPO 2: CÍRCULO CENTRAL (PRECISA DE UM NOVO BEGIN PATH) ---
  ctx.beginPath();
  ctx.arc(WIDTH / 2, HEIGHT / 2, 50, 0, Math.PI * 2);
  ctx.stroke(); // FIM DO GRUPO 2
}

function desenhar() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawField(); // 1. Desenha o preenchimento da bola (branco) - DEVE SER O PRIMEIRO

  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.arc(bola.x, bola.y, bola.raio, 0, Math.PI * 2);
  ctx.fill(); // 2. Desenha a borda preta da bola - DEVE SER O SEGUNDO (Por Cima)

  ctx.strokeStyle = "black"; // COR DA BORDA
  ctx.lineWidth = 1; // ESPESSURA DA BORDA
  ctx.beginPath();
  ctx.arc(bola.x, bola.y, bola.raio, 0, Math.PI * 2);
  ctx.stroke(); // Desenha a borda // Jogadores

  for (let id in players) {
    const p = players[id];
    const playerRadius = 15; // Raio do jogador
    const borderWidth = 3; // Largura da borda

    const teamPrimaryColor = p.team === 1 ? "#c11717" : "#2e30eb"; // Vermelho para Vitória, Azul para Bahia
    const playerBorderColor = p.team === 1 ? "black" : "white"; // 1. Desenha a borda externa do jogador (círculo maior)

    ctx.fillStyle = playerBorderColor;
    ctx.beginPath();
    ctx.arc(p.x, p.y, playerRadius + borderWidth, 0, Math.PI * 2);
    ctx.fill(); // 2. Desenha o jogador (círculo principal - cor primária do time)

    ctx.fillStyle = teamPrimaryColor; // Cor primária (vermelho ou azul)
    ctx.beginPath();
    ctx.arc(p.x, p.y, playerRadius, 0, Math.PI * 2);
    ctx.fill(); // 3. Desenha a linha horizontal para o Time 1 OU a faixa para o Time 2

    if (p.team === 1) {
      // Time 1: Linha preta simples
      ctx.fillStyle = "black";
      ctx.fillRect(p.x - playerRadius, p.y - 1, playerRadius * 2, 2);
    } else {
      // Time 2: Faixa Vermelha Central (como na imagem)
      const bandWidth = playerRadius * 0.7; // Largura da faixa (ajuste conforme necessário)
      ctx.fillStyle = "#c11717"; // Cor vermelha para a faixa do Bahia
      ctx.fillRect(
        p.x - bandWidth / 2,
        p.y - playerRadius,
        bandWidth,
        playerRadius * 2
      );
    } // 4. Desenha o número com contorno

    if (p.number) {
      ctx.font = "bold 14px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const text = p.number.toString();

      ctx.strokeStyle = "black";
      ctx.lineWidth = 3;
      ctx.strokeText(text, p.x, p.y);

      ctx.fillStyle = p.team === 1 ? "yellow" : "white"; // Amarelo para Time 1, Branco para Time 2
      ctx.fillText(text, p.x, p.y);
    } // 5. Desenha o nome do jogador

    ctx.fillStyle = "white";
    ctx.font = "14px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(p.name, p.x, p.y - playerRadius - 5);
  } // Atualiza placar e tempo

  scoreEl.textContent = `${score[1]} x ${score[2]}`;
  const min = Math.floor(gameTime / 60)
    .toString()
    .padStart(2, "0");
  const sec = (gameTime % 60).toString().padStart(2, "0");
  timeEl.textContent = `${min}:${sec}`;
}

function getCombinedDirection() {
  let direction = "";
  if (keysPressed.up) direction += "up";
  if (keysPressed.down) direction += "down";
  if (keysPressed.left) direction += "Left";
  if (keysPressed.right) direction += "Right"; // Se a tecla de kick estiver pressionada, priorizamos o kick

  if (keysPressed.kick) return "kick"; // Se não houver movimento, retorna null

  return direction || null;
} // ----------------- FUNÇÕES DE LISTA/PLACAR -----------------

function updatePlayerLists() {
  // Limpa as listas atuais
  team1List.innerHTML = "";
  team2List.innerHTML = ""; // Arrays para manter a ordem por papel (Defensor, Meio, Atacante)

  const team1Players = [];
  const team2Players = [];
  const roleOrder = { DEFENDER: 1, MIDFIELD: 2, ATTACKER: 3 }; // Separa os jogadores por time

  for (let id in players) {
    const p = players[id];

    const playerNumber = p.number ? `(${p.number}) ` : ""; // Adiciona um indicador 'VOCÊ' se for o jogador local
    const roleTag = p.role ? `[${p.role.substring(0, 3)}]` : ""; // Ex: [DEF]
    const nameDisplay =
      playerNumber +
      roleTag +
      " " +
      p.name +
      (id === playerId ? " (VOCÊ)" : "");

    const playerInfo = {
      name: nameDisplay,
      isYou: id === playerId,
      roleOrder: roleOrder[p.role] || 4, // 1=DEF, 2=MID, 3=ATT, 4=Outros
    };

    if (p.team === 1) {
      team1Players.push(playerInfo);
    } else if (p.team === 2) {
      team2Players.push(playerInfo);
    }
  }

  // 🟢 NOVO: Ordena as listas por papel (DEF, MID, ATT)
  team1Players.sort((a, b) => a.roleOrder - b.roleOrder);
  team2Players.sort((a, b) => a.roleOrder - b.roleOrder); // Função para renderizar a lista

  function renderList(listEl, playersArray) {
    if (playersArray.length === 0) {
      listEl.innerHTML = "<li>(Vazio)</li>";
    } else {
      playersArray.forEach((p) => {
        const li = document.createElement("li");
        li.textContent = p.name;
        if (p.isYou) {
          li.style.background = "#74ed49";
          li.style.color = "black";
        } else {
          li.style.background = "none";
          li.style.color = "black";
        }
        listEl.appendChild(li);
      });
    }
  }

  renderList(team1List, team1Players);
  renderList(team2List, team2Players);
}

function displayEventMessage(message, duration = 3000) {
  eventMessageEl.textContent = message;
  eventMessageEl.style.display = "block";
  eventMessageEl.classList.add("event-message-active"); // ADICIONA A CLASSE PARA INICIAR A ANIMAÇÃO

  setTimeout(() => {
    eventMessageEl.classList.remove("event-message-active");
    eventMessageEl.style.display = "none";
  }, duration);
} // ----------------- CELEBRAÇÃO DE GOL (overlay, gif, partículas, fogos) -----------------

function showGoalVideo() {
  // Mostrar overlay
  goalVideoOverlay.style.display = "flex"; // Mostrar texto e GIF imediatamente

  goalText.style.display = "block";
  goalImage.style.display = "block"; // Efeitos especiais

  createGoalParticles();
  createFireworks(); // Esconder tudo após 3 segundos (mantém comportamento que você pediu)

  setTimeout(() => {
    // Suaviza o desaparecimento
    goalText.classList.add("fade-out");
    goalImage.classList.add("fade-out");
    goalVideoOverlay.classList.add("fade-out");

    setTimeout(() => {
      goalVideoOverlay.style.display = "none";
      goalImage.style.display = "none";
      goalText.style.display = "none"; // remove classes para próxima exibição

      goalText.classList.remove("fade-out");
      goalImage.classList.remove("fade-out");
      goalVideoOverlay.classList.remove("fade-out");
    }, 500);
  }, 3000);
} // Função para criar partículas de gol - MELHORADA

function createGoalParticles() {
  for (let i = 0; i < 50; i++) {
    setTimeout(() => {
      const particle = document.createElement("div");
      particle.className = "goal-particle"; // posição aleatória dentro da viewport
      particle.style.left = Math.random() * 100 + "%";
      particle.style.top = Math.random() * 100 + "%"; // Cores variadas para as partículas

      const colors = ["#ffd700", "#ff6b35", "#f7931e", "#ffed4a", "#ff1744"];
      const c = colors[Math.floor(Math.random() * colors.length)];
      particle.style.background = c;
      particle.style.boxShadow = "0 0 12px " + c;

      document.body.appendChild(particle);

      setTimeout(() => {
        if (document.body.contains(particle)) {
          document.body.removeChild(particle);
        }
      }, 3000);
    }, i * 20);
  }
} // Função para criar fogos de artifício

function createFireworks() {
  for (let i = 0; i < 30; i++) {
    setTimeout(() => {
      const firework = document.createElement("div");
      firework.className = "firework";
      firework.style.left = Math.random() * 100 + "%";
      firework.style.top = Math.random() * 60 + "%"; // fogos no topo

      const colors = ["#ff1744", "#2196f3", "#4caf50", "#ff9800", "#9c27b0"];
      const chosen = colors[Math.floor(Math.random() * colors.length)];
      firework.style.background = chosen;
      firework.style.boxShadow = "0 0 18px " + chosen;

      document.body.appendChild(firework);

      setTimeout(() => {
        if (document.body.contains(firework)) {
          document.body.removeChild(firework);
        }
      }, 1500);
    }, i * 100);
  }
} // ----------------- RESTART -----------------

restartButton.onclick = () => {
  gameOverScreenEl.style.display = "none"; // Envia a mensagem para o servidor iniciar a nova partida
  // 🟢 NOVO: Agora só o Host pode reiniciar (a função client chama o servidor)
  restartGameClient();
}; // index.html: Adicione este loop de envio de input (ex: 30ms = 33 vezes por segundo)

inputInterval = setInterval(() => {
  if (!playerId) return;

  const input = getCombinedDirection();

  if (input) {
    // Envia a direção combinada para o servidor (ex: "upLeft", "downRight", "kick")
    ws.send(JSON.stringify({ type: "input", playerId, input }));
  }
}, 30); // Frequência do envio de input // ----------------- WebSocket: eventos (mantendo seu fluxo original) -----------------

ws.onopen = () => {
  console.log("✅ Conectado ao servidor");
  status.textContent = "Conectado!";
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case "welcome":
      playerId = msg.playerId; // MOSTRA A TELA INICIAL (mantendo seu fluxo original)

      initialSetupScreen.style.display = "flex";
      status.textContent = "Escolha seu nome e time..."; // Limpa o nome e seleção de time anterior

      playerNameInput.value = "";
      selectedTeam = null;
      connectButton.disabled = true;
      teamCards.forEach((c) => c.classList.remove("selected"));

      break;

    // 🟢 NOVO: TRATAMENTO DO STATUS DO HOST
    case "hostStatus":
      isHost = msg.isHost;
      if (isHost) {
        hostControlsEl.style.display = "block";
        gameStatusDisplayEl.textContent =
          "Status: VOCÊ é o Host. Gerencie a partida.";
      } else {
        hostControlsEl.style.display = "none";
        gameStatusDisplayEl.textContent = "Status: Aguardando o Host.";
      }
      break;

    // 🟢 NOVO: TRATAMENTO DA TRANSFERÊNCIA DE HOST
    case "hostChanged":
      // Se eu receber esta mensagem, não sou o novo host, mas o status mudou.
      // A mensagem 'hostStatus' virá logo em seguida se eu for o novo host.
      alert(`O Host mudou! O novo Host é: ${msg.newHostName}.`);
      break;

    case "stateSync":
      players = msg.players || {};
      bola = msg.bola || bola;
      score = msg.score || score;
      gameTime = msg.gameTime || gameTime;
      updatePlayerLists();
      break;

    case "newPlayer":
      players[msg.player.id] = msg.player;
      updatePlayerLists();
      break;

    case "playerLeft":
      delete players[msg.playerId];
      updatePlayerLists();
      break;

    case "playerUpdate":
      players[msg.player.id] = msg.player;
      break;

    case "update":
      bola = msg.bola || bola;
      if (msg.gameTime !== undefined) gameTime = msg.gameTime;
      if (msg.score) score = msg.score;
      break;

    case "scoreUpdate": // RECEBE PLACAR E INICIA CELEBRAÇÃO
      score = msg.score;

      isKickOffActive = msg.kickOff;
      kickOffTeam = msg.kickOffTeam; // Limpa mensagens de evento anteriores

      eventMessageEl.classList.remove("event-message-active");
      eventMessageEl.style.display = "none";

      if (isKickOffActive) {
        const teamNameKo = kickOffTeam === 1 ? "VERMELHO" : "AZUL";
        const kickOffMsg = `Saída de Bola para o Time ${kickOffTeam} (${teamNameKo})!`; // Exibe por um longo tempo, até ser removida por 'kickOffStarted'
        displayEventMessage(kickOffMsg, 100000);
      } // MOSTRAR VÍDEO DE GOL / OVERLAY / CONFETES

      showGoalVideo(); // NOVO: Mensagem de GOL com o nome do marcador (mantendo sua intenção)

      const teamName = msg.team === 1 ? "VITÓRIA" : "BAHIA";
      const scorerMsg =
        msg.scorer === "o time"
          ? `GOL do Time ${msg.team} (${teamName})!`
          : `GOL do Time ${msg.team}! Marcado por ${msg.scorer}!`;
      displayEventMessage(scorerMsg, 4000); // Exibe por 4 segundos

      scoreEl.textContent = `${score[1]} x ${score[2]}`;
      break;

    case "gameOver": // Determina o vencedor
      let winnerName = "";
      if (msg.score[1] > msg.score[2]) {
        winnerName = "Time 1 (VITORIA) VENCEU!";
      } else if (msg.score[2] > msg.score[1]) {
        winnerName = "Time 2 (BAHIA) VENCEU!";
      } else {
        winnerName = "EMPATE!";
      } // Exibe a tela de Game Over

      winnerMessageEl.textContent = winnerName;
      gameOverScreenEl.style.display = "flex";
      gameOverScreenEl.classList.add("game-over-active"); // ADICIONA A CLASSE PARA INICIAR A ANIMAÇÃO // Para o loop de input do jogador (IMPORTANTE: Evita movimento após o fim)

      if (inputInterval) {
        clearInterval(inputInterval);
        inputInterval = null;
      }
      break;

    case "gameRestarted": // Esconde tela de Game Over (se ainda estiver visível)
      gameOverScreenEl.style.display = "none";
      eventMessageEl.classList.remove("event-message-active");
      gameOverScreenEl.classList.remove("game-over-active"); // REMOVE A CLASSE // Reseta a UI do placar e tempo

      score = msg.score; // 0x0
      gameTime = 180;
      scoreEl.textContent = `${score[1]} x ${score[2]}`;
      timeEl.textContent = "03:00"; // Reinicia o loop de input para permitir que o jogador se mova novamente

      if (!inputInterval) {
        inputInterval = setInterval(() => {
          if (!playerId) return;
          const input = getCombinedDirection();
          if (input) {
            ws.send(JSON.stringify({ type: "input", playerId, input }));
          }
        }, 30);
      }
      break;

    case "kickOffStarted":
      isKickOffActive = false;
      kickOffTeam = null; // Limpa a mensagem de evento de saída de bola e mostra 'JOGO ROLANDO!'
      eventMessageEl.style.display = "none";
      displayEventMessage("JOGO ROLANDO!", 1500);
      break;
  }
  desenhar();
};

ws.onclose = () => {
  status.textContent = "❌ Desconectado"; // Oculta os controles do Host se a conexão cair
  hostControlsEl.style.display = "none";
  isHost = false;
};

ws.onerror = () => {
  status.textContent = "❌ Erro de conexão";
}; // ----------------- INPUT (teclado) -----------------

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp") keysPressed.up = true;
  if (e.key === "ArrowDown") keysPressed.down = true;
  if (e.key === "ArrowLeft") keysPressed.left = true;
  if (e.key === "ArrowRight") keysPressed.right = true;
  if (e.code === "Space") keysPressed.kick = true; // Rastreia o chute também

  if (
    keysPressed.up ||
    keysPressed.down ||
    keysPressed.left ||
    keysPressed.right
  ) {
    e.preventDefault();
  }
});

document.addEventListener("keyup", (e) => {
  if (e.key === "ArrowUp") keysPressed.up = false;
  if (e.key === "ArrowDown") keysPressed.down = false;
  if (e.key === "ArrowLeft") keysPressed.left = false;
  if (e.key === "ArrowRight") keysPressed.right = false;
  if (e.code === "Space") keysPressed.kick = false;
}); // --- LÓGICA DE CONTROLES VIRTUAIS (TOUCHSCREEN) ---

const touchControls = document.getElementById("touchControls");

if (touchControls) {
  const map = {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
    "kick-btn": "Space",
  };

  function handleTouchStart(e) {
    e.preventDefault(); // Impede o scroll e o comportamento padrão do toque
    const key = map[this.id];

    if (key === "ArrowUp") keysPressed.up = true;
    if (key === "ArrowDown") keysPressed.down = true;
    if (key === "ArrowLeft") keysPressed.left = true;
    if (key === "ArrowRight") keysPressed.right = true;
    if (key === "Space") keysPressed.kick = true;

    this.style.background = "rgba(255, 255, 255, 0.8)"; // Feedback visual
  }

  function handleTouchEnd(e) {
    e.preventDefault();
    const key = map[this.id];

    if (key === "ArrowUp") keysPressed.up = false;
    if (key === "ArrowDown") keysPressed.down = false;
    if (key === "ArrowLeft") keysPressed.left = false;
    if (key === "ArrowRight") keysPressed.right = false;
    if (key === "Space") keysPressed.kick = false;

    this.style.background = "rgba(0, 0, 0, 0.7)"; // Restaura o visual
  } // Aplica os eventos de toque a todos os botões

  const buttons = document.querySelectorAll("#touchControls button");
  buttons.forEach((button) => {
    button.addEventListener("touchstart", handleTouchStart);
    button.addEventListener("touchend", handleTouchEnd);
    button.addEventListener("touchcancel", handleTouchEnd); // Caso o dedo deslize para fora // Também adicionamos os eventos de mouse (para testar emulando o celular no PC)

    button.addEventListener("mousedown", handleTouchStart);
    button.addEventListener("mouseup", handleTouchEnd);
    button.addEventListener("mouseleave", handleTouchEnd);
  });
} // Loop de desenho


// --- LIGAÇÃO DOS CONTROLES DO HOST ---

// Botões de Partida
document.getElementById('start-btn').onclick = startGameClient;
document.getElementById('restart-btn').onclick = restartGameClient;

// Botões de Bots (Adicionar)
document.querySelectorAll('.bot-add-btn').forEach(button => {
    button.addEventListener('click', function() {
        const team = parseInt(this.closest('.bot-manager').dataset.teamId);
        const role = this.dataset.position;
        addBotClient(team, role);
    });
});

// Botões de Bots (Remover)
document.querySelectorAll('.bot-remove-btn').forEach(button => {
    button.addEventListener('click', function() {
        const team = parseInt(this.closest('.bot-manager').dataset.teamId);
        const role = this.dataset.position;
        removeBotClient(team, role);
    });
});

setInterval(desenhar, 30);
