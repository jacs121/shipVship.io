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
    if (!player) return; // Add safety check
    if (player && player.room) {
        // Update game state based on input
        if (!rooms[player.room].gameState) {
            rooms[player.room].gameState = {};
        }

        // Store input with timestamp
        rooms[player.room].gameState[player.id] = {
            input,
            timestamp: Date.now()
        };

        // Broadcast updated state
        io.to(player.room).emit('gameState', rooms[player.room].gameState);
    }
  });
  
  // Chat messages
  socket.on('chatMessage', (message) => {
    const player = players[socket.id];
    if (player) {
      io.emit('chatMessage', {
        sender: player.name,
        text: message
      });
    }
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