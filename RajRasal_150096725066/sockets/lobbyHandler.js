// sockets/lobbyHandler.js

// Global Quiz Game Rooms Map
// pin -> { pin, hostId, hostName, category, status, currentQuestionIndex, players: Map(), timer, questionStartTime }
const quizRooms = new Map();

function generatePin() {
  let pin;
  do {
    pin = Math.floor(1000 + Math.random() * 9000).toString();
  } while (quizRooms.has(pin));
  return pin;
}

module.exports = {
  quizRooms,
  setupLobbyHandlers: (io, socket) => {
    // Host creates quiz room
    socket.on('quiz:create', ({ hostName, category }) => {
      const pin = generatePin();
      const roomId = `quiz_${pin}`;

      socket.join(roomId);
      socket.quizPin = pin;
      socket.isHost = true;

      const roomData = {
        pin,
        roomId,
        hostId: socket.id,
        hostName: hostName || 'Professor X',
        category: category || 'Tech & Computer Science',
        status: 'lobby', // 'lobby', 'in_progress', 'ended'
        currentQuestionIndex: 0,
        players: new Map(), // socketId -> { socketId, name, score: 0, answers: {} }
        timer: null,
        questionStartTime: null
      };

      quizRooms.set(pin, roomData);

      socket.emit('quiz:created', {
        pin,
        roomId,
        hostName: roomData.hostName,
        category: roomData.category
      });
    });

    // Player joins lobby with PIN
    socket.on('quiz:join', ({ pin, playerName }) => {
      const room = quizRooms.get(pin);

      if (!room) {
        return socket.emit('quiz:error', { message: 'Invalid Game PIN. Room not found.' });
      }

      if (room.status !== 'lobby') {
        return socket.emit('quiz:error', { message: 'Game has already started or ended.' });
      }

      socket.join(room.roomId);
      socket.quizPin = pin;
      socket.isHost = false;

      const playerObj = {
        socketId: socket.id,
        name: playerName || `Player_${socket.id.slice(0, 4)}`,
        score: 0,
        answeredThisRound: false
      };

      room.players.set(socket.id, playerObj);

      // Confirm to player
      socket.emit('quiz:joined', {
        pin,
        playerName: playerObj.name,
        category: room.category
      });

      // Broadcast updated lobby roster to room
      const playerList = Array.from(room.players.values()).map(p => ({
        name: p.name,
        score: p.score
      }));

      io.to(room.roomId).emit('lobby:update', { players: playerList });
    });

    // Handle disconnects
    socket.on('disconnect', () => {
      if (socket.quizPin) {
        const room = quizRooms.get(socket.quizPin);
        if (room) {
          if (socket.isHost) {
            io.to(room.roomId).emit('quiz:cancelled', { message: 'Host has left the game room.' });
            if (room.timer) clearInterval(room.timer);
            quizRooms.delete(socket.quizPin);
          } else {
            room.players.delete(socket.id);
            const playerList = Array.from(room.players.values()).map(p => ({
              name: p.name,
              score: p.score
            }));
            io.to(room.roomId).emit('lobby:update', { players: playerList });
          }
        }
      }
    });
  }
};
