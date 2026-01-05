# Front Detector Prototype

This repository contains a small prototype web page for connecting to a phone camera and streaming the video feed into the browser. The current goal is simply to establish a reliable connection to the camera; additional front-detection logic will be added later.

## Development

### Prerequisites
- Node.js 18+

### Setup

```bash
npm install
```

### Run the dev server

```bash
npm start
```

The dev server runs on `http://localhost:5173`.

### Telefonos elérés lépésről lépésre
1. A fejlesztő gép és a telefon legyen ugyanazon a hálózaton (Wi‑Fi).
2. Indítsd a szervert: `npm start`. A konzol kiírja a gép IPv4 címeit, pl. `http://192.168.0.42:5173`.
3. Írd be a telefon böngészőjébe az IP-t és a portot (pl. `http://192.168.0.42:5173`).
4. Engedélyezd a kamerahozzáférést a böngésző felszólítására.

### Ha időtúllépést kapsz
- Győződj meg róla, hogy a telefon ugyanazon a LAN-on van, és nincs VPN, ami elszigetelné.
- Ellenőrizd, hogy a gép tűzfala engedélyezi-e a 5173-as portot.
- Ha a böngésző HTTPS-et kér kamerához, használj tunnelt (pl. `ngrok http 5173`) és a HTTPS URL-t nyisd meg telefonon.
- Ha egy felhős/remote fejlesztői környezetet használsz (pl. devcontainer, Codespaces), a konzolban látott IP cím lehet, hogy a telefonról nem érhető el. Ilyenkor használj tunnelt (pl. `ngrok http 5173`), vagy futtasd a szervert a helyi gépeden, ahol a telefon ugyanarra a Wi‑Fi-re csatlakozik.
- Ha a telefonod „a localhost visszautasította a csatlakozást” hibát ír:
  - Ellenőrizd, hogy a szerver fut-e: `npm start` (hagy a terminálban futni), majd a gépen teszteld: `curl http://localhost:5173/`.
  - Ha a port foglalt, indítsd más porton: `PORT=5174 npm start`, és a telefonon is ezt a portot add meg.
  - Remote környezetben (pl. devcontainer) a helyi IP nem érhető el; használd a tunnel HTTPS címét.

## Notes
- The UI focuses on selecting the rear (environment) camera when available.
- The page shows the live feed and basic camera metadata so you can validate the connection before adding detection features.
