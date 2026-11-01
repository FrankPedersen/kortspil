# Kasino — Regelspecifikation

**Version:** 4.0 · **Sidst opdateret:** 2026-10-14
**Gælder for:** `src/App.jsx` (individuel scoring, 2-4 spillere)

---

## 0. Sådan bruges dokumentet

Hver regel har et **ID** i formatet `KATEGORI-NN`. ID'et er permanent — når en regel
udgår, markeres den `UDGÅET` i stedet for at blive slettet, så numre ikke genbruges.

| Status | Betydning |
|---|---|
| ✅ | Implementeret og aktiv |
| ⚠️ | Delvist implementeret / afviger fra ønsket regel |
| ❌ | Ikke implementeret (backlog) |
| UDGÅET | Reglen gælder ikke længere |

Kolonnen **Kode** peger på den funktion i `src/App.jsx`, hvor reglen håndhæves.
Det er dét sted, en ændring skal foretages.

---

## 1. Opsætning — `SETUP`

| ID | Regel | Status | Kode |
|---|---|---|---|
| SETUP-01 | Der er 4 pladser. Hver plads slås individuelt til/fra — minimum 2 aktive | ✅ | `toggleSeat` |
| SETUP-02 | Hver aktiv plads sættes uafhængigt til menneske eller robot | ✅ | `setSeatType` |
| SETUP-03 | Alle pladser kan være robotter; spillet kører da af sig selv | ✅ | `buildRoster` |
| SETUP-04 | Pladser uden robot styres af mennesker ved samme skærm (hot-seat) | ✅ | `activeSeat` |
| SETUP-05 | Hver spiller får 4 kort; 4 kort lægges åbent på bordet ved rundestart | ✅ | `dealRound` |
| SETUP-06 | Når alle hænder er tomme, deles 4 nye kort til hver fra bunken | ✅ | `onTurnPlayed` |
| SETUP-07 | Turen går med uret: spiller 0 → 1 → … → n−1 → 0 (Syd → Vest → Nord → Øst) | ✅ | `onTurnPlayed` |
| SETUP-08 | Spiller 0 starter hver runde | ✅ | `dealRound` |
| SETUP-09 | Hot-seat skjuler ikke hånden mellem menneskelige spillere | ⚠️ | — |
| SETUP-10 | Hver robot har et niveau: **Let** eller **Mia** (se `BOT`) | ✅ | `setSeatLevel`, `LEVELS` |

---

## 2. Kortværdier — `KORT`

Værdien bruges til **byggeri og stik**. Den er ikke det samme som pointværdien (se `POINT`).

| ID | Regel | Status | Kode |
|---|---|---|---|
| KORT-01 | Kort 2-10 har deres pålydende værdi | ✅ | `createDeck` |
| KORT-02 | Knægt = 11, Dame = 12, Konge = 13 | ✅ | `createDeck` |
| KORT-03 | Es = 1 eller 14 ved stik og som mål på bordet | ✅ | `createDeck` |
| KORT-03b | Es = **altid 1** når det indgår i et byggeri | ✅ | `createDeck` |
| KORT-04 | Sulan (Ruder 10) = 10 eller 16 i alle sammenhænge | ✅ | `createDeck` |
| KORT-05 | Krabben (Spar 2) = 2 eller 15 i alle sammenhænge | ✅ | `createDeck` |
| KORT-06 | Sulan og Krabben kan tages hjem fra bordet som 10'er og 2'er (følger af KORT-04/05) | ✅ | `createDeck` |
| KORT-07 | Spar 5 fra hånden rydder **hele** bordet. På bordet er den en almindelig 5'er | ✅ | `createDeck`, `getAllLegalMoves`, `onTurnPlayed` |

