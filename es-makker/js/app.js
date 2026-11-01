/* =============================================================
   app.js
   Entry point: bygger spillet, kobler UI og AI på spilmotoren
   og starter runderne.
   ============================================================= */

import { Game, PLAYER_COUNT, TARGET_LIMITS } from './game.js';
import { UI } from './ui.js';
import { createBot } from './ai.js';
import { createMcBot } from './mc.js';

const HUMAN_SEAT = 0;               // mennesket sidder altid på plads 0
const PACE = 620;                   // grundtempo for botternes handlinger (ms)

const ui = new UI();
let game = null;
let bots = {};
let level = 'mc';

const wait = ms => new Promise(r => setTimeout(r, ms));
const isHuman = seat => seat === HUMAN_SEAT;

/**
 * Lader botten regne, mens sædet markeres. Tænketiden tælles med i pausen,
 * så en langsom Monte Carlo-beregning ikke føles som ekstra ventetid.
 */
async function think(seat, minMs, work) {
  ui.setThinking(seat, true);
  const t0 = performance.now();
  try {
    const result = await work();
    const rest = minMs - (performance.now() - t0);
    if (rest > 0) await wait(rest);
    return result;
  } finally {
    ui.setThinking(seat, false);
  }
}

/* -------------------------------------------------------------
   OPSTART
   ------------------------------------------------------------- */
document.getElementById('btn-rules').addEventListener('click', () => ui.showRules());
document.getElementById('btn-new-game').addEventListener('click', () => location.reload());
document.getElementById('btn-start').addEventListener('click', onStart);

/* Skifter enhed og fornuftige grænser når man vælger point eller runder. */
const targetInput = document.getElementById('input-target');
const targetUnit  = document.getElementById('target-unit');
const targetHint  = document.getElementById('target-hint');

/**
 * Regnskabet er nulsum, så pointene bevæger sig som en tilfældig gang omkring
 * nul. Antallet af runder vokser derfor med KVADRATET på pointmålet. Konstanten
 * er målt på 15 simulerede partier pr. niveau: et mål på 25 tager typisk omkring
 * 15 runder, mens 100 point løber op i over 200.
 *
 * Skal stå FØR det første kald til updateTargetHint() nedenfor - en const
 * kan ikke bruges før den er defineret, og så gik resten af modulet i stå.
 */
const SWING_PER_ROUND = 6.7;
const estimateRounds = points => Math.max(3, Math.round((points / SWING_PER_ROUND) ** 2));

for (const radio of document.querySelectorAll('input[name="lenmode"]')) {
  radio.addEventListener('change', () => syncTargetField(radio.value));
}
targetInput.addEventListener('input', updateTargetHint);
updateTargetHint();

function updateTargetHint() {
  const mode = document.querySelector('input[name="lenmode"]:checked').value;
  const value = Number(targetInput.value);
  if (mode === 'rounds') {
    targetHint.textContent = 'Der spilles præcis så mange runder, og flest point vinder.';
    return;
  }
  if (!Number.isFinite(value) || value < TARGET_LIMITS.points.min) {
    targetHint.textContent = 'Partiet stopper når en spiller når målet.';
    return;
  }
  targetHint.textContent =
    `Partiet stopper når en spiller når målet – typisk omkring ${estimateRounds(value)} runder, men det svinger meget.`;
}

function syncTargetField(mode) {
  const lim = TARGET_LIMITS[mode];
  targetInput.min = lim.min;
  targetInput.max = lim.max;
  targetInput.step = lim.step;
  targetInput.value = mode === 'rounds' ? 12 : 25;
  targetUnit.textContent = mode === 'rounds' ? 'runder' : 'point';
  updateTargetHint();
}

function onStart() {
  const name = (document.getElementById('input-name').value || 'Dig').trim();
  const host = Number(document.querySelector('input[name="host"]:checked').value);
  const mode = document.querySelector('input[name="lenmode"]:checked').value;
  const value = Number(targetInput.value);
  level = document.querySelector('input[name="level"]:checked').value;
  document.getElementById('setup').classList.add('hidden');
  boot({ name, hostIndex: host, target: { mode, value } });
}

/* -------------------------------------------------------------
   BYG SPILLET
   ------------------------------------------------------------- */
function boot({ name, hostIndex, target }) {
  const players = [{ name, isHuman: true }];
  for (let i = 1; i < PLAYER_COUNT; i++) players.push({ name: `Bot ${i}`, isHuman: false });

  bots = {};
  const makeBot = level === 'mc' ? createMcBot : createBot;
  players.forEach((p, i) => { if (!p.isHuman) bots[i] = makeBot(i); });

  game = new Game({ players, hostIndex, io: buildIO(), pace: PACE, target });
  ui.setPlayers(game.players, HUMAN_SEAT);
  wireEvents(game, ui);

  ui.log({ text: `Spillet starter. ${game.players[hostIndex].name} er vært og fører regnskabet.`, cls: 'hl' });
  ui.log({ text: level === 'mc'
    ? 'Modstandere: Monte Carlo – de simulerer runden før hver melding og hvert kort.'
    : 'Modstandere: håndlavet vurdering af hånden.', cls: 'dim' });
  ui.log({ text: `${game.players[game.dealerIndex].name} giver først.`, cls: 'dim' });
  ui.log({ text: game.target.mode === 'rounds'
    ? `Partiet går over ${game.target.value} runder.`
    : `Der spilles til ${game.target.value} point.`, cls: 'dim' });

  game.start().catch(err => {
    console.error(err);
    ui.log({ text: `Fejl: ${err.message}`, cls: 'hl' });
  });
}

