const apiBase = window.location.origin;
const sessionStatus = document.querySelector('#session-status');
const loginLink = document.querySelector('#login-link');
const logoutLink = document.querySelector('#logout-link');
const message = document.querySelector('#lobby-message');
const tableList = document.querySelector('#table-list');
const emptyTables = document.querySelector('#empty-tables');
const gameType = document.querySelector('#game-type');
const humanSeats = document.querySelector('#human-seats');
const botSeats = document.querySelector('#bot-seats');
const seatHelp = document.querySelector('#seat-help');
const createForm = document.querySelector('#create-table-form');
const refreshButton = document.querySelector('#refresh-tables');

if (location.hash.startsWith('#token=')) {
  history.replaceState(null, '', `${location.pathname}${location.search}`);
}

const gameNames = {
  'es-makker': 'Es Makker',
  kasino: 'Kasino',
};

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle('message--error', isError);
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(new URL(path, apiBase), {
      credentials: 'same-origin',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
    });
  } catch {
    throw new Error('Der kunne ikke oprettes forbindelse til lobbyen. Prøv igen.');
  }

  if (response.status === 204) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.message ?? 'Anmodningen kunne ikke gennemføres.');
  }
  return body;
}

function addOptions(select, values, selected) {
  select.replaceChildren(...values.map(value => {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = String(value);
    option.selected = value === selected;
    return option;
  }));
}

function updateSeatOptions() {
  const game = gameType.value;
  const humanValue = Number(humanSeats.value) || (game === 'es-makker' ? 4 : 2);
  const botValue = Number(botSeats.value) || 0;
  const maxPlayers = game === 'es-makker' ? 4 : 4;
  const humanOptions = Array.from({ length: 3 }, (_, index) => index + 2);
  addOptions(humanSeats, humanOptions, Math.min(humanValue, maxPlayers));

  const minTotal = game === 'es-makker' ? 4 : 2;
  const minBots = Math.max(0, minTotal - Number(humanSeats.value));
  const maxBots = maxPlayers - Number(humanSeats.value);
  const botOptions = Array.from({ length: maxBots - minBots + 1 }, (_, index) => minBots + index);
  const selectedBots = Math.min(Math.max(botValue, minBots), maxBots);
  addOptions(botSeats, botOptions, selectedBots);

  if (game === 'es-makker') {
    seatHelp.textContent = 'Es Makker har altid fire pladser i alt. Ledige menneskepladser kan andre anmode om.';
  } else {
    seatHelp.textContent = 'Kasino har 2-4 spillere i alt. Robotter udfylder de valgte resterende pladser.';
  }
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function makeButton(label, action, className = 'button button--small') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

async function showRequests(table, requestList) {
  requestList.replaceChildren();
  const list = await request(`/api/v1/tables/${table.id}/requests`);
  if (list.length === 0) {
    requestList.append(textElement('li', '', 'Ingen ventende anmodninger.'));
    return;
  }

  for (const seatRequest of list) {
    const row = document.createElement('li');
    row.className = 'request-row';
    const description = seatRequest.isVip ? 'VIP · pladsanmodning' : 'Pladsanmodning';
    row.append(textElement('span', '', description));
    const actions = document.createElement('span');
    actions.className = 'request-actions';
    for (const decision of ['accept', 'decline']) {
      const label = decision === 'accept' ? 'Godkend' : 'Afvis';
      actions.append(makeButton(label, async () => {
        try {
          await request(`/api/v1/seat-requests/${seatRequest.id}`, {
            method: 'PUT',
            body: JSON.stringify({ decision }),
          });
          setMessage(decision === 'accept' ? 'Pladsanmodningen blev godkendt.' : 'Pladsanmodningen blev afvist.');
          await loadTables();
        } catch (error) {
          setMessage(error.message, true);
        }
      }));
    }
    row.append(actions);
    requestList.append(row);
  }
}

function renderTable(table) {
  const item = document.createElement('li');
  item.className = 'table-card';
  const top = document.createElement('div');
  top.className = 'table-card__top';
  const heading = document.createElement('div');
  heading.append(
    textElement('h3', '', gameNames[table.gameType] ?? 'Kortspil'),
    textElement(
      'p',
      '',
      `${table.occupiedHumanSeatCount}/${table.humanSeatCount} menneskepladser · ${table.botSeatCount} robotter · ${table.status === 'waiting' ? 'venter' : table.status}`,
    ),
  );
  top.append(heading);
  if (table.isHost) top.append(textElement('span', 'eyebrow', 'Dit bord'));
  item.append(top);

  const actions = document.createElement('div');
  actions.className = 'table-card__actions';
  if (
    !table.isHost &&
    table.status === 'waiting' &&
    table.visibility === 'open' &&
    table.occupiedHumanSeatCount < table.humanSeatCount
  ) {
    actions.append(makeButton('Anmod om plads', async () => {
      try {
        await request(`/api/v1/tables/${table.id}/requests`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        setMessage('Din anmodning er sendt til bordets vært.');
        await loadTables();
      } catch (error) {
        setMessage(error.message, true);
      }
    }));
  }

  if (table.isHost && table.pendingRequestCount > 0) {
    actions.append(makeButton(`Pladsanmodninger (${table.pendingRequestCount})`, async () => {
      const requestList = item.querySelector('.request-list');
      try {
        await showRequests(table, requestList);
        requestList.hidden = false;
      } catch (error) {
        setMessage(error.message, true);
      }
    }, 'button button--secondary button--small'));
  }
  if (actions.childElementCount > 0) item.append(actions);

  const requestList = document.createElement('ul');
  requestList.className = 'request-list';
  requestList.hidden = true;
  item.append(requestList);
  return item;
}

async function loadTables() {
  refreshButton.disabled = true;
  try {
    const tables = await request('/api/v1/tables');
    tableList.replaceChildren(...tables.map(renderTable));
    emptyTables.hidden = tables.length > 0;
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    refreshButton.disabled = false;
  }
}

async function initialize() {
  updateSeatOptions();
  gameType.addEventListener('change', updateSeatOptions);
  humanSeats.addEventListener('change', updateSeatOptions);
  botSeats.addEventListener('change', updateSeatOptions);
  refreshButton.addEventListener('click', () => {
    setMessage('');
    void loadTables();
  });

  try {
    const session = await request('/api/v1/session');
    if (!session.identity) {
      sessionStatus.textContent = 'Du er ikke logget ind.';
      loginLink.hidden = false;
      createForm.hidden = true;
      refreshButton.disabled = true;
      emptyTables.hidden = true;
      return;
    }

    sessionStatus.textContent = 'Du er logget ind med Microsoft.';
    logoutLink.hidden = false;
    await loadTables();
  } catch (error) {
    sessionStatus.textContent = 'Din login-session kunne ikke kontrolleres.';
    setMessage(error.message, true);
    loginLink.hidden = false;
    createForm.hidden = true;
  }
}

createForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submitButton = createForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  setMessage('');
  try {
    const table = await request('/api/v1/tables', {
      method: 'POST',
      body: JSON.stringify({
        gameType: gameType.value,
        visibility: 'open',
        humanSeatCount: Number(humanSeats.value),
        botSeatCount: Number(botSeats.value),
      }),
    });
    setMessage(`${gameNames[table.gameType]}-bordet er oprettet.`);
    await loadTables();
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

void initialize();
