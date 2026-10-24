// Local network relay for the original browser game. The laptop page remains
// the game engine; this server manages room membership and transports actions.
const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const rooms = new Map();
const streams = new Map();

function randomToken(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function makeRoomCode() {
  return crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
}

function getRoom(code) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) throw new Error('Room not found. Ask the host to reopen the game page.');
  return room;
}

function networkAddresses() {
  const addresses = [];
  for (const [name, records] of Object.entries(os.networkInterfaces())) {
    for (const item of records || []) {
      if (item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.')) {
        addresses.push({ name, address: item.address });
      }
    }
  }
  return addresses.sort((a, b) => {
    const rank = value => /wi-?fi|wireless/i.test(value) ? 0 : /ethernet/i.test(value) ? 1 : 2;
    return rank(a.name) - rank(b.name);
  });
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new Error('Request is too large.');
  }
  return raw ? JSON.parse(raw) : {};
}

function roomStreams(room) {
  if (!streams.has(room.code)) streams.set(room.code, new Set());
  return streams.get(room.code);
}

function emit(client, event, data) {
  if (!client.res.destroyed) client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function roster(room) {
  return room.players.map(player => ({ id: player.id, name: player.name, connected: player.connected, clientId: player.clientId || null }));
}

function playerView(room, player) {
  const snapshot = room.snapshot;
  const connected = roster(room);
  if (!snapshot) {
    return {
      phase: 'lobby', room: room.code, hostConnected: room.hostConnected,
      players: connected, self: { id: player.id, name: player.name }, pending: null,
      snapshotRevision: room.snapshotRevision
    };
  }
  const self = snapshot.players.find(item => item.id === player.id) || (snapshot.phase === 'lobby' ? { id: player.id, name: player.name } : null);
  const pending = snapshot.pending;
  return {
    phase: snapshot.phase,
    room: room.code,
    hostConnected: room.hostConnected,
    players: snapshot.players.map(item => ({ id: item.id, name: item.name, connected: connected.find(p => p.id === item.id)?.connected ?? false })),
    self: self ? { id: self.id, name: self.name, money: self.money, shares: self.shares, hand: self.hand } : null,
    companies: snapshot.companies,
    board: snapshot.board,
    currentPlayerId: snapshot.currentPlayerId,
    pending,
    winners: snapshot.winners,
    snapshotRevision: room.snapshotRevision,
    canPlay: snapshot.phase === 'playing' && snapshot.currentPlayerId === player.id && !pending,
  };
}

function publish(room) {
  for (const client of roomStreams(room)) {
    if (client.role === 'host') emit(client, 'roster', { players: roster(room) });
    else {
      const player = room.players.find(item => item.token === client.token);
      if (player) emit(client, 'state', playerView(room, player));
    }
  }
}

function openStream(req, res, room, role, token) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': connected\n\n');
  const client = { res, role, token };
  roomStreams(room).add(client);
  const player = role === 'player' ? room.players.find(item => item.token === token) : null;
  if (player) player.connected = true;
  if (role === 'host') room.hostConnected = true;
  if (role === 'host') emit(client, 'roster', { players: roster(room) });
  else if (player) emit(client, 'state', playerView(room, player));
  publish(room);

  const keepAlive = setInterval(() => { if (!res.destroyed) res.write(': keep-alive\n\n'); }, 20_000);
  res.on('close', () => {
    clearInterval(keepAlive);
    roomStreams(room).delete(client);
    if (role === 'host') room.hostConnected = [...roomStreams(room)].some(item => item.role === 'host');
    if (player) player.connected = [...roomStreams(room)].some(item => item.role === 'player' && item.token === player.token);
    publish(room);
  });
}

