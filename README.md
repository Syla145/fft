# ⬡ Dynasty HQ

Ein Dynasty Fantasy Football Intelligence Center für Sleeper-Ligen.

## Features

- 📊 **Übersicht** – Roster-Wert, Liga-Rang, Altersverteilung, Positionsbalance
- 👥 **Mein Roster** – Alle Spieler & Picks mit Werten, Verletzungsstatus, Bye-Weeks
- 🏆 **Liga-Vergleich** – Alle Teams ranked, Positionsnoten, Detailansicht
- 🔄 **Trade-Vorschläge** – KI-basierte Trade-Ideen (Win Now / Rebuild Modus)
- ⚖️ **Trade-Check** – Eigene Trades bewerten per Spieler-Suche
- 📋 **Waiver Wire** – Beste freie Spieler der Liga

## Spielerwert-Quellen

- **KeepTradeCut (KTC)** – Inoffizieller Endpunkt (beliebteste Dynasty-Werte)
- **FantasyCalc** – Offizielle API (Fallback wenn KTC nicht verfügbar)
- **Sleeper Rankings** – Direkt aus der Sleeper-App

> Hinweis: Falls eine Quelle nicht erreichbar ist, wird automatisch auf eine andere zurückgegriffen. Spielerwerte werden für 6 Stunden im Browser zwischengespeichert.

---

## 🚀 Deployment auf GitHub Pages

### Schritt 1: Repository erstellen

1. Gehe zu [github.com](https://github.com) → **New Repository**
2. Name: z.B. `dynasty-hq`
3. Sichtbarkeit: **Public** (für GitHub Pages kostenlos)
4. Klicke **Create repository**

### Schritt 2: Dateien hochladen

**Option A – Drag & Drop (einfach):**
1. Öffne dein neues Repository
2. Klicke auf **"uploading an existing file"**
3. Ziehe alle 4 Dateien hinein:
   - `index.html`
   - `style.css`
   - `app.js`
   - `api.js`
4. Klicke **Commit changes**

**Option B – Git (für Entwickler):**
```bash
git clone https://github.com/DEIN-USERNAME/dynasty-hq.git
cd dynasty-hq
# Kopiere alle Dateien hier hinein
git add .
git commit -m "Initial Dynasty HQ"
git push
```

### Schritt 3: GitHub Pages aktivieren

1. Im Repository → **Settings** → **Pages** (linke Sidebar)
2. Source: **Deploy from a branch**
3. Branch: **main** / **master**, Ordner: **/ (root)**
4. Klicke **Save**

### Schritt 4: App aufrufen

Nach 1-2 Minuten ist die App erreichbar unter:
```
https://DEIN-USERNAME.github.io/dynasty-hq/
```

---

## 📱 Nutzung

1. Sleeper-Benutzernamen eingeben
2. Spielerwert-Quelle wählen (empfohlen: KeepTradeCut)
3. Liga aus der Headerleiste wählen
4. **WIN NOW** oder **REBUILD** Modus auswählen
5. Navigation über die Tab-Leiste

---

## ⚙️ Liga-Konfiguration

Die App erkennt alle Liga-Einstellungen **automatisch** via Sleeper API:
- Anzahl Teams
- Starter-Slots
- Scoring-Regeln
- Roster-Größe

Der Rushing Attempt Bonus (Liga B: +0,15 pro Attempt) wird bei der Spielerbewertung berücksichtigt.

---

## 🔒 Datenschutz

- Keine Anmeldung erforderlich
- Keine Daten werden an Server gesendet
- Alle Daten bleiben im Browser (localStorage)
- API-Calls gehen direkt an Sleeper & KeepTradeCut

---

## 📦 Technologie

- Vanilla HTML/CSS/JavaScript (kein Framework nötig)
- [Chart.js](https://www.chartjs.org/) für Visualisierungen
- [Sleeper API](https://docs.sleeper.com/) für Ligadaten
- [KeepTradeCut](https://keeptradecut.com/) / [FantasyCalc](https://fantasycalc.com/) für Spielerwerte

---

*Dynasty HQ – Gebaut für Dynasty-Enthusiasten* ⬡
