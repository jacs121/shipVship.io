// server.js

// info:
// a one on one alien invader
// 2 player go against waves of different types of aliens and the last player to survive wins
// players can use abilities to help them selfs or sabotage the player player
// there is also mobile support!!!

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Game state
const players = {};
const rooms = {};
let roomCounter = 1;


const FPS = 60;
const FRAME_TIME = 1000 / FPS;

// Socket.IO connection
io.on('connection', (socket) => {
  console.log(`New client connected: ${socket.id}`);

  let reconnectAttempts = 0;

  function reconnect() {
    if (reconnectAttempts < 5) {
      socket.connect();
      reconnectAttempts++;
    }
  }

  socket.on('connect_error', () => {
    setTimeout(reconnect, 2000);
  });

  // Add player to global list
  players[socket.id] = {
    id: socket.id,
    name: `Player${Object.keys(players).length + 1}`,
    ready: false,
    room: null
  };
  
  // Send player their ID and name
  socket.emit('playerId', socket.id);
  socket.emit('playerList', Object.values(players));
  
  // Register player name
  socket.on('register', (name) => {
    players[socket.id].name = name;
    io.emit('playerList', Object.values(players));
  });

  socket.on('chatMessage', (message) => {
    const player = players[socket.id];
    if (!player) return;
    
    // Broadcast to all players
    io.emit('chatMessage', {
      sender: player.name,
      text: message.message
    });
  });
  
  // Start game
  socket.on('startGame', () => {
    if (!players[socket.id]) return;
    
    // Find an opponent
    const waitingPlayer = Object.values(players).find(p => 
        p.id !== socket.id && p.ready && !p.room
    );
    
    if (waitingPlayer) {
        // Create a room
        const roomId = `room${roomCounter++}`;
        
        // Initialize game state immediately
        const initialGameState = {
            player1: { 
                x: 0.125, y: 0.5, width: 0.0625, height: 0.125, 
                color: '#00f', shieldActive: false, health: 100
            },
            player2: { 
                x: 0.75, y: 0.5, width: 0.0625, height: 0.125, 
                color: '#f0f', shieldActive: false, health: 100
            },
            projectiles: []
        };
        
        rooms[roomId] = {
            id: roomId,
            players: [socket.id, waitingPlayer.id],
            gameState: initialGameState,
            inputs: {}
        };
        
        // Add players to room
        players[socket.id].room = roomId;
        players[waitingPlayer.id].room = roomId;
        
        // Start game for both players with initial state
        io.to(socket.id).emit('gameStart', {
          roomId,
          opponent: players[waitingPlayer.id],
          player: players[socket.id],
          isPlayer1: true,
          gameState: rooms[roomId].gameState  // Send the actual game state object
        });

        io.to(waitingPlayer.id).emit('gameStart', {
          roomId,
          opponent: players[socket.id],
          player: players[waitingPlayer.id],
          isPlayer1: false,
          gameState: rooms[roomId].gameState  // Send the actual game state object
        });
    } else {
        // Set player as ready
        players[socket.id].ready = true;
        io.emit('playerList', Object.values(players));
        socket.emit('status', 'Waiting for opponent...');
    }
  });

  const gameLoopInterval = setInterval(() => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (!room.gameState) continue;
      
      // Process inputs
      if (room.inputs) {
        for (const playerId in room.inputs) {
          const input = room.inputs[playerId];
          const isPlayer1 = room.players[0] === playerId;
          const playerState = isPlayer1 ? room.gameState.player1 : room.gameState.player2;
          
          const speed = 0.01;
          if (input.left) playerState.x = Math.max(0.01, playerState.x - speed);
          if (input.right) playerState.x = Math.min(0.99 - playerState.width, playerState.x + speed);
          if (input.up) playerState.y = Math.max(0.01, playerState.y - speed);
          if (input.down) playerState.y = Math.min(0.99 - playerState.height, playerState.y + speed);
          
          // ACTION key
          if (input.action) {
            room.gameState.projectiles.push({
              x: playerState.x + (isPlayer1 ? playerState.width : -0.01),
              y: playerState.y + playerState.height / 2 - 0.00625,
              width: 0.0125,
              height: 0.0125,
              speed: isPlayer1 ? 0.02 : -0.02,
              color: isPlayer1 ? '#00f' : '#f0f'
            });
          }

          // SHIELD key
          playerState.shieldActive = input.shield;
        }
      }
      
      // Update projectiles
      room.gameState.projectiles.forEach(p => p.x += p.speed);
      
      // Filter out-of-bound projectiles
      room.gameState.projectiles = room.gameState.projectiles.filter(
        p => p.x > -0.1 && p.x < 1.1
      );

      checkCollisions(room);
      
      // Send updated state to clients
      console.log("Emitting gameState for room:", roomId);
      io.to(roomId).emit('gameState', room.gameState);
    }
  }, 1000/60); // 60 FPS

  process.on('SIGTERM', () => {
    clearInterval(gameLoopInterval);
  });

  // Game state updates
  socket.on('playerInput', (input) => {
    const player = players[socket.id];
    if (!player || !player.room || !rooms[player.room]) return;

    // Store input for processing in game loop
    if (!rooms[player.room].inputs) {
      rooms[player.room].inputs = {};
    }
    rooms[player.room].inputs[socket.id] = input;
  });

  // Add a new event handler for restarting
  socket.on('restartGame', () => {
      const player = players[socket.id];
      if (!player) return;
      
      if (player.room) {
          // Clean up previous room
          delete rooms[player.room];
          player.room = null;
      }
      
      player.ready = false;
      io.emit('playerList', Object.values(players));
  });
    
  // Disconnect
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    if (players[socket.id]) {
      players[socket.id].ready = false;
    }
    const player = players[socket.id];
    
    if (player && player.room) {
        // Clean up room
        if (rooms[player.room]) {
            delete rooms[player.room];
        }
        
        // Reset player status
        player.room = null;
        player.ready = false;
    }

    // Remove player
    delete players[socket.id];
    io.emit('playerList', Object.values(players));
  });

  function checkCollisions(room) {
    const gameState = room.gameState;
    if (!gameState) return;

    for (let i = gameState.projectiles.length - 1; i >= 0; i--) {
      const p = gameState.projectiles[i];
      const isPlayer1Projectile = p.speed > 0;

      if (isPlayer1Projectile && checkCollision(p, gameState.player2)) {
          if (!gameState.player2.shieldActive) {
              gameState.player2.health -= 10;
              io.to(room.players[1]).emit('playerHit');
              if (gameState.player2.health <= 0) {
                  io.to(room.id).emit('gameOver', players[room.players[0]].name);
              }
          }
          gameState.projectiles.splice(i, 1);
      } else if (!isPlayer1Projectile && checkCollision(p, gameState.player1)) {
          if (!gameState.player1.shieldActive) {
              gameState.player1.health -= 10;
              io.to(room.players[0]).emit('playerHit');
              if (gameState.player1.health <= 0) {
                  io.to(room.id).emit('gameOver', players[room.players[1]].name);
              }
          }
          gameState.projectiles.splice(i, 1);
      }
    }
  }

  function checkCollision(projectile, player) {
    return projectile.x < player.x + player.width &&
          projectile.x + projectile.width > player.x &&
          projectile.y < player.y + player.height &&
          projectile.y + projectile.height > player.y;
  }
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
console.log(`Server running on port ${PORT}`);
});