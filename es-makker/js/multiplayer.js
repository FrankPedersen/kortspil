const suits = {
  clubs: { label: 'Klør', symbol: '♣' },
  diamonds: { label: 'Ruder', symbol: '♦' },
  hearts: { label: 'Hjerter', symbol: '♥' },
  spades: { label: 'Spar', symbol: '♠' },
};
const variants = {
  alm: 'Almindelige',
  vip: 'Vip',
  gode: 'Gode',
  halve: 'Halve',
};
const specials = {
  sol: 'Sol',
  rensol: 'Ren Sol',
  bordlaegger: 'Bordlægger',
  superbordlaegger: 'Super Bordlægger',
};

let tableId;
let snapshot;
let errorMessage = '';
let loading = true;
let busy = false;
let selectedDiscards = [];

export function startMultiplayer(id) {
  tableId = id;
  document.body.innerHTML = `
    <main class="online-shell">
      <header class="online-header">
        <div>
          <a class="online-back" href="/lobby/">← Til lobbyen</a>
          <h1>Es Makker <span>online</span></h1>
        </div>
        <div id="online-turn" class="online-turn" aria-live="polite"></div>
      </header>
      <p id="online-error" class="online-error" role="alert"></p>
      <section id="online-summary" class="online-panel"></section>
      <section class="online-panel">
        <h2>Regnskab</h2>
        <div id="online-scores"></div>
      </section>
      <section class="online-panel">
        <h2>Bordet</h2>
        <div id="online-players" class="online-players"></div>
        <div id="online-kitty"></div>
        <div id="online-trick"></div>
        <div id="online-open-hands"></div>
      </section>
      <section class="online-panel">
        <h2>Din hånd</h2>
        <div id="online-hand" class="online-cards"></div>
      </section>
      <section class="online-panel">
        <h2>Din handling</h2>
        <div id="online-actions"></div>
      </section>
      <section class="online-panel">
        <h2>Bud i denne givning</h2>
        <div id="online-bids"></div>
      </section>
    </main>`;
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('../css/multiplayer.css', import.meta.url).href;
  document.head.append(stylesheet);
  void poll();
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error('Der kunne ikke oprettes forbindelse. Kontrollér din forbindelse, og prøv igen.');
  }
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message ?? 'Anmodningen kunne ikke gennemføres.');
  return body;
}

async function poll() {
  try {
    const next = await request(`/api/v1/tables/${encodeURIComponent(tableId)}/state`);
    errorMessage = '';
    if (!snapshot || snapshot.version !== next.version) {
      snapshot = next;
      selectedDiscards = [];
      render();
    }
  } catch (error) {
    errorMessage = error.message;
    render();
  } finally {
    loading = false;
    render();
    window.setTimeout(poll, 2500);
  }
}

async function act(action) {
  if (!snapshot || busy) return;
  busy = true;
  render();
  try {
    snapshot = await request(`/api/v1/tables/${encodeURIComponent(tableId)}/es-makker-actions`, {
      method: 'POST',
      body: JSON.stringify({ expectedVersion: snapshot.version, action }),
    });
    selectedDiscards = [];
    errorMessage = '';
  } catch (error) {
    errorMessage = error.message;
    try {
      snapshot = await request(`/api/v1/tables/${encodeURIComponent(tableId)}/state`);
      selectedDiscards = [];
    } catch (refreshError) {
      errorMessage = refreshError.message;
    }
  } finally {
    busy = false;
    render();
  }
}

function render() {
  const error = document.querySelector('#online-error');
  const summary = document.querySelector('#online-summary');
  if (!snapshot) {
    document.querySelector('#online-turn').textContent = loading ? 'Indlæser spillet…' : 'Kræver login eller forbindelse';
    error.textContent = errorMessage || (loading ? 'Henter spillet…' : 'Spillet kunne ikke indlæses.');
    if (!loading) {
      const login = document.createElement('a');
      login.className = 'online-button';
      login.href = `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(location.pathname + location.search)}`;
      login.textContent = 'Log ind med Microsoft';
      error.append(document.createElement('br'), login);
    }
    return;
  }

  error.textContent = errorMessage;
  const myTurn = snapshot.turnSeat === snapshot.mySeat && snapshot.phase !== 'finished';
  const current = playerLabel(snapshot.turnSeat);
  document.querySelector('#online-turn').textContent = snapshot.phase === 'finished'
    ? `Spillet er slut · ${snapshot.winners.map(playerLabel).join(' og ')} vinder`
    : myTurn ? 'Det er din tur' : `Venter på ${current}`;
  const summaryItems = [
    text(`Runde ${snapshot.roundNumber}${snapshot.dealNumber > 1 ? ` · ${snapshot.dealNumber}. givning` : ''}`, 'online-eyebrow'),
    text(`Giver: ${playerLabel(snapshot.dealerSeat)} · ${phaseLabel(snapshot.phase)}`, ''),
    snapshot.contract ? text(`Kontrakt: ${bidLabel(snapshot.contract)}${snapshot.trump ? ` · Trumf: ${suits[snapshot.trump].label}` : ' · uden trumf'}`, '') : null,
    snapshot.partnerCard ? text(`Makkerkort: ${cardLabel(snapshot.partnerCard)}${snapshot.partnerSeat === null ? '' : ` · ${playerLabel(snapshot.partnerSeat)} er makker`}`, '') : null,
    lastResult(snapshot),
  ].filter(item => item !== null);
  summary.replaceChildren(...summaryItems);
  renderScores();
  renderPlayers();
  renderKitty();
  renderTrick();
  renderOpenHands();
  renderHand(myTurn);
  renderActions(myTurn);
  renderBids();
}

