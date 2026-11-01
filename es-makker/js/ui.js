/* =============================================================
   ui.js
   Rendering af kort og bord, meldepanel, byttedialog med animation,
   beskeder og scoreboard.
   ============================================================= */

import { SUITS, SUIT_BY_KEY, RANK_NAMES, sortHand } from './card.js';
import {
  VARIANT_LABEL, VARIANT_ORDER, SPECIALS, SPECIAL_INFO,
  Bid, legalBids
} from './game.js';

const $  = sel => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls)  n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Skriver tekst ind i et element og farver ♥ og ♦ røde - i topbaren, loggen,
 * beskeder og dialoger, ikke kun på selve kortene.
 */
function setSuitText(node, text) {
  node.textContent = '';
  for (const part of String(text ?? '').split(/([♥♦])/)) {
    if (!part) continue;
    node.appendChild(part === '♥' || part === '♦'
      ? el('span', 'suit-red', part)
      : document.createTextNode(part));
  }
}

/* Skærmpladser i urets retning set fra spilleren selv. */
const SEAT_SLOTS = ['south', 'west', 'north', 'east', 'extra'];

/* =============================================================
   KORT-RENDERING
   ============================================================= */

/**
 * Klassisk pip-opstilling. Hvert punkt er [x, y] i procent af pip-feltet,
 * hvor 25/50/75 er venstre, midter- og højrekolonne. Kort med 9 og 10 bruger
 * fire rækker i kolonnerne i stedet for tre, præcis som på rigtige spillekort.
 * Pips i den nederste halvdel vendes på hovedet.
 */
const PIP_LAYOUT = {
  'A':  [[50, 50]],
  '2':  [[50, 16], [50, 84]],
  '3':  [[50, 16], [50, 50], [50, 84]],
  '4':  [[25, 16], [75, 16], [25, 84], [75, 84]],
  '5':  [[25, 16], [75, 16], [50, 50], [25, 84], [75, 84]],
  '6':  [[25, 16], [75, 16], [25, 50], [75, 50], [25, 84], [75, 84]],
  '7':  [[25, 16], [75, 16], [50, 33], [25, 50], [75, 50], [25, 84], [75, 84]],
  '8':  [[25, 16], [75, 16], [50, 33], [25, 50], [75, 50], [50, 67], [25, 84], [75, 84]],
  '9':  [[25, 16], [75, 16], [25, 39], [75, 39], [50, 50], [25, 61], [75, 61], [25, 84], [75, 84]],
  '10': [[25, 16], [75, 16], [50, 27], [25, 39], [75, 39], [25, 61], [75, 61], [50, 73], [25, 84], [75, 84]]
};

const COURT_RANKS = ['J', 'Q', 'K'];

/** Korte navne på meldeknapperne - kolonneoverskriften har det lange. */
const VARIANT_SHORT = { alm: 'Alm.', vip: 'Vip', gode: 'Gode', halve: 'Halve' };

/** Bygger et kort-element. */
export function cardEl(card, { small = false, faceDown = false } = {}) {
  if (faceDown) {
    return el('div', 'card-back' + (small ? ' card-sm' : ''));
  }
  const n = el('div', 'card');
  if (small) n.classList.add('card-sm');
  n.dataset.cardId = card.id;

  if (card.isJoker) {
    n.classList.add('joker');
    n.appendChild(corner('tl', 'JOKER', '★'));
    n.appendChild(corner('br', 'JOKER', '★'));
    n.appendChild(el('div', 'joker-mark', '★'));
    n.title = card.longLabel;
    return n;
  }

  if (card.color === 'red') n.classList.add('red');
  n.appendChild(corner('tl', card.rank, card.symbol));
  n.appendChild(corner('br', card.rank, card.symbol));
  n.appendChild(pipField(card));
  n.title = card.longLabel;
  return n;
}

/** Kortets midterfelt: figurpanel på klædekort, ellers rigtige pips. */
function pipField(card) {
  const field = el('div', 'pips');

  if (COURT_RANKS.includes(card.rank)) {
    field.classList.add('court-panel');
    const inner = el('div', 'court-inner');
    inner.appendChild(el('span', 'court-letter', card.rank));
    inner.appendChild(el('span', 'court-suit', card.symbol));
    field.appendChild(inner);
    return field;
  }

  if (card.rank === 'A') field.classList.add('ace');

  for (const [x, y] of PIP_LAYOUT[card.rank] || []) {
    const pip = el('span', 'pip-mark', card.symbol);
    pip.style.left = `${x}%`;
    pip.style.top = `${y}%`;
    if (y > 50.5) pip.classList.add('flip');
    field.appendChild(pip);
  }
  return field;
}

function corner(pos, rank, symbol) {
  const c = el('div', `corner ${pos}`);
  c.appendChild(el('span', 'r', rank));
  c.appendChild(el('span', 's', symbol));
  return c;
}

/* =============================================================
   UI
   ============================================================= */
