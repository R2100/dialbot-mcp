# File selection and media uploads

Dialbot 0.3.0 added three generic tools. It needs no adapter and no fixed URLs per platform.

| Tool | Mode | Use |
| --- | --- | --- |
| `browser_file_inputs` | fast | Lists file inputs of the main document, even hidden ones, with selector, accept, multiple and disabled. |
| `browser_upload` | fast | Takes tabId, single selector and files with absolute paths. |
| `browser_upload_click` | both | Takes tabId, x, y and files; presses the button observed in a screenshot and answers Chrome's file chooser. |

fast example, using the selector returned by the listing:

```json
{"tabId":123,"selector":"input[type=file]","files":["C:/Users/your-user/Documents/test.png"]}
```

normal example, replacing the coordinates with those from a recent screenshot:

```json
{"tabId":123,"x":240,"y":350,"files":["C:/Users/your-user/Videos/demo.mp4"]}
```

Prompt: "Attach this file in the composer, wait for the thumbnail and stop without publishing". For normal: "Use normal mode, locate the media button in a screenshot and attach this file". The agent turns these requests into MCP calls; the extension does not interpret natural language.

## Chosen implementation

The native process validates that each path is absolute, existing, readable and a regular file. UNC paths and directories are rejected. It accepts between one and ten files; the field must allow multiple selection to receive more than one. It does not inspect content nor enforces size or codec limits: those belong to the site. Only use files the user has authorized sending to that page.

Chrome receives the paths via `DOM.setFileInputFiles` and is responsible for exposing the files to the site. The bytes do not travel through MCP nor are base64-encoded. In fast the input is resolved by selector; it does not need to be visible. In normal, `Page.setInterceptFileChooserDialog` captures the chooser triggered by the mouse click and gets its backendNodeId, without looking for selectors or reading the page. The Windows dialog never shows up. Interception and the listener are removed in finally, even on failure. The click must open the chooser within a few seconds; if it does not, an error is returned and the state must be checked before retrying.

The `selectionSent: true` result means Chrome accepted the selection. `uploadComplete: "unknown"` reminds that it does not attest transfer, processing or publication. The site may clear the input while processing the file, so the page state is the valid check. The tool does not press publish buttons; handing over files may already send them to the server or trigger other site actions.

The selection replaces the files in the input. The site may keep previous attachments in its own state: review the composition before and after. `accept` is reported as guidance; it is not considered a definitive format validation. fast selectors cover only the main document. There is no guaranteed support for out-of-process iframes, shadow DOM, folder selection or choosers not based on input file.

## Evaluated alternatives

| Technique | Assessment |
| --- | --- |
| Assigning a path to input.value from JavaScript | The browser prevents selecting local files this way. |
| File + DataTransfer and JavaScript events | Requires obtaining and transporting the bytes, consumes memory with videos and produces synthetic events; not the chosen path. |
| Chrome's native chooser via CDP | Implemented: transfers paths, allows hidden inputs and preserves the site flow. |
| Windows dialog with UI Automation and SendInput | Possible future alternative: identify the dialog belonging to Chrome, fill File name and press Open. Requires controlling focus, windows, integrity level and timings; not implemented. |
| Dragging from Explorer | Requires coordinating two windows and the destination. No advantage when a file chooser exists; not implemented. |

## Per-platform flows

On X: open the composer, identify the media control, select the file, wait for thumbnail or progress end and stop before Publish. Formats and limits may vary by account and media type.

On YouTube Studio: Create, Upload videos, select the file, complete details and audience, wait for upload and checks, review visibility. Uploading and publishing are distinct steps, but abandoning the flow can leave a private video on the channel; do not assume closing equals deleting.

On TikTok: open the desktop upload screen, select the video, wait for processing, review description and privacy and stop before publishing. Specific compatibility must be verified with the chosen account and video.

For the three flows, reading or screenshots, click, keyboard and tab activation already exist. The new piece is file selection. Progress is polled with successive reads or screenshots; selection calls do not stay open during the whole transfer. No automatic publishing nor a generic system interpreting each site's percentage has been added.

## Verification

Automated tests check local path and argument validation before any action. File selection in Chrome and the site event are verified manually; no local test proves that an external service received or processed a file.

After updating, reload the extension and restart the MCP client to load the current tool catalog. It requires no new Chrome permissions and no dependencies.