/* -------------------------------------------------------------
   IO: menneske via UI, bots via ai.js
   ------------------------------------------------------------- */
function buildIO() {
  return {
    async askBid(seat, ctx) {
      if (isHuman(seat)) return ui.askBid(seat, ctx);
      return think(seat, PACE * 0.8, () => bots[seat].bid(ctx.hand, ctx));
    },

    async askTrump(seat, ctx) {
      if (isHuman(seat)) return ui.askTrump(seat, ctx);
      await wait(PACE * 0.7);
      return bots[seat].trump(ctx.hand, ctx);
    },

    async askPartner(seat, ctx) {
      if (isHuman(seat)) return ui.askPartner(seat, ctx);
      await wait(PACE * 0.7);
      return bots[seat].partner(ctx.hand, ctx);
    },

    async askExchange(seat, ctx) {
      if (isHuman(seat)) return ui.askExchange(seat, ctx);
      await wait(PACE * 0.9);
      return bots[seat].exchange(ctx.hand, ctx.kitty, ctx);
    },

    async askCard(seat, ctx) {
      if (isHuman(seat)) return ui.askCard(seat, ctx);
      return think(seat, PACE * 0.55, () => bots[seat].card(ctx));
    },

    /** Spilmotoren venter på at stikket er samlet op visuelt. */
    async afterTrick(winner) {
      await ui.collectTrick(winner);
    },

    /** Vises mellem runderne. Returner false for at stoppe spillet. */
    async askContinue(snapshot) {
      const rec = snapshot.history[snapshot.history.length - 1];
      if (rec) await ui.showRoundResult(rec, snapshot);
      return true;
    },

    /** Slutskærmen når pointmålet eller rundetallet er nået. */
    async showResult(snapshot) {
      const rec = snapshot.history[snapshot.history.length - 1];
      if (rec) await ui.showRoundResult(rec, snapshot);
      const again = await ui.showGameOver(snapshot);
      if (again) location.reload();
    }
  };
}

/* -------------------------------------------------------------
   HÆNDELSER FRA SPILMOTOREN
   ------------------------------------------------------------- */
function wireEvents(game, ui) {
  game.on('log', e => ui.log(e));

  game.on('dealt', snap => {
    ui.kittyOpen = false;
    ui.markTurn(null);
    ui.render(snap);
    ui.toast(
      `Runde ${snap.roundNo}${snap.dealNo > 1 ? `, ${snap.dealNo}. givning` : ''} · ${ui.nameOf(snap.dealer)} giver`,
      1200);
  });

  game.on('redeal', snap => ui.toast(
    `Alle passede – ${ui.nameOf(snap.dealer)} giver om`, 1400));

  game.on('biddingStart', snap => ui.render(snap));

  game.on('turn', ({ seat }) => ui.markTurn(seat));

  game.on('bid', ({ seat, bid, snapshot }) => {
    ui.render(snapshot);
    if (!bid.isPass) ui.toast(`${ui.nameOf(seat)}: ${bid.label}`, 900);
  });

  game.on('contract', snap => {
    ui.render(snap);
    const st = snap.state;
    ui.toast(`${ui.nameOf(st.declarer)} spiller ${st.contract.label}`, 1500);
  });

  game.on('kittyFlip', async ({ index, card, snapshot }) => {
    await ui.flipKittyCard(index, card);
    ui.render(snapshot);
  });

  game.on('partnerChosen', snap => ui.render(snap));
  // Afkastet er spilførerens hemmelighed: kun mennesket ser sine egne smidte kort.
  game.on('exchange', ({ seat, snapshot }) => { ui.kittyOpen = isHuman(seat); ui.render(snapshot); });
  game.on('contractReady', snap => ui.render(snap));
  game.on('reveal', snap => ui.render(snap));

  game.on('playStart', snap => {
    ui.render(snap);
    ui.toast('Spillet går i gang', 900);
  });

  game.on('trickStart', ({ snapshot }) => ui.render(snapshot));

  game.on('cardPlayed', ({ snapshot }) => ui.render(snapshot));

  game.on('partnerRevealed', ({ seat, self }) =>
    ui.toast(`${ui.nameOf(seat)} er ${self ? 'selvmakker' : 'makker'}!`, 1300));

  game.on('trickEnd', ({ winner, snapshot }) => {
    ui.render(snapshot);
    ui.markTurn(winner);
  });

  game.on('playEnd', snap => {
    ui.markTurn(null);
    ui.render(snap);
  });

  game.on('roundScored', ({ snapshot }) => ui.render(snapshot));

  game.on('gameOver', snap => {
    ui.markTurn(null);
    ui.render(snap);
  });
}