export class UI {
  constructor() {
    this.dom = {
      table:       $('#table'),
      trickArea:   $('#trick-area'),
      myHand:      $('#my-hand'),
      southSeat:   $('#south-seat'),
      kittyCards:  $('#kitty-cards'),
      hud:         $('#table-hud'),
      turnHint:    $('#turn-hint'),
      contractBar: $('#contract-banner'),
      contractTxt: $('#contract-text'),
      toast:       $('#table-toast'),
      log:         $('#log'),
      scoreHead:   $('#scoreboard-head'),
      scoreBody:   $('#scoreboard-body'),
      scoreTotal:  $('#scoreboard-total'),
      matchBar:    $('#match-bar-fill'),
      matchText:   $('#match-text'),
      overlay:     $('#overlay'),
      modalTitle:  $('#modal-title'),
      modalText:   $('#modal-text'),
      modalBody:   $('#modal-body'),
      modalActions:$('#modal-actions'),
      infoOverlay: $('#info-overlay'),
      infoTitle:   $('#info-title'),
      infoBody:    $('#info-body'),
      infoActions: $('#info-actions')
    };
    this.players = [];
    this.humanIndex = 0;
    this.slotOf = {};        // spillerindeks -> skærmplads
    this.snapshot = null;
    this.pendingCard = null; // { legalIds:Set, resolve }

    // Hånden lægges ud efter den plads der er, så den skal gentegnes når vinduet ændres.
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (this.snapshot?.state) this.renderMyHand(this.snapshot); }, 80);
    });
  }

  /* ---------- opsætning ---------- */
  setPlayers(players, humanIndex) {
    this.players = players;
    this.humanIndex = humanIndex;
    this.slotOf = {};
    const n = players.length;
    for (let i = 0; i < n; i++) {
      const offset = (i - humanIndex + n) % n;
      this.slotOf[i] = SEAT_SLOTS[offset];
    }
    this.buildSeats();
    this.buildScoreboard();
  }

  buildSeats() {
    for (const slot of ['north', 'east', 'west', 'extra']) {
      const seat = this.dom.table.querySelector(`.seat-${slot}`);
      seat.innerHTML = '';
      seat.classList.add('hidden');
    }
    for (const p of this.players) {
      const slot = this.slotOf[p.index];
      if (slot === 'south') {
        this.dom.southSeat.querySelector('.seat-name').textContent = p.name;
        continue;
      }
      const seat = this.dom.table.querySelector(`.seat-${slot}`);
      seat.classList.remove('hidden');
      seat.dataset.player = p.index;
      const plate = el('div', 'seat-plate');
      plate.appendChild(el('span', 'seat-name', p.name));
      plate.appendChild(el('span', 'seat-meta', ''));
      seat.appendChild(plate);
      seat.appendChild(el('div', 'hand hand-bot'));
    }
  }

  seatNode(playerIndex) {
    const slot = this.slotOf[playerIndex];
    return slot === 'south'
      ? this.dom.southSeat
      : this.dom.table.querySelector(`.seat-${slot}`);
  }

  /* ---------- log og toast ---------- */
  log({ text, cls = '' }) {
    const li = el('li', cls);
    setSuitText(li, text);
    this.dom.log.appendChild(li);
    this.dom.log.scrollTop = this.dom.log.scrollHeight;
    while (this.dom.log.children.length > 300) this.dom.log.removeChild(this.dom.log.firstChild);
  }

  async toast(text, ms = 1400) {
    const t = this.dom.toast;
    setSuitText(t, text);
    t.classList.remove('hidden');
    // genstart animationen
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    await sleep(ms);
    t.classList.add('hidden');
  }

  /* =============================================================
     HOVEDRENDERING
     ============================================================= */
  render(snapshot) {
    this.snapshot = snapshot;
    const st = snapshot.state;

    this.renderScores(snapshot);
    this.renderMatch(snapshot);
    if (!st) return;

    this.renderContractBar(snapshot);
    this.renderSeats(snapshot);
    this.renderMyHand(snapshot);
    this.renderKitty(snapshot);
    this.renderHud(snapshot);
    this.renderTrick(st);
  }

  renderContractBar(s) {
    const st = s.state;
    const bar = this.dom.contractBar;
    if (!st.contract) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');

    const bits = [`${this.nameOf(st.declarer)} spiller ${st.contract.label}`];
    if (st.trump) bits.push(`Trumf ${SUIT_BY_KEY[st.trump].symbol} ${SUIT_BY_KEY[st.trump].name}`);
    else if (!st.contract.isSolo) bits.push('Uden trumf');
    if (st.partnerCard && !st.contract.isSolo) {
      // Selvmakker vises kun hvis det er offentligt kendt - eller hvis DU er
      // spilføreren og selv har set esset ligge i katten.
      const iKnow = st.selfPartnerTruth &&
        (st.selfPartnerKnown || (this.humanIndex === st.declarer && st.declarerSawKitty));
      const known = (st.partnerRevealed || st.partnerKnown) && st.partnerSeat !== null;
      bits.push(iKnow
        ? `Selvmakker (${st.partnerCard.label} lå i katten)`
        : `Makkeres: ${st.partnerCard.label}${known ? ' – ' + this.nameOf(st.partnerSeat) : ''}`);
    }
    setSuitText(this.dom.contractTxt, bits.join('  ·  '));
  }

  renderSeats(s) {
    const st = s.state;
    for (const p of this.players) {
      const node = this.seatNode(p.index);
      if (!node) continue;

      node.classList.toggle('is-dealer',  p.index === s.dealer);
      node.classList.toggle('is-host',    p.index === s.hostIndex);
      node.classList.toggle('is-declarer', p.index === st.declarer);

      const role = this.roleOf(p.index, st);
      node.dataset.role = role || '';
      const meta = node.querySelector('.seat-meta');
      if (meta) {
        const cards = (st.hands[p.index] || []).length;
        const parts = [`${st.tricksWon[p.index] || 0} stik`];
        if (role) parts.push(role);
        meta.textContent = parts.join(' · ');
        // Antal kort vises kun på små skærme, hvor bagsiderne er skjult.
        if (this.slotOf[p.index] !== 'south') {
          meta.appendChild(el('span', 'meta-cards', ` · ${cards} kort`));
        }
      }

      if (this.slotOf[p.index] === 'south') continue;

      const handBox = node.querySelector('.hand-bot');
      if (!handBox) continue;
      handBox.innerHTML = '';
      const cards = st.hands[p.index] || [];
      const open = st.openHands?.includes(p.index);
      handBox.classList.toggle('is-open', !!open);
      const shown = open ? sortHand(cards, st.aceLow) : cards;
      for (const c of shown) {
        handBox.appendChild(open ? cardEl(c, { small: true }) : cardEl(null, { small: true, faceDown: true }));
      }
    }
  }

  /**
   * Hvilken rolle har spilleren set fra DIG? Kun det du faktisk kan vide:
   * makkeren vises først når esset er faldet (eller i Halve), og en hemmelig
   * selvmakker vises kun for spilføreren selv.
   */
  roleOf(seat, st) {
    if (!st.contract) return '';
    if (seat === st.declarer) return st.contract.isSolo ? 'spiller alene' : 'spilfører';
    if (st.contract.isSolo) return '';
    const known = (st.partnerRevealed || st.partnerKnown) && st.partnerSeat !== null;
    if (known && seat === st.partnerSeat) return 'makker';
    if (seat === this.humanIndex && this.iHoldPartner(st)) return 'makker (hemmeligt)';
    return '';
  }

  /** Har du selv makkeresset - på hånden eller allerede spillet? */
  iHoldPartner(st) {
    const pc = st.partnerCard;
    if (!pc) return false;
    const me = this.humanIndex;
    return (st.hands[me] || []).some(c => c.id === pc.id) ||
      (st.played || []).some(p => p.seat === me && p.card.id === pc.id);
  }

  renderMyHand(s) {
    const st = s.state;
    const box = this.dom.myHand;
    box.innerHTML = '';
    const me = this.humanIndex;
    const hand = sortHand(st.hands[me] || [], st.aceLow);
    const pending = this.pendingCard;

    for (const c of hand) {
      const n = cardEl(c);
      if (pending) {
        if (pending.legalIds.has(c.id)) {
          n.classList.add('playable');
          n.addEventListener('click', () => this.resolveCard(c.id));
        } else {
          n.classList.add('blocked');
        }
      }
      box.appendChild(n);
    }
    this.fitHand(box, hand.length);
    box.classList.toggle('is-waiting', !!pending);

    const meta = this.dom.southSeat.querySelector('.seat-meta');
    if (meta) {
      const role = this.roleOf(me, st);
      meta.textContent = [`${st.tricksWon[me] || 0} stik`, role].filter(Boolean).join(' · ');
    }
  }

  /**
   * Lægger hånden ud så den altid kan være der: kortene spredes når der er
   * plads, og overlapper mere når der ikke er - så intet kort havner uden
   * for skærmen og bliver umuligt at ramme.
   */
  fitHand(box, n) {
    if (!n) return;
    const first = box.firstElementChild;
    const cardW = first ? first.offsetWidth : 74;
    const avail = box.clientWidth - 8;
    const maxStep = cardW + 4;                          // lidt luft mellem kortene
    const minStep = Math.min(cardW * 0.42, 30);         // rang og kulør skal kunne ses
    const step = n > 1
      ? Math.max(minStep, Math.min(maxStep, (avail - cardW) / (n - 1)))
      : cardW;
    box.style.setProperty('--hand-overlap', `${(step - cardW).toFixed(1)}px`);
  }

  renderKitty(s) {
    const st = s.state;
    const box = this.dom.kittyCards;
    box.innerHTML = '';
    for (const c of st.kitty) {
      box.appendChild(cardEl(c, { small: true, faceDown: !this.kittyOpen }));
    }
  }

  /**
   * Overblikket i bordets hjørne: hvilket stik, hvad er trumf, og hvor langt
   * er spilføreren fra målet. Det er de tre ting man ellers skal holde i hovedet.
   */
  renderHud(s) {
    const st = s.state;
    const box = this.dom.hud;
    if (!st.contract) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = '';

    const row = (label, value, cls = '') => {
      const r = el('div', `hud-row ${cls}`);
      r.appendChild(el('span', 'hud-label', label));
      const v = el('span', 'hud-value');
      if (value instanceof Node) v.appendChild(value); else v.textContent = value;
      r.appendChild(v);
      box.appendChild(r);
    };

    row('Stik', st.finished ? 'færdig' : `${st.trickNumber + 1} af 13`);

    if (st.contract.isSolo) {
      row('Trumf', 'ingen · es lavest');
      const taken = st.tricksWon[st.declarer] || 0;
      row('Mål', taken ? 'væltet' : 'ingen stik', taken ? 'is-bad' : '');
      box.appendChild(el('div', 'hud-note', `${this.nameOf(st.declarer)} må ikke tage et stik`));
      return;
    }

    if (st.trump) {
      const info = SUIT_BY_KEY[st.trump];
      const v = el('span', `hud-suit${info.color === 'red' ? ' red' : ''}`, `${info.symbol} ${info.name}`);
      row('Trumf', v);
    } else {
      row('Trumf', st.kittyRevealed || st.exchanged ? 'uden trumf' : 'vælges…');
    }

    // Spilførersiden set fra dig: kun stik fra spillere du VED er på siden.
    const side = [st.declarer];
    const iKnowSelf = st.selfPartnerTruth &&
      (st.selfPartnerKnown || (this.humanIndex === st.declarer && st.declarerSawKitty));
    let unknown = false;
    if (!iKnowSelf && st.partnerCard) {
      if ((st.partnerRevealed || st.partnerKnown) && st.partnerSeat !== null) side.push(st.partnerSeat);
      else if (this.humanIndex !== st.declarer && this.iHoldPartner(st)) side.push(this.humanIndex);
      else if (!st.selfPartner) unknown = true;
    }
    const won = [...new Set(side)].reduce((a, p) => a + (st.tricksWon[p] || 0), 0);
    const need = st.contract.tricks;
    row('Mål', `${won} af ${need} stik`, won >= need ? 'is-good' : '');
    const note = side.length > 1 ? `${this.nameOf(st.declarer)} + makker`
      : unknown ? `${this.nameOf(st.declarer)} – makker ukendt`
      : `${this.nameOf(st.declarer)} alene`;
    box.appendChild(el('div', 'hud-note', note));
  }

  renderTrick(st) {
    for (const slot of SEAT_SLOTS) {
      const node = this.dom.trickArea.querySelector(`.trick-slot[data-slot="${slot}"]`);
      if (node) node.innerHTML = '';
    }
    for (const play of st.trick) {
      const slot = this.slotOf[play.player];
      const node = this.dom.trickArea.querySelector(`.trick-slot[data-slot="${slot}"]`);
      if (node) node.appendChild(cardEl(play.card));
    }
  }

  /** Viser at en bot regner på sit valg. */
  setThinking(seat, on) {
    const n = seat == null ? null : this.seatNode(seat);
    if (!on) {
      this.players.forEach(p => this.seatNode(p.index)?.classList.remove('is-thinking'));
      return;
    }
    if (n) n.classList.add('is-thinking');
  }

  markTurn(seat) {
    for (const p of this.players) {
      const n = this.seatNode(p.index);
      if (n) n.classList.toggle('is-turn', p.index === seat);
    }
  }

  /** Fremhæver vinderkortet og samler stikket. */
  async collectTrick(winner) {
    const node = this.dom.trickArea;
    const slot = this.slotOf[winner];
    const winCard = node.querySelector(`.trick-slot[data-slot="${slot}"] .card`);
    if (winCard) winCard.classList.add('winner');
    await sleep(700);
    node.classList.add('collecting');
    await sleep(360);
    node.classList.remove('collecting');
    node.querySelectorAll('.trick-slot').forEach(s => (s.innerHTML = ''));
  }

  /** Vender ét kort i katten (Vip-trumf). */
  async flipKittyCard(index, card) {
    this.kittyOpen = true;
    const box = this.dom.kittyCards;
    const nodes = box.children;
    const fresh = cardEl(card, { small: true });
    fresh.classList.add('flip-in');
    if (nodes[index]) box.replaceChild(fresh, nodes[index]);
    else box.appendChild(fresh);
    await sleep(450);
  }

  /* =============================================================
     SCOREBOARD
     ============================================================= */
  buildScoreboard() {
    this.dom.scoreHead.innerHTML = '';
    this.dom.scoreHead.appendChild(el('th', '', 'Rnd'));
    for (const p of this.players) {
      this.dom.scoreHead.appendChild(el('th', p.index === this.humanIndex ? 'is-me' : '', p.name));
    }
    this.dom.scoreBody.innerHTML = '';
    this.dom.scoreTotal.innerHTML = '';
  }

  /** Viser hvor langt partiet er, og hvem der fører. */
  renderMatch(s) {
    if (!s.target) return;
    const pct = Math.round((s.progress || 0) * 100);
    this.dom.matchBar.style.width = `${pct}%`;

    const top = Math.max(...s.scores);
    const leaders = this.players.filter(p => s.scores[p.index] === top).map(p => p.name);
    const goal = s.target.mode === 'rounds'
      ? `Runde ${Math.min(s.roundsPlayed + 1, s.target.value)} af ${s.target.value}`
      : `Spil til ${s.target.value} point`;
    const lead = s.roundsPlayed
      ? ` · fører: ${leaders.join(' og ')} med ${fmtPlain(top)}`
      : '';
    this.dom.matchText.textContent = goal + lead;
  }

  renderScores(s) {
    // Historikrækker
    this.dom.scoreBody.innerHTML = '';
    for (const rec of s.history) {
      const tr = el('tr');
      const label = el('td', '', String(rec.round));
      const extra = rec.deals > 1 ? ` (${rec.deals} givninger)` : '';
      label.title = `${this.nameOf(rec.declarer)}: ${rec.contract.label} – ${rec.detail}${extra}`;
      tr.appendChild(label);
      rec.delta.forEach(d => {
        const td = el('td', d > 0 ? 'pos' : d < 0 ? 'neg' : '', d === 0 ? '–' : fmt(d));
        tr.appendChild(td);
      });
      this.dom.scoreBody.appendChild(tr);
    }
    // Totalrække
    this.dom.scoreTotal.innerHTML = '';
    this.dom.scoreTotal.appendChild(el('td', '', 'I alt'));
    s.scores.forEach(v => {
      this.dom.scoreTotal.appendChild(el('td', v > 0 ? 'pos' : v < 0 ? 'neg' : '', fmt(v)));
    });
  }

  nameOf(i) { return this.players[i]?.name ?? '?'; }

  /* =============================================================
     MODAL-MOTOR
     ============================================================= */
  /**
   * @param {boolean} peek  true når spilleren skal kunne se sin egen hånd
   *                        mens dialogen er åben (melding, trumf, makkeres).
   */
  openModal({ title, text = '', build = null, actions = [], peek = false }) {
    const d = this.dom;
    d.modalTitle.textContent = title;
    setSuitText(d.modalText, text);
    d.modalText.classList.toggle('hidden', !text);
    d.modalBody.innerHTML = '';
    d.modalActions.innerHTML = '';
    d.overlay.classList.remove('hidden');
    d.overlay.classList.toggle('peek', peek);
    document.body.classList.toggle('peeking', peek);

    return new Promise(resolve => {
      const done = value => {
        d.overlay.classList.add('hidden');
        d.overlay.classList.remove('peek');
        document.body.classList.remove('peeking');
        resolve(value);
      };
      if (build) build(d.modalBody, done);
      for (const a of actions) {
        const b = el('button', `btn ${a.cls || ''}`, a.label);
        b.type = 'button';
        if (a.disabled) b.disabled = true;
        b.addEventListener('click', () => done(a.value));
        d.modalActions.appendChild(b);
        if (a.ref) a.ref(b);
      }
    });
  }

  /* =============================================================
     SPØRGSMÅL TIL MENNESKET
     ============================================================= */

  /** Meldepanel. */
  askBid(seat, ctx) {
    const current = ctx.current;
    const allowed = new Set(legalBids(current).map(b => b.label));

    return this.openModal({
      title: 'Din melding',
      text: current
        ? `${this.nameOf(ctx.currentHolder)} har meldt ${current.label}. Du skal melde højere eller passe.`
        : 'Ingen har meldt endnu. Meldingen går tilbage – ikke rundt.',
      peek: true,
      build: (body, done) => {
        // Meldingerne indtil nu, så man ikke skal lede i loggen.
        const bids = ctx.snapshot?.state?.bids || [];
        if (bids.length) {
          const hist = el('div', 'bid-history');
          for (const { seat: s, bid } of bids) {
            const chip = el('span', 'bid-chip' + (bid.isPass ? ' is-pass' : ''));
            chip.appendChild(el('b', '', this.nameOf(s)));
            chip.appendChild(document.createTextNode(` ${bid.isPass ? 'pas' : bid.label}`));
            hist.appendChild(chip);
          }
          body.appendChild(hist);
        }

        const grid = el('div', 'bid-grid');
        grid.appendChild(el('div', 'bid-colhead', ''));
        for (const v of VARIANT_ORDER) grid.appendChild(el('div', 'bid-colhead', VARIANT_LABEL[v]));

        for (let t = 7; t <= 13; t++) {
          grid.appendChild(el('div', 'bid-rowhead', String(t)));
          for (const v of VARIANT_ORDER) {
            const bid = Bid.normal(t, v);
            // Kolonnen siger allerede hvilken type det er; på små skærme vises kun tallet.
            const btn = el('button', 'bid-btn');
            btn.appendChild(el('span', 'bid-n', String(t)));
            btn.appendChild(el('span', 'bid-v', ` ${VARIANT_SHORT[v]}`));
            btn.title = bid.label;
            btn.type = 'button';
            btn.disabled = !allowed.has(bid.label);
            btn.addEventListener('click', () => done(bid));
            grid.appendChild(btn);
          }
        }
        body.appendChild(grid);

        const specials = el('div', 'special-row');
        for (const key of Object.values(SPECIALS)) {
          const bid = Bid.special(key);
          const info = SPECIAL_INFO[key];
          const btn = el('button', 'bid-btn bid-special');
          btn.appendChild(el('span', '', info.label));
          btn.appendChild(el('small', '', `${info.points} p.`));
          btn.type = 'button';
          btn.disabled = !allowed.has(bid.label);
          btn.title = `Slås af ${info.beatenBy.tricks} ${VARIANT_LABEL[info.beatenBy.variant]}`;
          btn.addEventListener('click', () => done(bid));
          specials.appendChild(btn);
        }
        body.appendChild(specials);
      },
      actions: [{ label: 'Pas', value: Bid.pass(), cls: 'btn-danger' }]
    });
  }

  /** Valg af trumfkulør. */
  askTrump(seat, ctx) {
    return this.openModal({
      title: 'Vælg trumf',
      text: ctx.reason || 'Vælg trumfkulør.',
      peek: true,
      build: (body, done) => {
        const row = el('div', 'suit-picker');
        const hand = ctx.hand || [];
        for (const s of SUITS) {
          // Antallet på hånden er det man faktisk vælger efter.
          const count = hand.filter(c => !c.isJoker && c.suit === s.key).length;
          const b = el('button', 'suit-btn' + (s.color === 'red' ? ' red' : ''));
          b.appendChild(el('span', 'suit-sym', s.symbol));
          b.appendChild(el('span', 'suit-name', s.name));
          b.appendChild(el('span', 'suit-count', `${count} kort`));
          b.type = 'button';
          b.title = s.name;
          b.disabled = (ctx.forbidden || []).includes(s.key);
          b.addEventListener('click', () => done(s.key));
          row.appendChild(b);
        }
        body.appendChild(row);
      },
      actions: []
    });
  }

  /** Valg af makkeres (eller makkerkonge). */
  askPartner(seat, ctx) {
    const rank = ctx.candidates[0]?.rank ?? 'A';
    const what = (RANK_NAMES[rank] ?? rank).toLowerCase();
    return this.openModal({
      title: `Meld makker${what}`,
      text: ctx.toKing
        ? `Du har selv alle de kort du ellers kunne melde til, så du skal melde til en ${what} i stedet.`
        : 'Meld det es du vil have som makker. Du kan hverken melde trumfkuløren eller et es du selv har. Ligger kortet i katten, er du selvmakker.',
      peek: true,
      build: (body, done) => {
        const row = el('div', 'card-picker');
        for (const c of ctx.candidates) {
          const info = SUIT_BY_KEY[c.suit];
          const fake = {
            id: c.id, rank: c.rank, suit: c.suit, isJoker: false,
            symbol: info.symbol, color: info.color,
            isCourt: true, longLabel: `${RANK_NAMES[c.rank] ?? c.rank} i ${info.name}`
          };
          const n = cardEl(fake);
          n.addEventListener('click', () => done(c.id));
          row.appendChild(n);
        }
        body.appendChild(row);
      },
      actions: []
    });
  }

  /** Byttefasen: alt eller intet. */
  async askExchange(seat, ctx) {
    this.kittyOpen = true;
    const takeActions = ctx.mustSwap
      ? [{ label: 'Tag alle 3', value: true, cls: 'btn-primary' }]
      : [{ label: 'Tag alle 3', value: true, cls: 'btn-primary' },
         { label: 'Lad ligge',  value: false }];

    const take = await this.openModal({
      title: 'Byt med katten',
      text: ctx.mustSwap
        ? 'Der spilles Vip, så du SKAL bytte. Tag alle tre kort fra katten.'
        : 'Du kan tage alle tre kort fra katten – eller lade dem ligge. Det er alt eller intet.',
      build: (body, done) => {
        const zone = el('div', 'exchange-zone');
        zone.appendChild(el('div', 'zone-label', 'Katten'));
        const row = el('div', 'card-picker');
        ctx.kitty.forEach(c => row.appendChild(cardEl(c)));
        zone.appendChild(row);
        body.appendChild(zone);
      },
      actions: takeActions
    });

    if (!take) return { take: false, discardIds: [] };

    await this.animateSwapIn(ctx.kitty);

    const combined = sortHand(ctx.hand.concat(ctx.kitty));
    const fromKitty = new Set(ctx.kitty.map(c => c.id));
    const chosen = new Set();

    // Det man smider efter: trumfen og det es man har meldt til.
    const reminder = [];
    if (ctx.trump) reminder.push(`Trumf er ${SUIT_BY_KEY[ctx.trump].symbol} ${SUIT_BY_KEY[ctx.trump].name}`);
    else reminder.push('Der spilles uden trumf');
    if (ctx.partnerCard) reminder.push(`du har meldt til ${ctx.partnerCard.label}`);

    const discardIds = await this.openModal({
      title: 'Smid tre kort',
      text: `Du har nu 16 kort. ${reminder.join(', og ')}. Vælg de tre kort du vil smide.`,
      build: (body, done) => {
        const zone = el('div', 'exchange-zone');
        zone.appendChild(el('div', 'zone-label', 'Din hånd – klik tre kort at smide'));
        const row = el('div', 'card-picker');
        const counter = el('div', 'zone-label', 'Valgt: 0 / 3');

        for (const c of combined) {
          const n = cardEl(c);
          if (fromKitty.has(c.id)) {
            n.classList.add('from-kitty');
            n.appendChild(el('span', 'kitty-badge', 'kat'));
          }
          n.addEventListener('click', () => {
            if (chosen.has(c.id)) { chosen.delete(c.id); n.classList.remove('selected'); }
            else if (chosen.size < 3) { chosen.add(c.id); n.classList.add('selected'); }
            counter.textContent = `Valgt: ${chosen.size} / 3`;
            this._okBtn && (this._okBtn.disabled = chosen.size !== 3);
          });
          row.appendChild(n);
        }
        zone.appendChild(row);
        zone.appendChild(counter);
        body.appendChild(zone);
      },
      actions: [{
        label: 'Smid kortene', value: 'ok', cls: 'btn-primary', disabled: true,
        ref: b => { this._okBtn = b; }
      }]
    }).then(() => [...chosen]);

    await this.animateSwapOut();
    return { take: true, discardIds };
  }

  async animateSwapIn(kitty) {
    const box = this.dom.myHand;
    for (const c of kitty) {
      const n = cardEl(c);
      n.classList.add('swap-in');
      box.appendChild(n);
      await sleep(140);
    }
    await sleep(320);
  }

  async animateSwapOut() {
    this.dom.kittyCards.querySelectorAll('.card, .card-back')
      .forEach(n => n.classList.add('swap-out'));
    await sleep(420);
  }

  /** Vent på at spilleren klikker et kort på hånden. */
  askCard(seat, ctx) {
    return new Promise(resolve => {
      this.pendingCard = { legalIds: new Set(ctx.legal.map(c => c.id)), resolve };
      this.showTurnHint(this.turnHintFor(ctx));
      this.renderMyHand(ctx.snapshot);
    });
  }

  /** Én linje der siger hvad du skal - og hvorfor nogle kort er grå. */
  turnHintFor(ctx) {
    const st = ctx.snapshot.state;
    const trick = ctx.trick || st.trick;
    const legal = ctx.legal;
    const pc = st.partnerCard;
    if (!trick.length) {
      // Kun hvis reglen faktisk binder: du har andre kort i kuløren, men må ikke spille dem.
      const others = pc ? (ctx.hand || []).filter(c => !c.isJoker && c.suit === pc.suit && c.id !== pc.id) : [];
      const bound = pc && legal.some(c => c.id === pc.id) && others.length &&
        !others.some(o => legal.some(l => l.id === o.id));
      return bound
        ? `Din tur – spil ud. Vælger du ${SUIT_BY_KEY[pc.suit].name.toLowerCase()}, skal det være makkeresset`
        : 'Din tur – spil ud';
    }
    const led = trick[0].card;
    if (led.isJoker) return 'Din tur – jokeren er spillet ud, så du må lægge hvad du vil';
    const suit = SUIT_BY_KEY[led.suit].name.toLowerCase();
    if (legal.length === 1 && pc && legal[0].id === pc.id) return 'Din tur – makkeresset skal falde nu';
    const canFollow = legal.some(c => !c.isJoker && c.suit === led.suit);
    return canFollow
      ? `Din tur – bekend ${suit}`
      : `Din tur – du har ingen ${suit}, så du må trumfe eller smide`;
  }

  showTurnHint(text) {
    const h = this.dom.turnHint;
    h.textContent = text || '';
    h.classList.toggle('hidden', !text);
  }

  resolveCard(id) {
    const p = this.pendingCard;
    if (!p || !p.legalIds.has(id)) return;
    this.pendingCard = null;
    this.showTurnHint('');
    this.dom.myHand.classList.remove('is-waiting');
    this.dom.myHand.querySelectorAll('.card').forEach(n => {
      n.classList.remove('playable', 'blocked', 'selected');
    });
    p.resolve(id);
  }

  /* =============================================================
     RESULTAT OG REGLER
     ============================================================= */
  showRoundResult(record, snapshot) {
    // Forklar hvor pointene kommer fra: grundpoint, og om spilføreren var alene.
    const alone = record.partnerSeat === null;
    const why = alone
      ? `Grundpoint ${record.basePoints} – ganget med 3, fordi spilføreren var alene mod tre.`
      : `Grundpoint ${record.basePoints} til hver spiller.`;

    return this.openModal({
      title: `Runde ${record.round} – ${record.made ? 'spillet holdt' : 'spillet gik ned'}`,
      text: `${this.nameOf(record.declarer)} spillede ${record.contract.label}: ${record.detail}. ${why}`,
      build: (body) => {
        const t = el('table', 'result-table');
        const head = el('tr');
        ['Spiller', 'Rolle', 'Stik', 'Point', 'I alt'].forEach(h => head.appendChild(el('th', '', h)));
        t.appendChild(head);

        for (const p of this.players) {
          const tr = el('tr', p.index === this.humanIndex ? 'is-me' : '');
          let role = 'modspiller';
          if (p.index === record.declarer) {
            role = record.contract.isSolo ? 'spilfører (alene)'
              : record.partnerSeat === null ? 'spilfører (selvmakker)' : 'spilfører';
          }
          else if (p.index === record.partnerSeat) role = 'makker';

          tr.appendChild(el('td', '', p.name));
          tr.appendChild(el('td', '', role));
          tr.appendChild(el('td', '', String(record.tricksWon[p.index] ?? 0)));
          const d = record.delta[p.index];
          tr.appendChild(el('td', d > 0 ? 'pos' : d < 0 ? 'neg' : '', d === 0 ? '–' : fmt(d)));
          tr.appendChild(el('td', '', fmt(record.totals[p.index])));
          t.appendChild(tr);
        }
        body.appendChild(t);
      },
      actions: [{ label: 'Næste runde', value: true, cls: 'btn-primary' }]
    });
  }

  /** Slutskærm med endelig stilling. */
  showGameOver(s) {
    const top = Math.max(...s.scores);
    const winners = s.winners && s.winners.length ? s.winners : [];
    const names = winners.map(i => this.nameOf(i)).join(' og ');
    const how = s.target.mode === 'rounds'
      ? `Alle ${s.target.value} runder er spillet.`
      : `Målet på ${s.target.value} point er nået.`;

    return this.openModal({
      title: 'Partiet er slut',
      text: `${how} Der blev spillet ${s.roundsPlayed} ${s.roundsPlayed === 1 ? 'runde' : 'runder'}.`,
      build: (body) => {
        body.appendChild(el('div', 'winner-line',
          winners.length > 1 ? `${names} deler førstepladsen` : `${names} vinder`));

        const t = el('table', 'standings');
        const head = el('tr');
        ['Plads', 'Spiller', 'Point'].forEach(h => head.appendChild(el('th', '', h)));
        t.appendChild(head);

        const order = [...this.players].sort((a, b) => s.scores[b.index] - s.scores[a.index]);
        let place = 0, prev = null;
        order.forEach((p, i) => {
          const v = s.scores[p.index];
          if (v !== prev) { place = i + 1; prev = v; }
          const tr = el('tr', v === top ? 'is-winner' : '');
          tr.appendChild(el('td', '', String(place)));
          tr.appendChild(el('td', '', p.name));
          tr.appendChild(el('td', v > 0 ? 'pos' : v < 0 ? 'neg' : '', fmt(v)));
          t.appendChild(tr);
        });
        body.appendChild(t);
      },
      actions: [{ label: 'Nyt parti', value: true, cls: 'btn-primary' }]
    });
  }

  /**
   * Opslag i sit eget lag over spillets dialoger. Det rører ikke den dialog
   * spillet venter på, så man kan åbne reglerne midt i en melding.
   */
  openInfo({ title, build, closeLabel = 'Luk' }) {
    const d = this.dom;
    d.infoTitle.textContent = title;
    d.infoBody.innerHTML = '';
    d.infoActions.innerHTML = '';
    d.infoOverlay.classList.remove('hidden');
    return new Promise(resolve => {
      const close = () => {
        d.infoOverlay.classList.add('hidden');
        document.removeEventListener('keydown', onKey);
        resolve(true);
      };
      const onKey = e => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', onKey);
      // Klik uden for dialogen lukker også.
      d.infoOverlay.onclick = e => { if (e.target === d.infoOverlay) close(); };
      build(d.infoBody);
      const b = el('button', 'btn btn-primary', closeLabel);
      b.type = 'button';
      b.addEventListener('click', close);
      d.infoActions.appendChild(b);
      // Fokus på Luk, men start læsningen fra toppen.
      b.focus({ preventScroll: true });
      d.infoOverlay.querySelector('.modal').scrollTop = 0;
    });
  }

  showRules() {
    if (!this.dom.infoOverlay.classList.contains('hidden')) return Promise.resolve(true);
    return this.openInfo({
      title: 'Regler i korte træk',
      build: (body) => {
        const d = el('div', 'rules-body');
        d.innerHTML = `
          <h4>Kort og spillere</h4>
          <ul>
            <li>52 kort + 3 jokere. Der spilles med fire spillere.</li>
            <li>13 kort til hver spiller, 3 kort i katten. Maskinen blander, så der tages hverken af eller bankes.</li>
            <li>Esset er højest – dog LAVEST i Sol, Ren Sol, Bordlægger og Super Bordlægger.</li>
            <li>Jokeren er et sikkert stik når den spilles ud, men må ikke spilles ud i 1. runde.</li>
            <li>Jokeren må altid lægges i stedet for at bekende kulør. Lægges den i et stik en anden har spillet ud, kan den ikke vinde.</li>
            <li>Udspil i 1. stik foretages af personen efter giveren.</li>
          </ul>
          <h4>Melding – tilbage, ikke rundt</h4>
          <ul>
            <li>Der meldes 1 mod 1, indtil den ene passer. Vinderen melder videre mod den næste.</li>
            <li>Styrke: Almindelige &lt; Vip &lt; Gode &lt; Halve.</li>
            <li>Sol slås af 9 Vip · Ren Sol af 10 Vip · Bordlægger af 11 Vip · Super Bordlægger af 12 Vip.</li>
            <li>Passer alle, giver samme giver om. En omgivning tæller ikke som en ny runde.</li>
          </ul>
          <h4>Trumf, makkeres og bytte</h4>
          <ul>
            <li>Almindelige: frit trumfvalg. Gode: klør. Vip: katten vender trumfen ét kort ad gangen (joker satser på forrige kort, 3 jokere = uden trumf). Halve: den med makkeresset vælger trumf – ikke ressets egen kulør.</li>
            <li>Trumf og makkeres meldes FØR der byttes. Der byttes alt eller intet, og der SKAL byttes i Vip.</li>
            <li>Man må ikke melde trumfkuløren eller et es man selv har. Har man dem alle, meldes til en konge.</li>
            <li>Ligger makkeresset i katten, er spilføreren selvmakker. Det siges ikke højt – de andre opdager det først undervejs. Kun i Halve og Vip kan alle se det med det samme.</li>
            <li>Makkeresset skal falde første gang kuløren spilles – det må gerne trumfes. Spiller du selv kuløren ud, mens du har makkeresset, skal du spille esset.</li>
          </ul>
          <h4>Sol, Ren Sol, Bordlægger og Super Bordlægger</h4>
          <ul>
            <li>Spilføreren spiller alene mod de tre andre, uden trumf, uden makker og uden bytte. Esset er lavest.</li>
            <li>Spilføreren må ikke tage et eneste stik. Tager han ét, er spillet tabt med det samme.</li>
            <li>Kortene lægges op: Sol efter 2. stik, Ren Sol og Bordlægger efter 1. stik. I Super Bordlægger lægger alle op fra start, og modspillerne må snakke sammen.</li>
          </ul>
          <h4>Point</h4>
          <ul>
            <li>Sol 3 · Ren Sol 6 · Bordlægger 12 · Super Bordlægger 24.</li>
            <li>For 7-13 stik bruges den fulde tabel for Almindelige, Vip, Gode og Halve – både ved vundne og tabte stik.</li>
            <li>Regnskabet går i nul: er spilførersiden mindre end modspillersiden, ganges pointene tilsvarende op.</li>
          </ul>`;
        body.appendChild(d);
      }
    });
  }
}

function fmtPlain(n) { return String(Math.round(n * 100) / 100); }

function fmt(n) {
  const r = Math.round(n * 100) / 100;
  return (r > 0 ? '+' : '') + r;
}
