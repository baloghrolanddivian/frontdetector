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

The dev server runs on `http://localhost:5173`. For camera access on a physical phone, make sure the phone can reach your development machine and open the site over `http://<your-ip>:5173`. Modern browsers only allow camera access over secure contexts; `localhost` is treated as secure, but for LAN access use `https` (via a tunnel such as `ngrok`) if the browser blocks camera access over plain HTTP.

## Notes
- The UI focuses on selecting the rear (environment) camera when available.
- The page shows the live feed and basic camera metadata so you can validate the connection before adding detection features.
