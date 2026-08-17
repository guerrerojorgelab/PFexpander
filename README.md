# Date Expander

Typing `<da` in a textarea or a contenteditable field replaces it with the current local date and time, formatted `[YYYY-MM-DD HH:mm]`.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this `date-expander/` folder.
4. Reload any tab that was already open — content scripts only inject on load.

After editing `content.js`, hit the reload arrow on the extension card, then reload the tab.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | Manifest V3 declaration; injects `content.js` into every page, all frames |
| `content.js` | The capture-phase `input` listener that does the replacement |

## Behaviour notes

- **Time is local, 24-hour.** `getHours()` returns 0–23, from the machine's timezone. For UTC use `getUTCHours()` / `getUTCMinutes()` (and the UTC date getters, or the date will drift out of sync with the time).
- **`<input>` fields are not covered.** The guard matches `TEXTAREA` and `isContentEditable` only. Most single-line boxes — including the Google Sheets formula bar — are `<input>`. To cover them, add `target.tagName === 'INPUT'` to the condition; the existing `.value` branch already handles them correctly.
- **The caret lands at the end** of a textarea after replacement, because assigning `.value` resets the selection. Only noticeable when expanding mid-text.
- **Only the first `<da` in the field is replaced** per input event. That is normally what you want, since the trigger fires the moment you type the `a`.

## Narrowing the scope

`<all_urls>` means the script runs everywhere, which is why Chrome warns about reading data on all sites. To restrict it to Google Sheets, replace the `matches` array in `manifest.json` with `["https://docs.google.com/spreadsheets/*"]`.

## Icons

None are declared, so Chrome shows a default placeholder. To add one, drop a PNG in the folder and declare it under an `icons` key with the pixel size as the property name.
