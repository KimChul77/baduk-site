const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = {};

function createEmptyBoard(size = 9) {
  return Array.from({ length: size }, () => Array(size).fill(0));
}

function boardToString(board) {
  return board.map((row) => row.join('')).join('|');
}

function createRoom(roomId) {
  rooms[roomId] = {
    roomId,
    size: 9,
    board: createEmptyBoard(9),
    players: [],
    spectators: [],
    turn: 1,
    status: 'waiting',
    winner: 0,
    moveCount: 0,
    chat: [],
    previousBoardHash: boardToString(createEmptyBoard(9)),
  };
  return rooms[roomId];
}

function getRoom(roomId) {
  return rooms[roomId] || createRoom(roomId);
}

function getPlayerBySocket(room, socketId) {
  return room.players.find((p) => p.socketId === socketId);
}

function getPlayerStone(room, socketId) {
  const p = getPlayerBySocket(room, socketId);
  return p ? p.stone : 0;
}

function emitRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit('roomState', {
    roomId: room.roomId,
    size: room.size,
    board: room.board,
    players: room.players.map((p) => ({ nickname: p.nickname, stone: p.stone })),
    spectators: room.spectators.map((s) => ({ nickname: s.nickname })),
    turn: room.turn,
    status: room.status,
    winner: room.winner,
    moveCount: room.moveCount,
    chat: room.chat.slice(-50),
  });
}

function cloneBoard(board) {
  return board.map((row) => [...row]);
}

function getNeighbors(x, y, size) {
  const neighbors = [];
  if (x > 0) neighbors.push([x - 1, y]);
  if (x < size - 1) neighbors.push([x + 1, y]);
  if (y > 0) neighbors.push([x, y - 1]);
  if (y < size - 1) neighbors.push([x, y + 1]);
  return neighbors;
}

function getGroupAndLiberties(board, x, y) {
  const size = board.length;
  const color = board[y][x];
  if (color === 0) return { group: [], liberties: 0 };

  const visited = new Set();
  const stack = [[x, y]];
  const group = [];
  const libertySet = new Set();

  while (stack.length > 0) {
    const [cx, cy] = stack.pop();
    const key = `${cx},${cy}`;
    if (visited.has(key)) continue;
    visited.add(key);

    if (board[cy][cx] !== color) continue;
    group.push([cx, cy]);

    const neighbors = getNeighbors(cx, cy, size);
    for (const [nx, ny] of neighbors) {
      const cell = board[ny][nx];
      if (cell === 0) libertySet.add(`${nx},${ny}`);
      else if (cell === color && !visited.has(`${nx},${ny}`)) {
        stack.push([nx, ny]);
      }
    }
  }

  return { group, liberties: libertySet.size };
}

function removeGroup(board, group) {
  for (const [x, y] of group) {
    board[y][x] = 0;
  }
}

function tryPlaceStone(room, x, y, stone) {
  if (room.board[y][x] !== 0) {
    return { ok: false, message: '이미 돌이 있습니다.' };
  }

  const beforeHash = boardToString(room.board);
  const board = cloneBoard(room.board);
  board[y][x] = stone;

  const enemy = stone === 1 ? 2 : 1;

  const neighbors = getNeighbors(x, y, 9);
  for (const [nx, ny] of neighbors) {
    if (board[ny][nx] === enemy) {
      const result = getGroupAndLiberties(board, nx, ny);
      if (result.liberties === 0) {
        removeGroup(board, result.group);
      }
    }
  }

  const my = getGroupAndLiberties(board, x, y);
  if (my.liberties === 0) {
    return { ok: false, message: '자살수 금지' };
  }

  const afterHash = boardToString(board);
  if (afterHash === room.previousBoardHash) {
    return { ok: false, message: '패 금지' };
  }

  room.previousBoardHash = beforeHash;
  room.board = board;

  return { ok: true };
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, nickname }) => {
    const room = getRoom(roomId);

    let role = 'spectator';
    let stone = 0;

    if (room.players.length < 2) {
      role = 'player';
      stone = room.players.length === 0 ? 1 : 2;
      room.players.push({ socketId: socket.id, nickname, stone });
    } else {
      room.spectators.push({ socketId: socket.id, nickname });
    }

    socket.join(roomId);
    socket.data = { roomId, nickname, role, stone };

    if (room.players.length === 2) room.status = 'playing';

    emitRoomState(roomId);

    socket.emit('myInfo', { nickname, role, stone });
  });

  socket.on('placeStone', ({ x, y }) => {
    const room = rooms[socket.data.roomId];
    if (!room) return;

    if (socket.data.role !== 'player') return;
    if (room.turn !== socket.data.stone) return;

    const result = tryPlaceStone(room, x, y, socket.data.stone);
    if (!result.ok) {
      socket.emit('joinError', result.message);
      return;
    }

    room.turn = room.turn === 1 ? 2 : 1;
    emitRoomState(socket.data.roomId);
  });
});

app.use(express.static(path.join(__dirname, 'public')));

server.listen(PORT, () => {
  console.log(`바둑 서버 실행됨 → http://localhost:${PORT}`);
});