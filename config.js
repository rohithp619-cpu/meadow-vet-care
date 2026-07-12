// Frontend runtime config.
//
// apiBase = base URL of the chat backend (the Node server exposing /api/chat).
//   - Local dev (npm run dev): leave "" — the page and the API share an origin.
//   - GitHub Pages: set this to your deployed backend URL, e.g.
//       apiBase: "https://meadow-vet-care-api.onrender.com"
window.MEADOW_CONFIG = {
  apiBase: ""
};
