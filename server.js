// server.js
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
      rooms[roomId] = {
        id: roomId,
        players: [socket.id, waitingPlayer.id],
        gameState: null
      };
      
      // Add players to room
      players[socket.id].room = roomId;
      players[waitingPlayer.id].room = roomId;
      
      // Start game for both players
      io.to(socket.id).emit('gameStart', {
          roomId,
          opponent: players[waitingPlayer.id],
          player: players[socket.id],
          isPlayer1: true
      });

      io.to(waitingPlayer.id).emit('gameStart', {
          roomId,
          opponent: players[socket.id],
          player: players[waitingPlayer.id],
          isPlayer1: false
      });
    } else {
      // Set player as ready
      players[socket.id].ready = true;
      io.emit('playerList', Object.values(players));
      socket.emit('status', 'Waiting for opponent...');
    }
  });
  
  // Game state updates
  socket.on('playerInput', (input) => {
    const player = players[socket.id];
    if (!player || !player.room || !rooms[player.room]) return;
    
    const room = rooms[player.room];
    
    // Initialize game state if needed
    if (!room.gameState) {
      room.gameState = {
        player1: { 
          x: 0.125, y: 0.5, width: 0.0625, height: 0.125, 
          color: '#00f', shieldActive: false 
        },
        player2: { 
          x: 0.75, y: 0.5, width: 0.0625, height: 0.125, 
          color: '#f0f', shieldActive: false 
        },
        projectiles: []
      };
    }
    
    // Determine which player is which
    const isPlayer1 = room.players[0] === socket.id;
    const playerState = isPlayer1 ? room.gameState.player1 : room.gameState.player2;
    
    // Update position based on input
    const speed = 0.01;
    if (input.left) playerState.x -= speed;
    if (input.right) playerState.x += speed;
    if (input.up) playerState.y -= speed;
    if (input.down) playerState.y += speed;
    
    // Keep players in bounds (0-1 range)
    playerState.x = Math.max(0.01, Math.min(0.99, playerState.x));
    playerState.y = Math.max(0.01, Math.min(0.99, playerState.y));
    
    // Handle actions
    if (input.action) {
      // Create projectile
      const projectile = {
        x: playerState.x + (isPlayer1 ? playerState.width : -playerState.width),
        y: playerState.y + playerState.height/2,
        width: 0.0125,
        height: 0.0125,
        speed: isPlayer1 ? 0.02 : -0.02,
        color: isPlayer1 ? '#00f' : '#f0f'
      };
      room.gameState.projectiles.push(projectile);
    }
    
    if (input.shield) {
      // Activate shield
      playerState.shieldActive = true;
      playerState.shieldTimer = 180;
    } else {
      playerState.shieldActive = false;
    }
    
    // Update projectiles
    room.gameState.projectiles.forEach(projectile => {
      projectile.x += projectile.speed;
    });
    
    // Filter out projectiles that are out of bounds
    room.gameState.projectiles = room.gameState.projectiles.filter(
      projectile => projectile.x > 0 && projectile.x < 1
    );
    // Broadcast updated state
    io.to(room.id).emit('gameState', room.gameState);
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
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
console.log(`Server running on port ${PORT}`);
});