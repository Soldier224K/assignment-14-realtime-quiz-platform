// sockets/gameEngine.js
const questions = require('../data/questions.json');
const { quizRooms } = require('./lobbyHandler');

// Dynamic Scoring Algorithm: Base (500) + Speed Bonus (up to 500)
function calculateScore(isCorrect, timeTakenMs, totalTimeLimitMs = 15000) {
  if (!isCorrect) return 0;
  const timeRemaining = Math.max(0, totalTimeLimitMs - timeTakenMs);
  const speedBonus = Math.round((timeRemaining / totalTimeLimitMs) * 500);
  const baseScore = 500;
  return baseScore + speedBonus;
}

function sendQuestionRound(io, room) {
  const qIndex = room.currentQuestionIndex;
  const currentQ = questions[qIndex];

  if (!currentQ) {
    // End of quiz game
    return endQuiz(io, room);
  }

  // Reset player answer status
  for (const player of room.players.values()) {
    player.answeredThisRound = false;
  }

  room.questionStartTime = Date.now();
  let timeRemaining = 15;

  // Broadcast question payload WITHOUT correctOption to prevent cheating!
  io.to(room.roomId).emit('question:start', {
    questionIndex: qIndex + 1,
    totalQuestions: questions.length,
    question: currentQ.question,
    options: currentQ.options,
    timeLimitSeconds: timeRemaining
  });

  // Start 15s Countdown Clock
  if (room.timer) clearInterval(room.timer);

  room.timer = setInterval(() => {
    timeRemaining--;
    io.to(room.roomId).emit('timer:tick', { timeRemaining });

    if (timeRemaining <= 0) {
      clearInterval(room.timer);
      handleQuestionTimeUp(io, room, currentQ);
    }
  }, 1000);
}

function handleQuestionTimeUp(io, room, currentQ) {
  // 1. Reveal correct answer & explanation
  io.to(room.roomId).emit('question:time_up', {
    correctOption: currentQ.correctOption,
    explanation: currentQ.explanation
  });

  // 2. Generate and broadcast sorted leaderboard
  const sortedPlayers = Array.from(room.players.values())
    .sort((a, b) => b.score - a.score)
    .map((p, idx) => ({
      rank: idx + 1,
      name: p.name,
      score: p.score
    }));

  setTimeout(() => {
    io.to(room.roomId).emit('leaderboard:update', { leaderboard: sortedPlayers });

    // Transition to next round after 5 seconds
    setTimeout(() => {
      room.currentQuestionIndex++;
      sendQuestionRound(io, room);
    }, 4000);
  }, 2500);
}

function endQuiz(io, room) {
  room.status = 'ended';

  const finalRanks = Array.from(room.players.values())
    .sort((a, b) => b.score - a.score)
    .map((p, idx) => ({
      rank: idx + 1,
      name: p.name,
      score: p.score
    }));

  const winner = finalRanks.length > 0 ? finalRanks[0] : null;

  io.to(room.roomId).emit('quiz:ended', {
    winner,
    finalRanks
  });
}

module.exports = {
  setupGameHandlers: (io, socket) => {
    // Host starts quiz
    socket.on('quiz:start', ({ pin }) => {
      const room = quizRooms.get(pin);
      if (!room || room.hostId !== socket.id) return;

      room.status = 'in_progress';
      room.currentQuestionIndex = 0;

      io.to(room.roomId).emit('quiz:starting', {
        message: 'Get Ready! Quiz starting in 3 seconds...'
      });

      setTimeout(() => {
        sendQuestionRound(io, room);
      }, 3000);
    });

    // Player submits answer
    socket.on('answer:submit', ({ pin, selectedOption, timeTakenMs }) => {
      const room = quizRooms.get(pin);
      if (!room || room.status !== 'in_progress') return;

      const player = room.players.get(socket.id);
      if (!player || player.answeredThisRound) return;

      const currentQ = questions[room.currentQuestionIndex];
      if (!currentQ) return;

      // Anti-cheat: calculate server-side elapsed time
      const serverElapsedMs = Date.now() - (room.questionStartTime || Date.now());
      if (serverElapsedMs > 16500) {
        return socket.emit('answer:result', {
          isCorrect: false,
          pointsEarned: 0,
          totalScore: player.score,
          message: 'Time expired! Answer submitted too late.'
        });
      }

      player.answeredThisRound = true;
      const isCorrect = Number(selectedOption) === currentQ.correctOption;
      const points = calculateScore(isCorrect, Math.min(serverElapsedMs, timeTakenMs || serverElapsedMs));

      player.score += points;

      socket.emit('answer:result', {
        isCorrect,
        pointsEarned: points,
        totalScore: player.score,
        correctOption: currentQ.correctOption
      });

      // Notify host of submission count
      const answeredCount = Array.from(room.players.values()).filter(p => p.answeredThisRound).length;
      io.to(room.hostId).emit('host:player_answered', {
        answeredCount,
        totalPlayers: room.players.size
      });
    });
  }
};