function renderScores() {
  const root = document.querySelector('#online-scores');
  const table = document.createElement('table');
  table.className = 'online-score-table';
  const head = document.createElement('tr');
  head.append(text('Spiller', ''));
  for (let seat = 0; seat < 4; seat += 1) head.append(text(playerLabel(seat), ''));
  const row = document.createElement('tr');
  row.append(text('Point', ''));
  for (let seat = 0; seat < 4; seat += 1) row.append(text(String(snapshot.scores[String(seat)] ?? 0), ''));
  table.append(head, row);
  root.replaceChildren(table);
}

function renderPlayers() {
  const root = document.querySelector('#online-players');
  root.replaceChildren(...snapshot.players.map(player => {
    const item = text(
      `${playerLabel(player.seatNumber)} · ${player.handCount} kort${snapshot.tricksWon[String(player.seatNumber)] ? ` · ${snapshot.tricksWon[String(player.seatNumber)]} stik` : ''}`,
      `online-player${snapshot.turnSeat === player.seatNumber && snapshot.phase !== 'finished' ? ' online-player--turn' : ''}`,
    );
    if (player.seatNumber === snapshot.dealerSeat) item.append(text('Giver', 'online-tag'));
    if (player.seatNumber === snapshot.declarerSeat) item.append(text('Spilfører', 'online-tag'));
    return item;
  }));
}

function renderKitty() {
  const root = document.querySelector('#online-kitty');
  root.replaceChildren();
  if (snapshot.kitty.length) {
    root.append(text('Katten · vælg tre kort at smide', 'online-label'));
    const cards = document.createElement('div');
    cards.className = 'online-cards';
    const combined = [...snapshot.hand, ...snapshot.kitty];
    for (const card of combined) {
      const selected = selectedDiscards.includes(card.id);
      cards.append(cardButton(card, selected, () => {
        if (selected) selectedDiscards = selectedDiscards.filter(id => id !== card.id);
        else if (selectedDiscards.length < 3) selectedDiscards = [...selectedDiscards, card.id];
        render();
      }, busy));
    }
    root.append(cards);
  } else if (snapshot.shownKitty.length) {
    root.append(
      text('Den åbne Vip-kat', 'online-label'),
      text(snapshot.shownKitty.map(cardLabel).join(' · '), ''),
    );
  }
}

function renderTrick() {
  const root = document.querySelector('#online-trick');
  const cards = snapshot.trick.length ? snapshot.trick : snapshot.lastTrick;
  const title = snapshot.trick.length
    ? `Stik ${snapshot.trickNumber + 1}`
    : snapshot.lastTrickWinner === null
      ? 'Første stik'
      : `Sidste stik · ${playerLabel(snapshot.lastTrickWinner)} tog det`;
  root.replaceChildren(text(title, 'online-label'));
  const list = document.createElement('div');
  list.className = 'online-trick';
  for (const play of cards) list.append(text(`${playerLabel(play.seatNumber)}: ${cardLabel(play.card)}`, 'online-trick-card'));
  root.append(list);
}

function renderOpenHands() {
  const root = document.querySelector('#online-open-hands');
  const entries = Object.entries(snapshot.openHands);
  root.replaceChildren();
  if (entries.length === 0) return;
  root.append(text('Åbne hænder', 'online-label'));
  for (const [seat, cards] of entries) {
    root.append(text(`${playerLabel(Number(seat))}: ${cards.map(cardLabel).join(' · ')}`, 'online-open-hand'));
  }
}

function renderHand(myTurn) {
  const root = document.querySelector('#online-hand');
  const legal = new Set(snapshot.legalCardIds);
  root.replaceChildren(...snapshot.hand.map(card => cardButton(
    card,
    false,
    () => act({ type: 'play-card', cardId: card.id }),
    busy || snapshot.phase !== 'playing' || !myTurn || !legal.has(card.id),
  )));
}

