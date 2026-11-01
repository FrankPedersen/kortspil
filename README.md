# Kortspil

Forside og fælles indgang til to danske kortspil:

- **Es Makker** – fire spillere, meldinger og makkerskab.
- **Kasino** – 2-4 spillere, bygninger og stik.

## Spil online

Når GitHub Pages-udgivelsen er gennemført:

- Forside: <https://frankpedersen.github.io/kortspil/>
- Es Makker: <https://frankpedersen.github.io/kortspil/es-makker/>
- Kasino: <https://frankpedersen.github.io/kortspil/kasino/>

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