> **Sådan er værdier modelleret.** Hvert kort har tre uafhængige værdisæt:
>
> | Felt | Betydning | Es | Sulan | Krabben | Spar 5 |
> |---|---|---|---|---|---|
> | `buildAs` | bidrag inde i et byggeri | 1 | 10, 16 | 2, 15 | 5 (kun når den ligger på bordet) |
> | `captureAs` | værdier kortet tager hjem MED | 1, 14 | 10, 16 | 2, 15 | — (rydder bordet i stedet) |
> | `boardAs` | værdier kortet har som mål på bordet | 1, 14 | 10, 16 | 2, 15 | 5 |
>
> Kort med flere mulige værdier håndteres af `partitionFlexible`, der prøver alle
> kombinationer, før et træk afvises som ulovligt.

> **KORT-07 i detaljer.** Spar 5 fra hånden har præcis ét lovligt træk: den rydder bordet,
> inklusive alle byggerier. Det tæller altid som svaber (+1 point) — også på tomt bord og på
> rundens sidste stik, i modsætning til POINT-10. Den kan ikke bruges til byggeri, tæller ikke
> som dækkort under BYG-03 og kan ikke spilles, mens man selv har et byggeri stående (BYG-11).

---

## 3. Stik (at tage hjem) — `STIK`

| ID | Regel | Status | Kode |
|---|---|---|---|
| STIK-01 | Et håndkort tager et bordkort med samme værdi | ✅ | `captureTargets` |
| STIK-02 | Et håndkort tager en kombination af løse bordkort, hvis summen rammer værdien præcist | ✅ | `partitionFixed` |
| STIK-03 | Et byggeri tages hjem med et håndkort, der matcher byggeriets værdi | ✅ | `captureTargets` |
| STIK-04 | Låste byggerier (dobbelt, tripel …) tages hjem på samme måde som enkelte | ✅ | `captureTargets` |
| STIK-05 | Flere grupper kan tages i ét træk (fx tager en 10'er både en løs 10'er og 4+6) | ✅ | `partitionFixed` |
| STIK-06 | Det valgte skal gå præcist op — overskydende kort gør trækket ulovligt | ✅ | `partitionFixed` |
| STIK-07 | Man er ikke tvunget til at tage, selvom det er muligt (undtagen BYG-11) | ✅ | `getAllLegalMoves`, `legal` |
| STIK-08 | ~~Man er ikke tvunget til at hente sit eget byggeri hjem~~ — erstattet af BYG-11 | UDGÅET | — |

> Kan et es tage hjem både som 1 og 14, vises to knapper: *Tag stik (es = 1)* og *Tag stik (es = 14)*.

---

## 4. Byggeri — `BYG`

**Grundmodel:** Alt det valgte (bordkort, eksisterende byggerier) plus det spillede
håndkort omdannes til "enheder". Enhederne forsøges delt i **grupper, der hver summer til
samme målværdi**. Antal grupper afgør typen.

| Grupper | Navn | Visning |
|---|---|---|
| 1 | Byggeri (enkelt) | Guld ramme |
| 2 | Dobbelt | 🔒 lilla ramme |
| 3 | Tripel | 🔒 |
| 4 | Firdobbelt | 🔒 |
| 5 | Femdobbelt | 🔒 |

