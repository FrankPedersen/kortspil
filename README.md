# Kortspil

Forside og fælles indgang til to danske kortspil:

- **Es Makker** – fire spillere, meldinger og makkerskab.
- **Kasino** – 2-4 spillere, bygninger og stik.

## Spil online

Når GitHub Pages-udgivelsen er gennemført:

- Forside: <https://www.kontraktbridge.dk/kortspil/>
- Es Makker: <https://www.kontraktbridge.dk/kortspil/es-makker/>
- Kasino: <https://www.kontraktbridge.dk/kortspil/kasino/>
- Online-lobby: <https://kortspil-api-20261101-v2.azurewebsites.net/lobby/>

## Kør lokalt

Es Makker og forsiden er statiske filer. Start en webserver fra denne mappe:

```bash
python -m http.server 8000
```

Åbn <http://localhost:8000>. Kasino kan udvikles med Vite:

```bash
cd Kasino
npm ci
npm run dev
```

## Test og byg

Kontrollér Es Makker:

```bash
node es-makker/test/verify.mjs
```

Byg Kasino fra dets mappe:

```bash
cd Kasino
npm ci
npm run build
```

Hvert push til `main` bygger begge spil og udgiver den samlede side på GitHub
Pages via [workflowet](.github/workflows/pages.yml).

## Backend og multiplayer-lobby

TypeScript/Node API, SQL-migreringer og OpenAPI-kontrakter ligger i
`backend/` og `contracts/`. Se [backendens README](backend/README.md) for lokal
opstart. Kasino kan spilles online fra den beskyttede lobby med 2-4 mennesker;
Es Makker online er endnu ikke tilsluttet.
Azure-ressourcer oprettes ikke af lokal udvikling eller GitHub Pages.