function validateAction(room, player, action) {
  const snapshot = room.snapshot;
  if (!room.hostConnected || !snapshot || snapshot.phase !== 'playing') throw new Error('The laptop game page is not connected.');
  const pending = snapshot.pending;
  if (action.type === 'play') {
    if (snapshot.currentPlayerId !== player.id || pending) throw new Error('It is not your tile placement step.');
    const gamePlayer = snapshot.players.find(item => item.id === player.id);
    const tile = gamePlayer?.hand.find(item => item.name === action.tile);
    if (!tile || tile.unplayable) throw new Error('That tile cannot be played right now.');
    return;
  }
  if (action.type === 'choice') {
    if (pending?.type !== 'choice' || pending.playerId !== player.id || !pending.choices.includes(action.company)) throw new Error('That company choice is no longer available.');
    return;
  }
  if (action.type === 'buy') {
    if (pending?.type !== 'buy' || pending.playerId !== player.id) throw new Error('It is not your share purchase step.');
    const gamePlayer = snapshot.players.find(item => item.id === player.id);
    const purchases = Array.isArray(action.purchases) ? action.purchases : [];
    let count = 0, cost = 0;
    for (const purchase of purchases) {
      const company = snapshot.companies.find(item => item.name === purchase.company);
      const quantity = Number(purchase.quantity);
      if (!company || !Number.isInteger(quantity) || quantity < 0 || quantity > company.sharesLeft) throw new Error('Enter a whole number of shares that are still available.');
      count += quantity;
      cost += quantity * company.price;
    }
    if (count > 3) throw new Error('You can buy at most 3 shares total.');
    if (cost > (gamePlayer?.money ?? 0)) throw new Error('You do not have enough cash for that purchase.');
    return;
  }
  if (action.type === 'merger') {
    if (pending?.type !== 'merger' || pending.playerId !== player.id) throw new Error('It is not your merger decision.');
    const sell = Number(action.sell), trade = Number(action.trade);
    if (!Number.isInteger(sell) || !Number.isInteger(trade) || sell < 0 || trade < 0 || sell + trade * 2 > pending.shares || trade > pending.maxTrades) throw new Error('Those merger choices exceed your available shares.');
    return;
  }
  throw new Error('Unknown game action.');
}

