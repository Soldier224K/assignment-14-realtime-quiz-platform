require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');

const { setupLobbyHandlers } = require('./sockets/lobbyHandler');
const { setupGameHandlers } = require('./sockets/gameEngine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Socket.io Connection Router
io.on('connection', (socket) => {
  console.log(`🎮 Live Quiz Client Connected: ${socket.id}`);

  setupLobbyHandlers(io, socket);
  setupGameHandlers(io, socket);

  socket.on('disconnect', () => {
    console.log(`❌ Live Quiz Client Disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`🧠 Real-Time Live Quiz Server running at http://localhost:${PORT}`);
  console.log(`👑 Host view: http://localhost:${PORT}/host.html`);
  console.log(`🎮 Player view: http://localhost:${PORT}/player.html`);
});
