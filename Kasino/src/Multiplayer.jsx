import { useEffect, useMemo, useRef, useState } from 'react';
import './multiplayer.css';

const API = '/api/v1';

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

function cardLabel(card) {
  return `${card.displayName}${card.symbol}`;
}

function Card({ card, selected, onClick, small = false, disabled = false }) {
  const red = card.suit === 'HEARTS' || card.suit === 'DIAMONDS';
  return (
    <button
      type="button"
      className={`online-card${red ? ' online-card--red' : ''}${selected ? ' online-card--selected' : ''}${small ? ' online-card--small' : ''}`}
      onClick={onClick}
      aria-pressed={selected}
      disabled={disabled}
    >
      <span>{card.displayName}</span>
      <strong>{card.symbol}</strong>
      {card.isSweeper && <small>RYD</small>}
    </button>
  );
}

function BoardItem({ item, selected, onClick, disabled }) {
  if (!item.isBuild) return <Card card={item} selected={selected} onClick={onClick} disabled={disabled} />;
  return (
    <button
      type="button"
      className={`online-build${selected ? ' online-build--selected' : ''}`}
      onClick={onClick}
      aria-pressed={selected}
      disabled={disabled}
    >
      <strong>{item.groups > 1 ? `${item.groups} grupper` : 'Byggeri'} · {item.value}</strong>
      <span>{(item.cards ?? []).map(cardLabel).join(' + ')}</span>
    </button>
  );
}

function optionLabel(option) {
  if (option.type === 'SPAR_FEM') return 'Svab bordet';
  if (option.type === 'SMID_UD') return 'Læg kortet';
  if (option.type === 'STIK') return 'Tag stik';
  return option.type === 'BYG_ENKELT'
    ? `Byggeri · værdi ${option.buildValue}`
    : `Byg ${option.groupCount} grupper · værdi ${option.buildValue}`;
}