function staticFile(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (!['index.html', 'script.js', 'style.css'].includes(file)) {
    res.writeHead(404); res.end('Not found.'); return;
  }
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  fs.readFile(path.join(ROOT, file), (error, data) => {
    if (error) { res.writeHead(404); res.end('Not found.'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)], 'cache-control': 'no-store' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, port: PORT, addresses: networkAddresses(), features: { lobbyKick: 2 } });

    if (req.method === 'POST' && url.pathname === '/api/host-room') {
      const body = await readJson(req);
      let existingRoom = [...rooms.values()].find(item => body.hostToken && item.hostToken === body.hostToken);
      // If browser storage is unavailable on this origin, reuse the only room
      // already hosted by this server instead of silently creating a new code.
      if (!existingRoom && !body.hostToken && rooms.size === 1) {
        existingRoom = rooms.values().next().value;
      }
      if (existingRoom) {
        return json(res, 200, {
          code: existingRoom.code, hostToken: existingRoom.hostToken, port: PORT,
          addresses: networkAddresses(), players: roster(existingRoom),
          snapshotRevision: existingRoom.snapshotRevision, resumed: true
        });
      }

      const requestedCode = /^[A-F0-9]{6}$/i.test(body.roomCode || "") ? String(body.roomCode).toUpperCase() : "";
      if (requestedCode && rooms.has(requestedCode)) {
        return json(res, 409, { error: `Room ${requestedCode} is already active, but this host session could not be verified. The existing game was left untouched.` });
      }
      const code = requestedCode || makeRoomCode();
      const hostToken = /^[A-Za-z0-9_-]{20,128}$/.test(body.hostToken || "") ? body.hostToken : randomToken();
      const players = Array.isArray(body.players) ? body.players.slice(0, 6).map((item, index) => ({
        id: Number.isInteger(item.id) && item.id >= 0 && item.id < 6 ? item.id : index,
        name: String(item.name || `Player ${index + 1}`).trim().slice(0, 24) || `Player ${index + 1}`,
        token: randomToken(),
        clientId: /^[A-Za-z0-9_-]{16,128}$/.test(item.clientId || '') ? item.clientId : null,
        connected: false
      })) : [];
      const room = { code, hostToken, hostConnected: false, players, snapshot: null, snapshotRevision: 0, pendingActionId: null, actionIds: new Set() };
      rooms.set(code, room);
      return json(res, 201, {
        code, hostToken: room.hostToken, port: PORT,
        addresses: networkAddresses(), players: roster(room), snapshotRevision: 0, resumed: false
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/join') {
      const body = await readJson(req), room = getRoom(body.room);
      const name = String(body.name || '').trim().slice(0, 24);
      const clientId = /^[A-Za-z0-9_-]{16,128}$/.test(body.clientId || '') ? body.clientId : '';
      if (!name) throw new Error('Enter your name.');
      // A player who lost their saved browser token can reclaim their seat by
      // device ID or name after a disconnect, including after the game has started.
      const deviceMatches = clientId ? room.players.filter(player => player.clientId === clientId) : [];
      const matchingPlayers = deviceMatches.length
        ? deviceMatches
        : room.players.filter(player => player.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (matchingPlayers.length > 1) throw new Error('More than one player has that name. Reconnect from the original phone browser or ask the host to use unique player names.');
      if (matchingPlayers.length === 1) {
        const player = matchingPlayers[0];
        const gameStarted = room.snapshot?.phase === 'playing' || room.snapshot?.phase === 'finished';
        if (gameStarted && player.name.toLocaleLowerCase() !== name.toLocaleLowerCase()) {
          throw new Error('This game is already in progress. Rejoin with the name already assigned to your seat.');
        }
        const oldToken = player.token;
        for (const client of [...roomStreams(room)]) {
          if (client.role === 'player' && client.token === oldToken) {
            emit(client, 'replaced', { message: 'This player seat reconnected in another tab or session.' });
            roomStreams(room).delete(client);
            client.res.end();
          }
        }
        player.name = name;
        if (clientId) player.clientId = clientId;
        player.token = randomToken();
        publish(room);
        return json(res, 200, { code: room.code, id: player.id, token: player.token, reconnected: true });
      }
      if (room.snapshot?.phase === 'playing' || room.snapshot?.phase === 'finished') throw new Error('This game has already started.');
      if (room.players.length >= 6) throw new Error('This room already has six players.');
      const player = { id: room.players.length, name, token: randomToken(), clientId: clientId || null, connected: false };
      room.players.push(player);
      publish(room);
      return json(res, 201, { code: room.code, id: player.id, token: player.token });
    }

    if (req.method === 'POST' && url.pathname === '/api/kick') {
      const body = await readJson(req), room = getRoom(body.room);
      if (body.hostToken !== room.hostToken) throw new Error('Only the laptop host can remove a player.');
      if (body.hostPhase !== 'lobby') {
        return json(res, 409, { error: 'Players can only be removed before the game starts.' });
      }
      const index = room.players.findIndex(player => player.id === Number(body.playerId));
      if (index < 0) return json(res, 404, { error: 'That player is no longer in the lobby.' });
      const [removedPlayer] = room.players.splice(index, 1);
      for (const client of [...roomStreams(room)]) {
        if (client.role === 'player' && client.token === removedPlayer.token) {
          emit(client, 'kicked', { message: 'The host removed your seat. Rejoin the lobby with your preferred name.' });
          roomStreams(room).delete(client);
          client.res.end();
        }
      }
      room.players.forEach((player, playerIndex) => { player.id = playerIndex; });
      publish(room);
      return json(res, 200, { ok: true, players: roster(room) });
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      const room = getRoom(url.searchParams.get('room'));
      const player = room.players.find(item => item.token === url.searchParams.get('token'));
      if (!player) return json(res, 401, { error: 'Reconnect token not recognized. Join the room again.' });
      return json(res, 200, playerView(room, player));
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      const room = getRoom(url.searchParams.get('room'));
      const hostToken = url.searchParams.get('host');
      const token = url.searchParams.get('token');
      if (hostToken === room.hostToken) return openStream(req, res, room, 'host', hostToken);
      const player = room.players.find(item => item.token === token);
      if (!player) { res.writeHead(401); res.end(); return; }
      return openStream(req, res, room, 'player', token);
    }

    if (req.method === 'POST' && url.pathname === '/api/snapshot') {
      const body = await readJson(req), room = getRoom(body.room);
      if (body.hostToken !== room.hostToken) throw new Error('Only the laptop host can publish game state.');
      if (Number(body.revision) > room.snapshotRevision) {
        room.snapshotRevision = Number(body.revision);
        room.snapshot = body.snapshot;
        room.pendingActionId = null;
        publish(room);
      }
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/action') {
      const body = await readJson(req), room = getRoom(body.room);
      const player = room.players.find(item => item.token === body.token);
      if (!player) throw new Error('Reconnect to your player seat first.');
      if (room.actionIds.has(body.actionId)) return json(res, 200, { ok: true, duplicate: true });
      if (typeof body.actionId !== 'string' || !body.actionId) throw new Error('Action is missing its request id.');
      if (room.pendingActionId) throw new Error('The previous action is still being applied.');
      validateAction(room, player, body);
      const host = [...roomStreams(room)].find(item => item.role === 'host');
      if (!host) throw new Error('The laptop game page is not connected.');
      room.actionIds.add(body.actionId);
      room.pendingActionId = body.actionId;
      if (room.actionIds.size > 5000) room.actionIds.delete(room.actionIds.values().next().value);
      emit(host, 'action', { ...body, playerId: player.id });
      return json(res, 202, { ok: true });
    }

    if (req.method === 'GET') return staticFile(req, res);
    return json(res, 404, { error: 'Not found.' });
  } catch (error) {
    return json(res, 400, { error: error.message || 'Request failed.' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Acquire game host listening at http://localhost:${PORT}`);
  for (const item of networkAddresses()) console.log(`Phone link network address (${item.name}): http://${item.address}:${PORT}`);
  console.log('Keep this terminal and the laptop game page open while playing.');
});
