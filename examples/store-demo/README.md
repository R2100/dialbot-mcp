# Store Demo

This demo provides a realistic questionnaire for testing fast selector actions.

Start it from this directory:

```powershell
node server.mjs
```

Open `http://127.0.0.1:8765/questionnaire.html` in Chrome, then use the MCP tools to:

- Fill `#name`, `#email` and `#goal` with `browser_fill`.
- Select `#type` with a click and keyboard arrows.
- Click `#updates` and `button[type="submit"]`.
- Capture the completed page with `browser_screenshot`.

The form never sends a network request. Use fictional values when recording examples.
