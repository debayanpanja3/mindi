// Mindi online server: zero dependencies. Serves the game files and WebSocket rooms.
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const { Room } = require("../www/engine.js");
const WWW = path.join(__dirname, "..", "www");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".json": "application/json" };

const srv = http.createServer((q, r) => {
  if (q.url == "/health") { r.end("ok"); return; }
  let f = q.url.split("?")[0]; if (f == "/") f = "/index.html";
  const p = path.join(WWW, path.normalize(f));
  if (!p.startsWith(WWW)) { r.writeHead(403); r.end(); return; }
  fs.readFile(p, (e, d) => {
    if (e) { r.writeHead(404); r.end("Not found"); return; }
    r.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" }); r.end(d);
  });
});

const rooms = new Map(), conns = new Set();
function frame(c, op, data) {
  const n = data.length; let h;
  if (n < 126) h = Buffer.from([128 | op, n]);
  else if (n < 65536) { h = Buffer.alloc(4); h[0] = 128 | op; h[1] = 126; h.writeUInt16BE(n, 2); }
  else { h = Buffer.alloc(10); h[0] = 128 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
  if (!c.sock.destroyed) c.sock.write(Buffer.concat([h, data]));
}
const send = (c, o) => frame(c, 1, Buffer.from(JSON.stringify(o)));

function parse(c) {
  for (;;) {
    const b = c.buf; if (b.length < 2) return;
    const op = b[0] & 15, masked = (b[1] & 128) != 0; let len = b[1] & 127, o = 2;
    if (len == 126) { if (b.length < 4) return; len = b.readUInt16BE(2); o = 4; }
    else if (len == 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); o = 10; }
    if (len > 65536) { c.sock.destroy(); return; }
    const mk = masked ? 4 : 0; if (b.length < o + mk + len) return;
    const pl = Buffer.from(b.subarray(o + mk, o + mk + len));
    if (masked) { const key = b.subarray(o, o + 4); for (let i = 0; i < pl.length; i++) pl[i] ^= key[i & 3]; }
    c.buf = b.subarray(o + mk + len);
    if (op == 8) { c.sock.end(); return; }
    if (op == 9) frame(c, 10, pl);
    else if (op == 1) { try { onMsg(c, JSON.parse(pl.toString())); } catch (e) { } }
  }
}

function newCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  for (;;) { let s = ""; for (let i = 0; i < 4; i++) s += A[Math.random() * A.length | 0]; if (!rooms.has(s)) return s; }
}
function onMsg(c, m) {
  if (!m || typeof m != "object") return;
  if (m.t == "create" || m.t == "join") {
    if (c.entry) return;
    let e;
    if (m.t == "create") {
      const code = newCode();
      e = { code, conns: [null, null, null, null] };
      e.room = new Room((s, msg) => { if (e.conns[s]) send(e.conns[s], msg); });
      e.room.code = code; e.room.sp = +process.env.MINDI_SPEED || 1; rooms.set(code, e);
    } else {
      e = rooms.get(String(m.code || "").toUpperCase().trim());
      if (!e) return send(c, { t: "err", m: "Room not found" });
    }
    const seat = e.room.join(m.name);
    if (seat < 0) return send(c, { t: "err", m: "Room is full or already started" });
    e.conns[seat] = c; c.entry = e; c.seat = seat; e.room.bc();
    return;
  }
  if (c.entry) c.entry.room.act(c.seat, m);
}
function drop(c) {
  conns.delete(c); const e = c.entry; if (!e) return;
  e.conns[c.seat] = null; e.room.leave(c.seat);
  if (e.room.humans() == 0) { e.room.destroy(); rooms.delete(e.code); }
}
srv.on("upgrade", (q, sock) => {
  const k = q.headers["sec-websocket-key"]; if (!k) { sock.destroy(); return; }
  const acc = crypto.createHash("sha1").update(k + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + acc + "\r\n\r\n");
  const c = { sock, buf: Buffer.alloc(0), entry: null, seat: -1 }; conns.add(c);
  sock.on("data", d => { c.buf = Buffer.concat([c.buf, d]); parse(c); });
  sock.on("close", () => drop(c)); sock.on("error", () => sock.destroy());
});
setInterval(() => conns.forEach(c => frame(c, 9, Buffer.alloc(0))), 25000);
srv.listen(process.env.PORT || 3000, () => console.log("Mindi server on " + (process.env.PORT || 3000)));
