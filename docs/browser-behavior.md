# Browser behavior

Dialbot preserves Chrome's engine, profile, network and native APIs. Page requests are made from the browser; the local bridge carries commands and results.

## Interaction modes

- **fast** prioritizes DOM reading and selector-based actions.
- **normal** uses screenshots, mouse and keyboard to interact with content, and blocks the MCP session's DOM tools.

Modes do not modify the browser identity. Switching to normal does not undo previous actions nor guarantees avoiding detection.

The diagnostic crosshair is an observable DOM overlay, enabled by default in fast. In normal it is hidden unless explicitly activated. Human motion uses smoothed Gaussian noise, acceleration/deceleration and final correction; the optional warm-up generates movements without presses. Its timings are bounded and do not constitute a validated human behavior model.

## Tests and scope

Automated tests cover logic, validation and protocol with test doubles; full integration with Chrome is verified manually. They do not cover every browser surface nor certify compatibility with every site or undetectability against external services.

Dialbot includes no identity patches, profile rotation or CAPTCHA solving. Browser-driven input does not move the physical Windows cursor nor control system dialogs.