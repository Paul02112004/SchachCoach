# ♞ SchachCoach

Selbst gehostete Schach-Analyse für deinen Laptop – ähnlich wie Chessigma, aber komplett lokal.

## Funktionen

- **Automatischer Import:** Du gibst deinen Chess.com- und/oder Lichess-Namen an, den Rest macht der Server:
  - beim Start werden die Partien der letzten beiden Monate geholt und analysiert
  - mit **„Gesamte Historie importieren“** kommt deine komplette Historie dazu, sortiert von neu nach alt
  - danach schaut der Server alle 10 Minuten (einstellbar) nach neuen Partien
  - neue Partien werden immer vor der Historie analysiert
  - alles läuft im Hintergrund auf dem Server, der Browser muss dafür nicht offen sein
- **Einzelne Partien** von Chess.com, Lichess oder per PGN laden.
- **Partie-Review mit Stockfish 19.** Die Engine läuft im Browser. Jeder Zug wird eingeordnet: Brillant, Großartig, Bester Zug, Exzellent, Gut, Buchzug, Ungenauigkeit, Fehler, Verpasst oder Patzer. Dazu kommen Genauigkeit, Partie-Elo, Bewertungsbalken, Bewertungsgraph und die beste Linie. Du kannst auf dem Brett auch eigene Varianten mit Live-Engine ausprobieren.
- **Coach-Übersicht:**
  - geschätzte Elo (Tacho), Gewinnquote, Genauigkeit, Rating mit Veränderung und Elo-Trend
  - die letzten 25 Partien auf einen Blick
  - **Elo pro Kategorie:** Eröffnung, Mittelspiel, Endspiel, Taktik, Verwertung und Verteidigung, mit deinem Rating als Linie zum Vergleich
  - Stärke und Baustelle mit Direktlink zum passenden Training
  - Fehler pro Partie und in welcher Spielphase sie passieren
  - deine Eröffnungen mit Punkten und Eröffnungs-Elo
- **Fehlermuster & Gewohnheiten.** Jeder eigene Fehler wird einem konkreten Muster zugeordnet. Dafür werden die Antwort der Engine und die Materialbilanz entlang der Engine-Linie ausgewertet:
  - Figur auf unsicheres Feld gezogen
  - angegriffene Figur stehen gelassen
  - Gabel zugelassen
  - gegnerische Kombination übersehen
  - Mattdrohung übersehen
  - eigenes Matt verpasst
  - Taktik verpasst
  - Gegnerfehler nicht bestraft
  - Königssicherheit vernachlässigt
  - ungenauer Plan

  Jedes Muster kommt mit Häufigkeit, Spielphase, Zeitnot-Anteil, Beispielen (Klick öffnet genau die Stellung), einem Tipp und einem Button „Üben“. Dazu gibt es Gewohnheiten:
  - Verwertung gewonnener Stellungen und Kampfgeist
  - wie du aus der Eröffnung kommst
  - frühe Damenzüge, späte Rochade, gleiche Figur mehrfach gezogen
  - Fehler in Zeitnot und Fehlerserien

  Oben auf der Coach-Seite fasst ein **Coach-Fazit** die wichtigsten Punkte zusammen.
- **Training aus eigenen Fehlern.** Jeder Fehler, Patzer und jede verpasste Chance wird zu einer Aufgabe. Fällige Aufgaben kommen nach dem Leitner-System wieder (1, 3, 7, 14 und 30 Tage). Du kannst nach Phase, Kategorie und Fehlermuster filtern.
- **Eröffnungstrainer** mit rund 3.400 benannten Eröffnungslinien:
  - wähle Farbe, Eröffnung und Variante
  - im Modus **Lernen** zeigen Pfeile die Buchzüge, im Modus **Abfragen** spielst du sie aus dem Kopf
  - der Gegner wählt zufällig eine Variante und bevorzugt dabei Linien, die du noch nicht sicher kannst
  - der Fortschritt wird gespeichert

## Starten

