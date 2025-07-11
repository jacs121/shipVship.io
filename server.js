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
    if (!players[socket.id]) return; // Add safety check
    // Find an opponent
    const waitingPlayer = Object.values(players).find(p => 
      p.id !== socket.id && p.ready && !p.room
    );
    
    if (waitingPlayer) {
      // Create a room
      const roomId = `room${roomCounter++}`;
        io.to(socket.id).emit('gameStart', { 
          roomId,
          opponent: players[waitingPlayer.id],
          player: players[socket.id]  // Add this line
      });
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
          player: players[socket.id], // Add current player data
          isPlayer1: true // Indicate who is player1
      });

      io.to(waitingPlayer.id).emit('gameStart', {
          roomId,
          opponent: players[socket.id],
          player: players[waitingPlayer.id], // Add current player data
          isPlayer1: false // Indicate who is player1
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
                  x: 0.125,  // 100/800
                  y: 0.5,    // 200/400
                  width: 0.0625, // 50/800
                  height: 0.125, // 50/400
                  color: '#00f' 
              },
              player2: { 
                  x: 0.75,   // 600/800
                  y: 0.5,    // 200/400
                  width: 0.0625, 
                  height: 0.125, 
                  color: '#f0f' 
              },
              projectiles: []
          };
      }
      
      // Determine which player is which
      const isPlayer1 = room.players[0] === socket.id;
      const playerState = isPlayer1 ? room.gameState.player1 : room.gameState.player2;
      
      // Update position based on input (using relative movements)
      const speed = 0.01; // Relative to canvas size
      if (input.left) playerState.x -= speed;
      if (input.right) playerState.x += speed;
      if (input.up) playerState.y -= speed;
      if (input.down) playerState.y += speed;
      
      // Keep positions within bounds (0-1)
      playerState.x = Math.max(0, Math.min(1, playerState.x));
      playerState.y = Math.max(0, Math.min(1, playerState.y));
      
      // Handle actions
      if (input.action) {
          // Create projectile
          const projectile = {
              x: playerState.x,
              y: playerState.y,
              width: 0.0125, // 10/800
              height: 0.0125, // 5/400
              speed: isPlayer1 ? 0.01 : -0.01, // normalized speed
              color: isPlayer1 ? '#00f' : '#f0f'
          };
          room.gameState.projectiles.push(projectile);
      }
      
      if (input.shield) {
          // Activate shield
          playerState.shieldActive = true;
          playerState.shieldTimer = 180; // 3 seconds at 60fps
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