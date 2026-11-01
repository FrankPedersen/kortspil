# Es Makker — kontekst til Claude Code

Dansk trick-taking-kortspil ("Es Makker"-familien) skrevet i vanilla ES2015+ moduler.
Ingen frameworks, intet byggetrin, ingen afhængigheder. Hele spillet er statiske filer.

Al kode, alle kommentarer, al UI-tekst og al log er på **dansk**. Bevar det.

---

## Kør og test

```bash
# Spil (ES-moduler kræver http, ikke file://)
python -m http.server 8000      # → http://localhost:8000
npx --yes serve                 # → http://localhost:3000

# Verifikation: pointtabel, regler, pip-opstilling, hele partier
node test/verify.mjs

# Styrkemåling: Monte Carlo mod heuristik (tager ~30 s)
node test/benchmark.mjs 80
```

`test/verify.mjs` skal altid være grøn og returnerer exit-kode 1 ved fejl. Den
kontrollerer alle 392 celler i pointtabellen mod kildetabellen i `test/table.txt`,
meldehierarkiet, stikafgørelsen, de lovlige kort, hemmeligholdelsen af selvmakker,
pip-opstillingerne, hvad botterne ved, og godt 230 hele runder med revision af
hver enkelt — heraf seks med Monte Carlo-botter.

**Ret aldrig tallene i `SCORE_TABLE` uden også at rette `test/table.txt`** —
tabellen er leveret af spillets ejer og er den normative kilde.

---

## Filer

| Fil | Ansvar |
|---|---|
| `index.html` | Kun ramme og containere. Ingen logik. |
| `css/style.css` | Bord, kortdesign, pip-opstilling, animationer, dialoger. |
| `js/card.js` | `Card` og `Deck`. 52 kort + 3 jokere = 55. |
| `js/game.js` | Spilmotor: melderunde, trumf, makkeres, bytte, stik, point. |
| `js/ai.js` | Hurtig heuristisk bot ("Nem"). Bruges også som udspilningspolitik i simuleringen. |
| `js/rollout.js` | Synkron mini-motor + videnstyret fordeling af usete kort. |
| `js/mc.js` | Monte Carlo-bot ("Svær"). Simulerer runder og optimerer på point. |
| `js/ui.js` | Rendering, dialoger, scoreboard, animationer. |
| `js/app.js` | Entry point. Kobler UI og bots på motoren via et `io`-objekt. |

### Arkitektur

`Game` er asynkron og spørger omverdenen gennem et `io`-objekt:
`askBid`, `askTrump`, `askPartner`, `askExchange`, `askCard`, `afterTrick`,
`askContinue`, `showResult`. `app.js` router hvert kald til UI'et for mennesket
og til en bot for maskinerne. Motoren kender ikke DOM'en, og UI'et kender ikke reglerne.

Motoren udsender hændelser (`dealt`, `bid`, `cardPlayed`, `trickEnd`, `roundScored`,
`gameOver` m.fl.) som `app.js` lytter på. Tilstand sendes til UI'et som et
`snapshot()` — et fladt, læsbart objekt.

---

## Regler som koden implementerer

- 55 kort. **Fire spillere**, alle med i hver runde. 13 kort hver, 3 i katten.
- Esset er højest, men **lavest** i Sol, Ren Sol, Bordlægger og Super Bordlægger.
- Maskinen blander, så der tages hverken af eller bankes.
- Første giver sidder efter værten; giverturen går med uret. Udspil i 1. stik
  foretages af personen efter giveren.
- **Melding "tilbage, ikke rundt"**: 1 mod 1 indtil den ene passer, hvorefter
  vinderen melder videre mod næste spiller. Se `runBidding()` — køen og
  `queue.unshift(holder)` er hele mekanikken.
- Styrke: Almindelige < Vip < Gode < Halve. `Bid.rank` = `(tricks-7)*4 + variantIndex`.
  Specialmeldinger lægger sig et halvt trin under den melding der slår dem:
  Sol < 9 Vip, Ren Sol < 10 Vip, Bordlægger < 11 Vip, Super Bordlægger < 12 Vip.
- Trumf: Almindelige frit valg inkl. klør · Gode altid klør · Vip fra katten
  (joker satser på forrige kort, 3 jokere = uden trumf) · Halve vælges af den
  med makkeresset, ikke ressets egen kulør.
- Trumf og makkeres meldes **før** byttet. Alt eller intet, og der SKAL byttes i Vip.
- Man må ikke melde trumfkuløren eller et es man selv har. Har man dem alle,
  rykkes der ned ad stigen `A → K → Q → J → 10`.
- Makkeres i katten ⇒ spilføreren er selvmakker.
- Makkeresset SKAL falde første gang kuløren **spilles** — også når indehaveren
  selv spiller kuløren ud. Han må frit spille andre kulører ud, men vælger han
  makkeressets kulør, skal det være esset. Håndhæves i `legalCards()` i både
  udspils- og bekendelsesgrenen. Har spilføreren taget esset op fra katten, gælder
  pligten ikke for ham.
