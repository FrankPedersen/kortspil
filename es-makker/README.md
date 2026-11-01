# Es Makker

Dansk kortspil med 52 kort + 3 jokere, fire spillere, meldeproces "tilbage, ikke
rundt", makkeres, byttefase og den fulde pointtabel for 7-13 stik i Almindelige,
Vip, Gode og Halve samt Sol, Ren Sol, Bordlægger og Super Bordlægger.

Vanilla HTML, CSS og ES-moduler. Ingen afhængigheder, intet byggetrin.

## Kom i gang

ES-moduler kan ikke indlæses over `file://`, så der skal en lille webserver til:

```bash
python -m http.server 8000      # → http://localhost:8000
```

eller

```bash
npx --yes serve                 # → http://localhost:3000
```

Kør kommandoen **inde i denne mappe**, så `index.html` ligger i roden af det der
serveres. I VS Code kan du i stedet højreklikke på `index.html` og vælge
"Open with Live Server".

## Opsætning

Når spillet starter vælger du navn, sværhedsgrad, spillængde og vært.

**Sværhedsgrad.** *Nem* bruger en håndlavet vurdering af hånden. *Svær* bruger en
Monte Carlo-bot, der spiller runden færdig 50-60 gange mod gættede modstanderhænder
før hvert valg, og som vinder med 2-3 point pr. runde mod den nemme.

**Spillængde.** Enten et pointmål eller et fast antal runder. Regnskabet er nulsum,
så pointene bevæger sig langsomt: mål 25 tager typisk omkring 15 runder, mål 100
over 200. Feltet viser et løbende skøn. Vil du have forudsigelig længde, vælg
et fast antal runder.

**Vært.** Værten fører regnskabet, og første giver sidder efter værten.

## Test

```bash
node test/verify.mjs          # pointtabel, regler, pip-opstilling, hele partier
node test/benchmark.mjs 80    # Monte Carlo mod heuristik, 80 runder
```

## Struktur

```
es-makker/
├── index.html
├── css/style.css
├── js/
│   ├── app.js        entry point
│   ├── card.js       Card og Deck
│   ├── game.js       spilmotor, regler og pointtabel
│   ├── ai.js         heuristisk bot
│   ├── rollout.js    simuleringsmotor
│   ├── mc.js         Monte Carlo-bot
│   └── ui.js         rendering og dialoger
├── test/
├── CLAUDE.md         kontekst til Claude Code
└── README.md
```

## Hosting

Spillet er helt statisk og ligger i det fælles Kortspil-repository som
`es-makker/`. GitHub Pages udgiver det sammen med forsiden og Kasino.