| ID | Regel | Status | Kode |
|---|---|---|---|
| BYG-01 | **1 gruppe** = enkelt byggeri (fx 5 fra hånden på bordets 5 → byggeri på 10) | ✅ | `analyzeBuilds` |
| BYG-02 | **2+ grupper** = låst byggeri: dobbelt, tripel, firdobbelt … | ✅ | `analyzeBuilds`, `buildName` |
| BYG-03 | Man skal beholde et kort, der kan tage byggeriets værdi, på hånden **efter** trækket. Spar 5 tæller ikke | ✅ | `analyzeBuilds` |
| BYG-04 | Et låst byggeri kan ikke skifte værdi, men kan udvides med endnu en gruppe af samme værdi (dobbelt → tripel → …) | ✅ | `analyzeBuilds` |
| BYG-05 | Alle spillere må tage et byggeri hjem, også modstanderens | ✅ | `captureTargets` |
| BYG-06 | Et enkelt byggeri kan hæves af enhver (byggeri på 5 + en 3'er → 8). Den, der hæver, bliver ny ejer | ✅ | `analyzeBuilds`, `onTurnPlayed` |
| BYG-07 | Et byggeri er udeleligt: dets kort kan ikke splittes op igen | ✅ | `boardOptions`, `buildOptions` |
| BYG-08 | Byggeriets ejer registreres og vises på bordet | ✅ | `onTurnPlayed`, `Build` |
| BYG-09 | Byggeriets værdi er kun begrænset af, at et kort skal kunne tage det hjem (maks. 16) | ✅ | `analyzeBuilds` |
| BYG-10 | Man må ikke have to samtidige egne byggerier (følger af BYG-11) | ✅ | `getAllLegalMoves`, `legal` |
| BYG-11 | Har man et byggeri stående, er kun to træk lovlige: tage det hjem eller bygge videre på det. Hverken smid ud, andre stik eller Spar 5 | ✅ | `getAllLegalMoves`, `legal` |
| BYG-12 | Samle bordkort til en dobbelt **uden** at spille et kort | ❌ | — |
| BYG-13 | To låste byggerier kan ikke slås sammen | ✅ | `analyzeBuilds` |

> **Eksempler:**
> · To 10'ere på bordet + en 10'er fra hånden → 3 grupper à 10 → **tripel** 10.
> · 5 fra hånden på bordets 5 (= 10) + bordets 10 → 2 grupper à 10 → **dobbelt** 10.
> Begge kræver, at man **stadig** har en 10'er (eller Sulan) på hånden bagefter (BYG-03).

---

## 5. Point — `POINT`

Alle point tælles **individuelt pr. spiller**. Der er ingen hold.

| ID | Regel | Point | Status | Kode |
|---|---|---|---|---|
| POINT-01 | Sulan (Ruder 10) hentet hjem | 2 | ✅ | `computeScores` |
| POINT-02 | Krabben (Spar 2) hentet hjem | 1 | ✅ | `computeScores` |
| POINT-03 | Hvert es hentet hjem | 1 | ✅ | `computeScores` |
| POINT-04 | Svaber (rydde hele bordet) | 1 | ✅ | `onTurnPlayed` |
| POINT-05 | Flest kort ved rundens slutning | 1 | ✅ | `awardMost` |
| POINT-06 | Flest spar ved rundens slutning | 1 | ✅ | `awardMost` |
| POINT-07 | Ved uafgjort på POINT-05/06 gives ingen point | — | ✅ | `awardMost` |
| POINT-08 | POINT-01..04 beregnes løbende og vises straks | — | ✅ | `computeScores` |
| POINT-09 | Første spiller til 21 point vinder øjeblikkeligt | — | ✅ | `findWinner` |
| POINT-10 | Svaber gives ikke på rundens allersidste stik (undtagen Spar 5, se KORT-07) | — | ✅ | `onTurnPlayed` |
| POINT-11 | Sidste stik i runden giver 1 point | 1 | ✅ | `onTurnPlayed` |

> Målet på 21 point styres af konstanten `TARGET_SCORE` øverst i `src/App.jsx`.

---

## 6. Rundeafslutning — `RUNDE`

| ID | Regel | Status | Kode |
|---|---|---|---|
| RUNDE-01 | Runden slutter, når bunken **og** alle hænder er tomme | ✅ | `onTurnPlayed` |
| RUNDE-02 | Resterende bordkort tilfalder den, der tog sidste stik | ✅ | `onTurnPlayed` |
| RUNDE-03 | Rester inkluderer kort bundet i uafhentede byggerier | ✅ | `flattenCards` |
| RUNDE-04 | Efter opgørelse blandes et nyt spil, og pointene bevares | ✅ | `dealRound` |
| RUNDE-05 | Hvis ingen har nået 21, spilles en ny runde | ✅ | `findWinner` |
| RUNDE-06 | Giveren roterer mellem runder | ❌ | — |
| RUNDE-07 | Hver runde bruger ét helt, nyblandet spil på 52 kort | ✅ | `dealRound` |
| RUNDE-08 | Rundenummeret vises i toppen af skærmen og i slutopgørelsen | ✅ | `roundNumber` |
| RUNDE-09 | Sidste stik giver både resten af bordet (RUNDE-02) og 1 point (POINT-11) | ✅ | `onTurnPlayed` |

---

## 7. Robotlogik — `BOT`

Robotten genererer alle lovlige træk via `getAllLegalMoves` og vælger det højest scorende
med `scoreMove`. Den bruger **samme regelmotor som mennesker** — den kan ikke snyde.

Der er to niveauer:

- **Let** — spiller kun på det, den kan se lige nu.
- **Mia** — husker alle kort, der har ligget synligt på bordet (de fire åbne startkort og alt,
  der er spillet ud fra en hånd). Det er den samme viden, et opmærksomt menneske kan samle.
  Målt: 61,6 % vundne spil mod Let.

| ID | Vægtning | Værdi | Konstant | Kode |
|---|---|---|---|---|
| BOT-01 | Basis for stik | +15 | `W_CAPTURE` | `scoreMove` |
| BOT-02 | Pr. point i det, man tager hjem | +40 | `PT_WEIGHT` | `scoreMove` |
| BOT-03 | Pr. spar i stikket | +3 | `W_PER_SPADE` | `scoreMove` |
| BOT-04 | Pr. kort i stikket | +2 | `W_PER_CARD` | `scoreMove` |
| BOT-05 | Henter eget byggeri hjem | +60 | `W_OWN_BUILD` | `scoreMove` |
| BOT-06 | Snupper modstanders byggeri | +35 | `W_STEAL_BUILD` | `scoreMove` |
| BOT-07 | Svaber med almindeligt stik / med Spar 5 | +120 / +30 | `W_SWEEP` | `scoreMove` |
| BOT-08 | Låst byggeri: basis + pr. point i byggeriet | +40 / +6 | — | `scoreMove` |
| BOT-09 | Enkelt byggeri: basis + 0,4 × byggeriets værdi | +22 | — | `scoreMove` |
| BOT-10 | Straf for at blotte pointkort i enkelt byggeri | −9 pr. point | `PT_EXPOSED` | `scoreMove` |
| BOT-11 | Straf for at smide pointkort ud (og −4 for en spar; høje kort straffes lidt mere end lave) | −24 pr. point | `PT_DISCARD` | `scoreMove` |
| BOT-12 | Søgedybde: maks. 4 valgte bordenheder pr. træk | — | — | `getAllLegalMoves` |
| BOT-13 | Korthukommelse (kun Mia) | ✅ | — | `buildMemory` |
| BOT-14 | Mia vurderer sandsynligheden for, at en modstander har en given værdi — men ikke hvem | ⚠️ | — | `pOpponentHas` |
| BOT-15 | Svaberrisiko: straf for at efterlade et bord, som kan ryddes i ét træk | 12 + 15 pr. point + 2 pr. kort | `SR_BASE`, `SR_POINT`, `SR_CARD` | `sweepRisk` |
| BOT-16 | Mia: straf for enkelt byggeri, som en modstander sandsynligvis kan tage | p × (40 + 10 pr. point) | — | `scoreMove` |
| BOT-17 | Mia: straf for at smide et kort ud, som sandsynligvis bliver taget straks | p × 60 | — | `scoreMove` |

> **BOT-15:** Let ganger straffen med antallet af kortværdier, der kan rydde bordet. Mia ganger
> i stedet med sandsynligheden for, at en modstander har en af dem. Tomt bord og borde med
> mere end 4 enheder straffes ikke.
>
> Vægtene er tunet over 10.000 simulerede runder (+4,8 % point pr. runde mod forrige version).

---

## 8. Visning og betjening — `UI`

| ID | Regel | Status | Kode |
|---|---|---|---|
| UI-01 | Et taget stik vises ved spilleren i 3 sek. (**Auto**) eller til der klikkes (**Klik**) | ✅ | `lastTrick`, `TRICK_SHOW_MS` |
| UI-02 | Banner "Sidste omgang", når bunken er tom, men der stadig er kort på hænderne | ✅ | `isFinalDeal` |
| UI-03 | Kort med særlig værdi har et mærke: 1/14 (es), 16 (Sulan), 15 (Krabben), RYD (Spar 5) | ✅ | `Card` |
| UI-04 | Lyd kan slås til og fra | ✅ | `playSound` |
| UI-05 | Spillog med de seneste 100 hændelser | ✅ | `addLog`, `MAX_LOG` |
| UI-06 | Regler og strategitips kan åbnes under spillet | ✅ | `showRules`, `showStrategy` |

---

## 9. Backlog — foreslåede regler

| ID | Forslag | Kompleksitet |
|---|---|---|
| BYG-12 | Samle bordkort til en dobbelt **uden** at spille et kort | Middel — ny træktype |
| SETUP-09 | "Giv skærmen videre"-skærm mellem menneskelige spillere | Lav |
| RUNDE-06 | Roterende giver | Lav |
| NY | Sidste svaber giver ekstra point | Lav |
| NY | Valgbart målpoint (11/16/21) | Lav — `TARGET_SCORE` findes allerede |

### Kendte fejl og begrænsninger

- **Kun robotter:** Spiller 0's hånd vises åbent nederst, og man kan klikke og spille for den (`activeSeat`).
- **Lige stilling over 21:** Når to spillere passerer 21 ved samme opgørelse med samme pointtal, vinder den med lavest pladsnummer (`findWinner`).
- **Lydknappen:** Slås lyden fra, kan det næste træk stadig give lyd, fordi `onTurnPlayed` ikke registreres igen, når `soundEnabled` ændres.
- **Ingen tager noget:** Tager ingen et stik i en hel runde, tilfalder bordets rest ingen (RUNDE-02).

---

## 10. Sådan tilføjer du en ny regel

Regelmotoren er samlet i nogle få funktioner. Næsten enhver ny regel hører hjemme i én af dem:

| Skal reglen … | Rediger |
|---|---|
| ændre hvad et kort er værd | `createDeck` |
| ændre hvad der må tages hjem | `captureTargets` / `canCapture` |
| ændre hvad der må bygges | `analyzeBuilds` |
| begrænse hvilke træk der er lovlige | `getAllLegalMoves` **og** `legal` (se §11) |
| ændre hvordan point gives | `computeScores` / `awardMost` |
| ændre robottens prioritering | `scoreMove` |
| ændre hvordan grupper må dannes | `partitionFixed` / `partitionFlexible` |

**Fremgangsmåde:**

1. Tilføj reglen i dette dokument med næste ledige ID i kategorien.
2. Sæt status til ❌ og noter hvilken funktion der skal ændres.
3. Implementér — hold ændringen inde i den ene funktion, hvis muligt.
4. Skriv regel-ID'et som kommentar i koden, fx `// BYG-12`.
5. Skift status til ✅.

**Skabelon:**

```
| BYG-14 | Kort beskrivelse af reglen i én sætning | ❌ | analyzeBuilds |
```

---

## 11. Kendte designvalg

- **Én partitioneringsmotor.** `partitionFixed` / `partitionFlexible` bruges både til stik og
  byggeri. En ændring dér slår igennem begge steder — ofte en fordel, men tjek altid begge veje.
- **Lovlige træk findes to steder.** `getAllLegalMoves` bestemmer robottens træk, og blokken
  `legal` i `App` bestemmer, hvilke knapper et menneske får. En ny begrænsning (som BYG-11)
  skal ind begge steder, ellers får robot og menneske forskellige regler.
- **Byggerier er udelelige enheder.** Når kort først er bundet i et byggeri, kan de kun
  frigives ved at nogen tager hele byggeriet hjem.
- **Ingen serverside-validering.** `MockSocket` simulerer netværk, men al regelhåndhævelse
  sker i klienten. Ved rigtig multiplayer skal regelmotoren flyttes til serveren.
- **Alt i én fil.** Regelmotor, robotter, brugerflade og CSS (`STYLES`) ligger i `src/App.jsx`.
