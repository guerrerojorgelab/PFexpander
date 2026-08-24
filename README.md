# PF Expander

Typing `:fecha` inserts the current local date and time, formatted `[YYYY-MM-DD HH:mm]`. Typing `:pass` inserts `✅`, and typing `:fail` inserts `❌`.

The extension supports single-line inputs, textareas, contenteditable editors, Google Sheets, Google Docs, and Google Slides. Plain-text rules preserve Unicode, punctuation, whitespace, line breaks, and date-like text exactly.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. Reload any tab that was already open — content scripts only inject on load.

After editing `content.js`, hit the reload arrow on the extension card, then reload the tab.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | Manifest V3 declaration; injects the scripts into every page and related frame |
| `format.js` | Shared date formatting and trigger matching |
| `content.js` | Caret-aware text replacement and virtual-editor support |
| `tests/format.test.js` | Trigger matching unit tests |
| `tests/browser-smoke.mjs` | Chrome integration tests for supported edit surfaces |

## Test

Run both test levels from this folder:

```bash
node --test tests/format.test.js
node tests/browser-smoke.mjs
```

## Behaviour notes

- **Time is local, 24-hour.** `getHours()` returns 0–23, from the machine's timezone. For UTC use `getUTCHours()` / `getUTCMinutes()` (and the UTC date getters, or the date will drift out of sync with the time).
- **The trigger must end at the caret.** Existing trigger text elsewhere in the editor remains unchanged.
- **The caret stays after the stamp.** Text after the caret remains in place.
- **Plain text is literal.** Select **Plain text** to prevent date-token processing in the output.
- **Date and time output expands tokens.** Select **Date/time** when the output uses tokens such as `YYYY`, `MM`, or `HH`.
- **Google editors use a typing buffer.** This supports editor surfaces that keep document text outside the event target.
- **Google Slides uses its text-event iframe.** The extension sends replacement keystrokes through the active Slides textbox. The whole sequence runs in one task, so the editor paints the finished text once instead of showing the trigger being deleted character by character. To slow it down, raise `KEY_DELAY_MS` in `content.js`.
- **Chrome internal pages are excluded.** Chrome does not allow extensions to run on pages such as `chrome://extensions` or the Chrome Web Store.

## Narrowing the scope

`<all_urls>` means the script runs everywhere, which is why Chrome warns about reading data on all sites. To restrict it to Google Sheets, replace the `matches` array in `manifest.json` with `["https://docs.google.com/spreadsheets/*"]`.

## Icons

None are declared, so Chrome shows a default placeholder. To add one, drop a PNG in the folder and declare it under an `icons` key with the pixel size as the property name.
