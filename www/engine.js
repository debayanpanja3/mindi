// Mindi game engine: runs on the server (online) and in the browser (bots mode).
(function (g) {
  function Room(send) {
    this.send = send; this.P = [null, null, null, null]; this.phase = "lobby";
    this.rd = 0; this.tot = [0, 0]; this.host = 0; this.trick = []; this.sp = 1; this.dead = false; this.code = "";
  }
  const R = Room.prototype;
  R.later = function (fn, ms) { return setTimeout(() => { if (!this.dead) fn(); }, ms * this.sp); };
  R.humans = function () { return this.P.filter(p => p && !p.bot).length; };
  R.destroy = function () { this.dead = true; clearTimeout(this.tm); clearTimeout(this.fl); };
  R.join = function (name) {
    if (this.phase != "lobby") return -1;
    const s = this.P.findIndex(p => !p); if (s < 0) return -1;
    this.P[s] = { name: String(name || "Player").slice(0, 12), bot: false }; return s;
  };
  R.leave = function (s) {
    if (!this.P[s] || this.P[s].bot) return;
    if (this.phase == "lobby") this.P[s] = null; else this.P[s] = { name: "Bot " + (s + 1), bot: true };
    if (this.host == s) { const n = this.P.findIndex(p => p && !p.bot); if (n >= 0) this.host = n; }
    this.bc(); this.step();
  };
  R.act = function (s, m) {
    if (this.dead || !m) return;
    if (m.t == "start" && s == this.host && this.phase == "lobby") {
      for (let i = 0; i < 4; i++) if (!this.P[i]) this.P[i] = { name: "Bot " + (i + 1), bot: true };
      this.newRound();
    } else if (m.t == "trump" && this.phase == "trump" && s == this.maker && Number.isInteger(m.v) && m.v >= 0 && m.v <= 4) this.pickTrump(m.v);
    else if (m.t == "play") this.playCard(s, m.c);
    else if (m.t == "next" && s == this.host && this.phase == "over") this.newRound();
    else if (m.t == "leave") this.leave(s);
  };
  R.newRound = function () {
    const d = []; for (let s = 0; s < 4; s++) for (let v = 2; v <= 14; v++) d.push({ s, v });
    for (let i = 51; i > 0; i--) { const j = Math.random() * (i + 1) | 0;[d[i], d[j]] = [d[j], d[i]]; }
    this.H = [0, 1, 2, 3].map(p => d.slice(p * 13, p * 13 + 13));
    this.maker = this.rd % 4; this.rd++; this.trump = null; this.how = false; this.trick = [];
    this.tens = [0, 0]; this.won = [0, 0]; this.dealt = 5; this.turn = null; this.win = null; this.res = null;
    this.phase = "trump"; this.bc(); this.step();
  };
  R.botTrump = function () {
    const c = [0, 0, 0, 0]; this.H[this.maker].slice(0, 5).forEach(x => c[x.s]++);
    const m = Math.max(...c); return m >= 3 ? c.indexOf(m) : 4;
  };
  R.pickTrump = function (v) {
    if (this.phase != "trump") return;
    this.how = v == 4; this.trump = v == 4 ? this.H[this.maker][12].s : v; this.phase = "deal"; this.bc();
    this.fl = this.later(() => { this.dealt = 9; this.bc();
      this.fl = this.later(() => { this.dealt = 13; this.bc();
        this.fl = this.later(() => { this.phase = "play"; this.lead = this.maker; this.turn = this.maker; this.bc(); this.step(); }, 1100);
      }, 1100);
    }, 1400);
  };
  R.val = function (c) { return c.v + (c.s == this.trump ? 20 : 0); };
  R.beats = function (c, d) { return c.s == d.s ? c.v > d.v : c.s == this.trump; };
  R.winner = function () { return this.trick.reduce((b, x) => this.beats(x.c, b.c) ? x : b); };
  R.legal = function (p) {
    const h = this.H[p]; if (!this.trick.length) return h;
    const m = h.filter(c => c.s == this.trick[0].c.s); return m.length ? m : h;
  };
  R.botCard = function (p) {
    const L = this.legal(p), lo = a => a.slice().sort((a, b) => this.val(a) - this.val(b));
    const n = L.filter(c => c.v != 10);
    if (!this.trick.length) { const q = L.filter(c => c.s != this.trump && c.v != 10); return lo(q.length ? q : L)[0]; }
    const cur = this.winner();
    if (cur.p % 2 == p % 2) { const t = L.filter(c => c.v == 10); if (this.trick.length == 3 && t.length) return t[0]; return lo(n.length ? n : L)[0]; }
    const w = L.filter(c => this.beats(c, cur.c)); if (w.length) return lo(w)[0];
    return lo(n.length ? n : L)[0];
  };
  R.playCard = function (s, c) {
    if (this.phase != "play" || this.turn !== s || !c) return;
    const m = this.legal(s).find(x => x.s == c.s && x.v == c.v); if (!m) return;
    this.H[s] = this.H[s].filter(x => x !== m); this.trick.push({ p: s, c: m });
    if (this.trick.length < 4) { this.turn = (s + 1) % 4; this.bc(); this.step(); return; }
    this.turn = null; const w = this.winner(); this.win = w.p; this.bc();
    this.fl = this.later(() => {
      const t = w.p % 2; this.won[t]++; this.tens[t] += this.trick.filter(x => x.c.v == 10).length;
      this.trick = []; this.win = null;
      if (this.H[0].length == 0) this.finish(); else { this.turn = w.p; this.bc(); this.step(); }
    }, 1600);
  };
  R.finish = function () {
    let wt = 0, txt = ""; const t = this.tens, w = this.won;
    for (const a of [0, 1]) {
      const o = 1 - a;
      if (t[a] == 4) { wt = a; txt = "GAME! All 4 tens"; }
      else if (t[a] >= 3) { wt = a; txt = t[a] + " tens"; }
      else if (t[a] == 2 && t[o] == 2 && w[a] >= 7) { wt = a; txt = "2 tens and " + w[a] + " tricks"; }
    }
    this.tot[wt]++; this.phase = "over"; this.res = { wt, txt }; this.turn = null; this.bc();
  };
  R.step = function () {
    clearTimeout(this.tm); if (this.dead) return;
    if (this.phase == "trump" && this.P[this.maker].bot) this.tm = this.later(() => this.pickTrump(this.botTrump()), 1600);
    else if (this.phase == "play" && this.turn != null && this.P[this.turn].bot) this.tm = this.later(() => this.playCard(this.turn, this.botCard(this.turn)), 750);
  };
  R.bc = function () { for (let s = 0; s < 4; s++) if (this.P[s] && !this.P[s].bot) this.send(s, this.view(s)); };
  R.view = function (s) {
    const o = { t: "state", code: this.code, seat: s, host: this.host, phase: this.phase, rd: this.rd, tot: this.tot,
      names: this.P.map(p => p ? p.name : null) };
    if (this.phase == "lobby") return o;
    const pl = this.phase == "play" || this.phase == "over";
    o.hand = this.H[s].slice(0, pl ? 13 : this.dealt);
    o.counts = this.H.map(h => pl ? h.length : this.dealt);
    o.maker = this.maker; o.trump = this.trump; o.how = this.how; o.trick = this.trick; o.turn = this.turn;
    o.win = this.win; o.tens = this.tens; o.won = this.won; o.res = this.res;
    if (this.phase == "play" && this.turn === s) o.legal = this.legal(s);
    return o;
  };
  const out = { Room };
  if (typeof module != "undefined" && module.exports) module.exports = out; else g.Engine = out;
})(typeof window != "undefined" ? window : globalThis);