function renderActions(myTurn) {
  const root = document.querySelector('#online-actions');
  root.replaceChildren();
  if (snapshot.phase === 'finished') {
    root.append(text('Partiet er færdigt. Du kan se resultatet og gå tilbage til lobbyen.', ''));
    return;
  }
  if (!myTurn) {
    root.append(text(`Venter på ${playerLabel(snapshot.turnSeat)}.`, ''));
    return;
  }
  if (snapshot.phase === 'bidding') {
    root.append(makeButton('Pas', () => act({ type: 'pass' }), busy));
    const bids = document.createElement('div');
    bids.className = 'online-bid-grid';
    for (const bid of snapshot.legalBids) {
      bids.append(makeButton(bidLabel(bid), () => act({ type: 'bid', bid }), busy));
    }
    root.append(bids);
  } else if (snapshot.phase === 'trump') {
    const forbidden = snapshot.contract?.kind === 'normal' && snapshot.contract.variant === 'halve'
      ? snapshot.partnerCard?.suit
      : null;
    for (const [suit, info] of Object.entries(suits)) {
      const button = makeButton(`${info.label} ${info.symbol}`, () => act({ type: 'choose-trump', suit }), busy);
      button.disabled ||= suit === forbidden;
      root.append(button);
    }
  } else if (snapshot.phase === 'partner') {
    root.append(text('Vælg makkerkortet:', 'online-label'));
    for (const card of snapshot.partnerCandidates) {
      root.append(makeButton(
        cardLabel({ ...card, isJoker: false, jokerNo: -1 }),
        () => act({ type: 'choose-partner', cardId: card.cardId }),
        busy,
      ));
    }
  } else if (snapshot.phase === 'exchange') {
    const mustExchange = snapshot.contract?.kind === 'normal' && snapshot.contract.variant === 'vip';
    root.append(makeButton(
      `Byt de ${selectedDiscards.length} valgte kort`,
      () => act({ type: 'exchange', take: true, discardIds: selectedDiscards }),
      busy || selectedDiscards.length !== 3,
    ));
    if (!mustExchange) root.append(makeButton('Spil uden at bytte', () => act({ type: 'exchange', take: false }), busy));
    root.append(text(mustExchange ? 'I Vip skal der byttes tre kort.' : 'Byttet er frivilligt. Vælg tre kort, eller fortsæt uden at bytte.', ''));
  } else {
    root.append(text('Vælg et lovligt kort i din hånd.', ''));
  }
  if (busy) root.append(text('Gemmer handling…', 'online-dim'));
}

function renderBids() {
  const root = document.querySelector('#online-bids');
  if (snapshot.bids.length === 0) {
    root.textContent = 'Ingen bud endnu.';
    return;
  }
  root.replaceChildren(...snapshot.bids.map(item =>
    text(`${playerLabel(item.seatNumber)}: ${item.kind === 'pass' ? 'Pas' : bidLabel(item.bid)}`, 'online-bid-chip'),
  ));
}

function lastResult(game) {
  const result = game.roundResults.at(-1);
  if (!result) return null;
  return text(
    `Seneste runde: ${bidLabel(result.contract)} · ${result.detail} · ${result.made ? 'holdt' : 'gik ned'} · point ${Object.values(result.delta).join(' / ')}`,
    'online-result',
  );
}

function cardButton(card, selected, onClick, disabled) {
  const button = document.createElement('button');
  const red = card.suit === 'hearts' || card.suit === 'diamonds';
  button.type = 'button';
  button.className = `online-card${red ? ' online-card--red' : ''}${selected ? ' online-card--selected' : ''}${card.isJoker ? ' online-card--joker' : ''}`;
  button.disabled = disabled;
  button.textContent = card.isJoker ? `Joker ${card.jokerNo + 1}` : cardLabel(card);
  button.addEventListener('click', onClick);
  return button;
}

function makeButton(label, action, disabled) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'online-button';
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener('click', action);
  return button;
}

function text(value, className) {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = value;
  return element;
}

function cardLabel(card) {
  if (card.isJoker) return `Joker ${card.jokerNo + 1}`;
  return `${card.rank ?? ''}${suits[card.suit]?.symbol ?? ''}`;
}

function bidLabel(bid) {
  if (!bid) return 'Bud';
  return bid.kind === 'special' ? specials[bid.special] : `${bid.tricks} ${variants[bid.variant]}`;
}

function phaseLabel(phase) {
  return ({
    bidding: 'budgivning',
    trump: 'trumfvalg',
    partner: 'makkerkort',
    exchange: 'byttefase',
    playing: 'stikspil',
    finished: 'færdig',
  })[phase] ?? phase;
}

function playerLabel(seat) {
  return `Spiller ${seat + 1}`;
}