Voraussetzung ist [Node.js](https://nodejs.org) ab Version 18 (empfohlen: aktuelle LTS).

```bash
cd schachcoach
npm install      # nur beim ersten Mal
npm start
```

Danach **http://localhost:3000** im Browser öffnen. Beim ersten Start trägst du unter *Optionen* deinen Chess.com- und/oder Lichess-Namen ein.

Statt der Befehle oben gehen auch:
- **Windows:** Doppelklick auf `start-windows.bat`
- **macOS:** Doppelklick auf `start-mac.command`. Beim ersten Mal eventuell Rechtsklick → Öffnen.

### Vom iPad oder Handy aus nutzen

Der Server zeigt beim Start auch eine WLAN-Adresse an, zum Beispiel `http://192.168.0.23:3000`. Die öffnest du auf dem iPad im selben WLAN. Die Analyse läuft dann im Browser des iPads.

Port ändern: `PORT=8080 npm start` (unter Windows: `set PORT=8080 && npm start`).

## Automatischer Import – gut zu wissen

- **Der Server muss laufen.** Partien werden nur geholt und analysiert, solange das SchachCoach-Fenster offen ist (`npm start`). Wenn der Laptop schläft, holt der Server alles nach, sobald er wieder läuft.
- **Automatisch mit dem Laptop starten:**
  - Windows: Taste Win+R drücken, `shell:startup` eingeben und dort eine Verknüpfung zu `start-windows.bat` ablegen.
  - macOS: Systemeinstellungen → Allgemein → Anmeldeobjekte → `start-mac.command` hinzufügen.
- **Verzögerung bei Chess.com.** Laut Chess.com werden die öffentlichen Spieldaten höchstens alle 12 Stunden aktualisiert. In der Praxis tauchen Partien meist nach wenigen Minuten auf, manchmal dauert es aber länger. Lichess liefert neue Partien sofort.
- **Dauer der Historie.** Bei Tiefe 12 dauert eine Partie auf einem normalen Laptop grob 5–15 Sekunden. 1.000 Partien brauchen also ein paar Stunden. Du kannst jederzeit pausieren. Nach einem Neustart macht der Server dort weiter, wo er aufgehört hat.
- **Fehlgeschlagene Partien.** Partien, die sich nicht lesen lassen (z.B. Schach960), werden übersprungen und unter *Laden* als „nicht lesbar“ gezählt.

## Tipps

- **Analysetiefe** (Optionen): 14 ist der Standard. Eine Partie dauert dann je nach Laptop etwa 10–40 Sekunden. Mit 12 geht es deutlich schneller, mit 16–18 wird es genauer.
- **Fortschritt:** Den Stand der Hintergrundanalyse siehst du unter *Laden* und links unten in der Navigation.
- Die **Elo-Werte sind Schätzungen**. Sie werden aus der Genauigkeit berechnet, also wie viel Gewinnchance deine Züge im Schnitt kosten. Für die Kategorien braucht es jeweils mindestens 8 Züge, aussagekräftig wird es ab etwa 15–20 Partien.

## Daten

Alles liegt lokal im Ordner `data/`: analysierte Partien als JSON, Einstellungen und Trainingsfortschritt. Zum Sichern kopierst du einfach diesen Ordner. Zum Zurücksetzen löschst du ihn.

## So wird bewertet

| Klasse | Verlust an Gewinnchance |
|---|---|
| Bester Zug | Zug = Engine-Zug |
| Exzellent | < 2 % |
| Gut | < 5 % |
| Ungenauigkeit | < 10 % |
| Fehler | < 20 % |
| Patzer | ≥ 20 % |

Dazu kommen ein paar Sonderfälle:
- **Großartig:** Es gab nur einen guten Zug, und du hast ihn gefunden.
- **Brillant:** Ein guter Zug, bei dem du eine Figur opferst.
- **Verpasst:** Der Gegner hat einen Fehler gemacht, und du hast ihn nicht genutzt.
- **Buchzug:** Der Zug steht in der Eröffnungsdatenbank.

Die Genauigkeit wird mit der Formel von Lichess berechnet.

**Kategorien:**
- Eröffnung: die ersten 12 Züge
- Endspiel: höchstens 6 Figuren ohne Bauern und Könige
- Mittelspiel: alles dazwischen
- Taktik: Stellungen mit nur einem guten Zug oder direkt nach einem gegnerischen Fehler
- Verwertung: deine Gewinnchance liegt bei mindestens 75 %
- Verteidigung: deine Gewinnchance liegt bei höchstens 25 %

## Lizenzen

- Stockfish.js (GPL-3.0)
- chessground (GPL-3.0)
- chess.js (BSD-2)
- Eröffnungsdaten: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0)
- Figuren: cburnett (CC BY-SA 3.0)

Nur für den privaten Gebrauch gedacht.