- Alle melder pas ⇒ samme giver giver om. **En omgivning er ikke en ny runde:**
  `roundNo` tæller spillede runder, `dealNo` tæller givninger inden for runden,
  og `record.deals` viser hvor mange der skulle til. Så er regnskabets rækker
  sammenhængende, og "Runde X af Y" passer.

### Selvmakker er hemmelig

Ved et rigtigt bord siger ingen noget, når makkeresset meldes. Spilføreren
opdager først at esset lå i katten, hvis han bytter og ser det. Derfor er
`selfPartner` delt i to lag:

| Felt i snapshottet | Betydning |
|---|---|
| `selfPartner` | det **offentlige** billede — falsk så længe det er hemmeligt |
| `selfPartnerTruth` | sandheden, kun til spilføreren og motoren |
| `selfPartnerKnown` | er det offentligt kendt ved bordet? |
| `declarerSawKitty` | spilføreren byttede og har altså set katten |

Brug altid `knowsSelfPartner(seat, st)` fra `game.js` i stedet for at læse
felterne direkte. Det er offentligt ved specialmeldinger (han spiller alene), i
Halve (den med makkeresset melder trumf og afslører sig selv), i Vip (katten
vendes åbent) og fra det øjeblik spilføreren selv spiller esset.

Makkeresset har to tilstande, der ikke må blandes sammen:

| I motoren (`st`) | Betydning |
|---|---|
| `partnerRevealed` | esset skal ikke længere falde — det er faldet, ELLER spilføreren har taget det op fra katten. Bruges af `legalCards()`. |
| `partnerFell` | esset er faktisk spillet. Det kan hele bordet se. |

`snapshot().state.partnerRevealed` er `st.partnerFell`. Viste snapshottet det
interne felt, kunne alle se at spilføreren havde taget esset op i det skjulte.
`snapshot().state.partnerSeat` er `null` indtil esset falder — undtagen i Halve,
hvor `partnerKnown` er sand. `st.hands` indeholder stadig alle hænder — botterne
læser kun `.length` for de andre, og UI'et har brug for dem til `openHands`. Det er
et bevidst valg, ikke en forglemmelse.

Faldgrube: specialmeldinger sætter `selfPartner` uden om `choosePartnerCard`,
så `selfPartnerKnown` skal sættes i begge grene af `setupContract`.

### Fortolkninger — spørg ejeren før du ændrer dem

Reglerne var ikke entydige på nogle punkter. Valgene nedenfor er truffet i
samråd med spillets ejer og er bevidste. Lav dem ikke om på eget initiativ:

1. **Jokeren** vinder kun når den **spilles ud**. Lægges den i et stik den ikke har
   åbnet, kan den ikke vinde og fungerer som frit afkast. Joker må ikke spilles ud
   i 1. runde. Se `resolveTrick()` og `legalCards()`.
2. **"Væltes på X. stik"** er implementeret som: spilføreren skal tage nul stik, og
   tallet styrer kun hvornår kortene lægges op (`SPECIAL_INFO.revealAfter`).
   Alternativ læsning: modspillerne har kun til og med stik X til at vælte ham.
3. **Joker i katten ved Vip** bevarer trumfen uden at fordoble. Fordobling kan
   slås til med `VIP_JOKER_DOUBLES = true` i `game.js`, men pointtabellen
   indregner den ikke.

---

## Pointberegning

`SCORE_TABLE[tricks][variant]` er 14 tal pr. række, indekseret efter
`diff = vundne stik − meldte stik`. Indeks 0 = nul stik hjem, indeks 13 = alle 13 hjem.
`lookupScore(tricks, variant, won)` slår op og returnerer `{points, diff, made}`.

Specialmeldinger har faste point: Sol 3 · Ren Sol 6 · Bordlægger 12 · Super Bordlægger 24.

Regnskabet er **nulsum**. Er spilførersiden mindre end modspillersiden (selvmakker
eller misère, 1 mod 3), ganges spilførerens point op med `(4-k)/k`, så summen af
`delta` altid er 0. `test/verify.mjs` kontrollerer det for hver runde.

Konsekvens værd at kende: medianudsvinget er kun ~3 point pr. runde, så antallet
af runder vokser med **kvadratet** på et pointmål. Mål 25 ≈ 15 runder, mål 100 ≈ 220
runder. Derfor er standardmålet 25, og `app.js` viser et løbende skøn i opsætningen.

---

## Botterne

**Nem** (`ai.js`) vurderer hånden heuristisk: honnører, længde og trumfningsværdi
pr. kulør. `PARTNER_ALLOWANCE = 2.6` er tillægget for makkerens kort — det er det
mest følsomme tal i filen. Sænk det, og botterne passer næsten altid; hæv det, og
de melder sig ned. Misère vurderes omvendt af `misereRisk()`, hvor høje kort og
lange kulører er farlige.

