const { DEFAULT_RULES, formatDate, findMatch } = globalThis.DateExpander;

// Storage reads are async but the input handler is not, so the rules are cached
// here. Without the onChanged listener below, an options change would not take
// effect until every open tab was reloaded.
let rules = DEFAULT_RULES;

chrome.storage.sync.get({ rules: DEFAULT_RULES }, stored => {
  if (Array.isArray(stored.rules)) rules = stored.rules;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.rules && Array.isArray(changes.rules.newValue)) {
    rules = changes.rules.newValue;
  }
});

// The synthetic input event below re-enters this handler. Normally that stops
// on its own because the trigger is gone, but a rule whose format contains its
// own trigger would recurse forever, so the guard is not optional.
let replacing = false;

document.addEventListener('input', function (e) {
  if (replacing) return;

  const target = e.target;
  if (target.tagName !== 'TEXTAREA' && !target.isContentEditable) return;

  const text = target.tagName === 'TEXTAREA' ? target.value : target.innerText;
  if (typeof text !== 'string') return;

  const match = findMatch(text, rules);
  if (!match) return;

  const stamp = formatDate(match.rule.format, new Date());

  // Function replacement, not a string: a format containing `$&` or `$'` would
  // otherwise be read as a substitution pattern instead of literal text.
  const replaced = text.replace(match.rule.trigger, () => stamp);

  replacing = true;
  try {
    if (target.tagName === 'TEXTAREA') {
      target.value = replaced;
    } else {
      target.innerText = replaced;

      // Fix the cursor so it doesn't jump to the beginning
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(target);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    // Force Google Sheets to register the change
    target.dispatchEvent(new Event('input', { bubbles: true }));
  } finally {
    replacing = false;
  }
}, true);
