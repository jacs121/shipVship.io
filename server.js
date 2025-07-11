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
    // Find an opponent
    const waitingPlayer = Object.values(players).find(p => 
      p.id !== socket.id && p.ready && !p.room
    );

    io.to(socket.id).emit('gameStart', { 
        roomId, 
        opponent: players[waitingPlayer.id],
        player: players[socket.id]  // Add this line
    });
    
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
      io.to(socket.id).emit('gameStart', { roomId, opponent: players[waitingPlayer.id] });
      io.to(waitingPlayer.id).emit('gameStart', { roomId, opponent: players[socket.id] });
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
    if (player && player.room) {
      // Update game state based on input
      // Then broadcast to both players
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
  
  // Disconnect
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    if (players[socket.id]) {
      players[socket.id].ready = false;
    }
    const player = players[socket.id];
    
    if (player && player.room) {
      // Notify opponent
      const room = rooms[player.room];
      const opponentId = room.players.find(id => id !== socket.id);
      
      if (opponentId) {
        io.to(opponentId).emit('playerLeft', socket.id);
      }
      
      // Clean up room
      delete rooms[player.room];
    }
    
    // Remove player
    delete players[socket.id];
    io.emit('playerList', Object.values(players));
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});