**Svær** (`mc.js`) spiller runden færdig 50-60 gange mod gættede modstanderhænder
og vælger det kort eller den melding der giver flest point efter `SCORE_TABLE`.
`buildConstraints()` i `rollout.js` samler alt hvad botten ved: renoncer fra de
spillede kort, at den der har spillet i makkeressets kulør uden at lægge esset ikke
har det (undtagen spilføreren efter et bytte), åbne hænder i misère, makkeren i
Halve (`partnerKnown`), selvmakker når `knowsSelfPartner()` siger ja, og den vendte
kat i Vip (`shownKitty`). Snapshottet indeholder alle hænder, så al viden SKAL gå
gennem den funktion — ellers snyder botten.

Faldgrube: `ownSide()` skal også genkende makkeren **efter** han har spillet esset.
Kigger den kun på hånden, skifter Monte Carlo-makkeren side midt i runden og
spiller for modspillerne resten af vejen.

Målt i oktober 2026 over fem serier på 200-400 runder vinder Monte Carlo-siden
med **+2,1 til +2,7 point pr. runde** mod heuristikken. Udsvinget mellem serier er
omkring ±0,5, så forskelle under 1 point pr. runde kan ikke skelnes fra støj.
Tidligere tal på +3,7 til +5,0 kunne ikke genskabes. Benchmarken stoppede desuden
ved 200 runder men delte med det ønskede antal — det er rettet.

Knapper i `MC_DEFAULTS`:

| Knap | Standard | Effekt |
|---|---|---|
| `cardWorlds` | 60 | Verdener pr. kortvalg. Styrke mod hastighed. |
| `bidWorlds` | 50 | Verdener pr. meldetype. |
| `soloRiskLimit` | 2.0 | Hvor meget hånden skal ligne en misère før Sol m.fl. simuleres. |
| `yieldEvery` | 8 | Hvor ofte browseren får luft. Sæt højt i Node. |

Faldgrube der kostede tid: i misère skal simuleringens **modspillere** aktivt
forsøge at vælte spilføreren (`soloPolicy` i `rollout.js`). Uden det overvurderes
hans chancer voldsomt, og botten meldte Super Bordlægger i 22 % af runderne mod
2-3 % nu. Spilføreren må heller aldrig spille joker **ud** i en misère — så vinder
han stikket og vælter sig selv.

---

## UI-detaljer der er nemme at ødelægge

- **Kig-tilstand**: under melding, trumfvalg og makkeresvalg sættes `peek: true` på
  `openModal`. Det slår sløringen fra og løfter egen hånd op over overlayet med
  `z-index: 130`. Ingen forfader til `#south-seat` må få et `z-index`, ellers
  danner den en stacking context og hånden forsvinder bag dialogen igen.
- **Pip-opstilling**: `PIP_LAYOUT` i `ui.js` er `[x, y]` i procent af pip-feltet.
  25/50/75 er venstre, midter- og højrekolonne. 9 og 10 bruger fire rækker i
  kolonnerne i stedet for tre. Pips under y=50 vendes 180°.
  `test/verify.mjs` kontrollerer antal og symmetri.
- **Katten efter byttet** vises kun med billedsiden op, når mennesket selv er
  spilfører. En bots afkast er hemmeligt (`exchange`-hændelsen i `app.js`).
- **Kortstørrelser**: `--card-w/--card-h` gælder kortene på bordet, mens din egen
  hånd har sine egne `--hand-card-w/--hand-card-h` (mindst 30 % større, vokser
  med skærmhøjden). `.hand-mine` sætter `--card-w` lokalt, så hjørner, pips og
  billedkort skalerer med. Bordet har `aspect-ratio: 1.8` og får resten af
  højden, så det ikke bliver en lang grøn flade på brede skærme.
- **Egen hånd** lægges ud af `fitHand()` i `ui.js`, der sætter `--hand-overlap`
  efter den plads der er. Hardkod aldrig margin på `.hand-mine .card` — så ryger
  kort ud over kanten på mobil og kan ikke rammes. `#south-seat` er et grid med
  navneskiltet i midten og "Din tur …" (`#turn-hint`) ved siden af, så tippet
  aldrig får hånden til at hoppe. Kig-tilstandens `::before` har sin egen celle.
- **Overblikket** (`#table-hud`, `renderHud()`) viser stik, trumf og spilførerens
  mål. Det tæller kun stik fra spillere du VED er på spilførersiden — samme
  hemmeligholdelse som resten af UI'et (`roleOf()`, `iHoldPartner()`).
- **Regler og andre opslag** åbnes med `openInfo()` i sit eget lag
  (`#info-overlay`, z-index 150). Brug aldrig `openModal()` til opslag: den deler
  dialog med spillet, og en melding der åbner imens, ville overskrive reglerne —
  eller omvendt efterlade spillet og vente på et svar der aldrig kommer.
- **Mobil (≤ 700 px)**: bottens bagsider skjules og antal kort står i navneskiltet
  (`.meta-cards`), meldeknapperne viser kun tallet, og i kig-tilstand står hånden
  fast i bunden, så Pas-knappen aldrig ligger under den.
- **Røde kulører** sættes eksplicit på kort, hjørner, rang, kulørtegn og pips,
  fordi arv alene blev vasket ud af den mørke baggrund.