export default function Multiplayer({ tableId }) {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedHandCard, setSelectedHandCard] = useState(null);
  const [selectedBoardIds, setSelectedBoardIds] = useState([]);
  const [options, setOptions] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer;
    const poll = async () => {
      if (!cancelled && !busyRef.current) {
        try {
          const next = await request(`${API}/tables/${encodeURIComponent(tableId)}/state`);
          if (!cancelled) {
            setSnapshot(next);
            setError('');
          }
        } catch (requestError) {
          if (!cancelled) setError(requestError.message);
        } finally {
          if (!cancelled) setLoading(false);
        }
      }
      if (!cancelled) timer = window.setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tableId]);

  useEffect(() => {
    setSelectedHandCard(null);
    setSelectedBoardIds([]);
    setOptions([]);
  }, [snapshot?.version]);

  useEffect(() => {
    let cancelled = false;
    if (
      !snapshot ||
      snapshot.gameType !== 'kasino' ||
      snapshot.turnSeat !== snapshot.mySeat ||
      !selectedHandCard
    ) {
      setOptions([]);
      return () => { cancelled = true; };
    }

    void request(`${API}/tables/${encodeURIComponent(tableId)}/move-options`, {
      method: 'POST',
      body: JSON.stringify({
        handCardId: selectedHandCard,
        targetItemIds: selectedBoardIds,
      }),
    }).then(result => {
      if (!cancelled) {
        setOptions(result);
        setError('');
      }
    }).catch(requestError => {
      if (!cancelled) {
        setOptions([]);
        setError(requestError.message);
      }
    });
    return () => { cancelled = true; };
  }, [
    snapshot?.version,
    snapshot?.gameType,
    snapshot?.turnSeat,
    snapshot?.mySeat,
    selectedHandCard,
    selectedBoardIds,
    tableId,
  ]);

  const standings = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.players].sort(
      (left, right) => (snapshot.scores[String(right.seatNumber)] ?? 0) -
        (snapshot.scores[String(left.seatNumber)] ?? 0),
    );
  }, [snapshot]);

  const play = async option => {
    if (!snapshot || submitting) return;
    setSubmitting(true);
    busyRef.current = true;
    try {
      const next = await request(`${API}/tables/${encodeURIComponent(tableId)}/turns`, {
        method: 'POST',
        body: JSON.stringify({
          expectedVersion: snapshot.version,
          action: {
            ...option,
            handCardId: selectedHandCard,
            targetItemIds: selectedBoardIds,
          },
        }),
      });
      setSnapshot(next);
      setError('');
    } catch (requestError) {
      setError(requestError.message);
      try {
        setSnapshot(await request(`${API}/tables/${encodeURIComponent(tableId)}/state`));
      } catch (refreshError) {
        setError(refreshError.message);
      }
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  };

  const toggleBoardItem = itemId => {
    setOptions([]);
    setSelectedBoardIds(current => current.includes(itemId)
      ? current.filter(id => id !== itemId)
      : [...current, itemId]);
  };

  if (loading && !snapshot) {
    return <main className="online-shell"><p className="online-message">Henter spillet…</p></main>;
  }

  if (!snapshot) {
    const loginUrl = `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(location.pathname + location.search)}`;
    return (
      <main className="online-shell">
        <a className="online-back" href="/lobby/">← Til lobbyen</a>
        <h1>Kasino online</h1>
        <p className="online-message" role="alert">{error || 'Spillet kunne ikke indlæses.'}</p>
        <a className="online-button" href={loginUrl}>Log ind med Microsoft</a>
      </main>
    );
  }

  if (snapshot.gameType !== 'kasino') {
    return (
      <main className="online-shell">
        <a className="online-back" href="/lobby/">← Til lobbyen</a>
        <h1>Spillet er ikke tilsluttet endnu</h1>
        <p className="online-message">Online Es Makker er endnu ikke klar.</p>
      </main>
    );
  }

  const isMyTurn = snapshot.turnSeat === snapshot.mySeat && snapshot.winner === null;
  const currentPlayer = snapshot.players.find(player => player.seatNumber === snapshot.turnSeat);
  const winner = snapshot.players.find(player => player.seatNumber === snapshot.winner);

  return (
    <main className="online-shell">
      <header className="online-header">
        <div>
          <a className="online-back" href="/lobby/">← Til lobbyen</a>
          <h1>Kasino <span>online</span></h1>
        </div>
        <div className="online-turn" aria-live="polite">
          {winner
            ? `Spiller ${winner.seatNumber + 1} har vundet`
            : isMyTurn ? 'Det er din tur' : `Venter på spiller ${(currentPlayer?.seatNumber ?? 0) + 1}`}
        </div>
      </header>

      {error && <p className="online-message online-message--error" role="alert">{error}</p>}

      <section className="online-scoreboard" aria-label="Stilling">
        {standings.map(player => (
          <div
            className={`online-player${player.seatNumber === snapshot.turnSeat ? ' online-player--turn' : ''}`}
            key={player.seatNumber}
          >
            <strong>{player.seatNumber === snapshot.mySeat ? 'Dig' : `Spiller ${player.seatNumber + 1}`}</strong>
            <span>{snapshot.scores[String(player.seatNumber)] ?? 0} point</span>
            <small>{player.handCount} kort</small>
          </div>
        ))}
        <div className="online-round">Runde {snapshot.roundNumber}</div>
      </section>

      <section className="online-table" aria-label="Spillebord">
        <h2>Bordet</h2>
        {snapshot.board.length === 0
          ? <p className="online-empty">Bordet er tomt</p>
          : <div className="online-board">
              {snapshot.board.map(item => (
                <BoardItem
                  key={item.id}
                  item={item}
                  selected={selectedBoardIds.includes(item.id)}
                  disabled={!isMyTurn || !selectedHandCard || submitting}
                  onClick={() => {
                    if (isMyTurn && selectedHandCard) toggleBoardItem(item.id);
                  }}
                />
              ))}
            </div>}
      </section>

      {winner ? (
        <section className="online-finished" aria-live="polite">
          Spillet er afsluttet. Du kan se resultatet her eller vende tilbage til lobbyen.
        </section>
      ) : (
        <>
          <section className="online-hand">
            <h2>Din hånd</h2>
            <div className="online-cards">
              {snapshot.hand.map(card => (
                <Card
                  key={card.id}
                  card={card}
                  selected={selectedHandCard === card.id}
                  disabled={!isMyTurn || submitting}
                  onClick={() => {
                    if (isMyTurn && !submitting) {
                      setOptions([]);
                      setSelectedBoardIds([]);
                      setSelectedHandCard(current => current === card.id ? null : card.id);
                    }
                  }}
                />
              ))}
            </div>
          </section>
          <section className="online-actions" aria-live="polite">
            <p>
              {!isMyTurn
                ? 'Vent på, at de andre spillere spiller.'
                : !selectedHandCard
                  ? 'Vælg et kort fra din hånd.'
                  : selectedBoardIds.length
                    ? 'Vælg en handling for de markerede bordkort.'
                    : 'Vælg en handling, eller markér først kort på bordet.'}
            </p>
            <div className="online-action-buttons">
              {options.map((option, index) => (
                <button
                  className="online-button"
                  type="button"
                  key={`${option.type}-${option.buildValue ?? ''}-${option.groupCount ?? ''}-${index}`}
                  disabled={submitting}
                  onClick={() => void play(option)}
                >
                  {optionLabel(option)}
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      <section className="online-captured">
        <h2>Indfangede kort</h2>
        <div className="online-scoreboard">
          {snapshot.players.map(player => (
            <div className="online-player" key={player.seatNumber}>
              <strong>{player.seatNumber === snapshot.mySeat ? 'Dig' : `Spiller ${player.seatNumber + 1}`}</strong>
              <span>{(snapshot.captured[String(player.seatNumber)] ?? []).length} kort</span>
              <small>{snapshot.sweeps[String(player.seatNumber)] ?? 0} svabere</small>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
