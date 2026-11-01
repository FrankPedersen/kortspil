# Kasino

Det klassiske danske kortspil Kasino i browseren. 2-4 spillere — mennesker ved samme skærm og/eller robotter.

**Spil det her:** https://frankpedersen.github.io/kortspil/kasino/

## Funktioner

- 2-4 spillere; hver plads kan være menneske eller robot
- To robotniveauer: **Let** (spiller på det, den kan se) og **Mia** (husker alle kort, der har ligget på bordet)
- Stik, byggerier (enkelt, dobbelt, tripel …) og svabere — inkl. Sulan, Krabben og Spar 5
- Løbende stilling, spillog, regler og strategitips i spillet

## Regler i korte træk

- Første spiller til **21 point** vinder.
- **Point:** Sulan (♦10) 2 · Krabben (♠2) 1 · hvert es 1 · hver svaber 1 · sidste stik 1 · flest kort 1 · flest spar 1
- **Særlige kort:** Es = 1 eller 14 (altid 1 i byggeri) · Sulan = 10 eller 16 · Krabben = 2 eller 15 · Spar 5 rydder hele bordet
- Har du et byggeri stående, skal du tage det hjem eller bygge videre på det.

Den fulde regelspecifikation med regel-ID'er ligger i [docs/kasino-regler.md](docs/kasino-regler.md).

## Kør det lokalt

Kræver [Node.js](https://nodejs.org) 22 eller nyere.

```bash
npm install
npm run dev
```

Åbn adressen, som Vite skriver i terminalen (normalt http://localhost:5173).

`npm run build` laver en færdig version i mappen `dist/`.

## Udgivelse

Spillet bygges sammen med Es Makker og forsiden i det fælles repository.
GitHub Pages-workflowet ligger i repositoryets `.github/workflows/pages.yml`.

## Projektstruktur

| Fil | Indhold |
|---|---|
| `src/App.jsx` | Hele spillet: regelmotor, robotter, brugerflade og CSS |
| `src/main.jsx` | Starter appen |
| `docs/kasino-regler.md` | Regelspecifikation |
| `public/favicon.svg` | Ikon |
