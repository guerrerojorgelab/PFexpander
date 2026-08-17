const { DEFAULT_RULES, formatDate } = globalThis.DateExpander;

const rowsEl = document.getElementById('rows');
const statusEl = document.getElementById('status');

function makeRow(rule) {
  const tr = document.createElement('tr');

  const trigger = document.createElement('input');
  trigger.type = 'text';
  trigger.className = 'mono trigger';
  trigger.placeholder = '<da';
  trigger.value = rule.trigger || '';

  const format = document.createElement('input');
  format.type = 'text';
  format.className = 'mono format';
  format.placeholder = '[YYYY-MM-DD HH:mm]';
  format.value = rule.format || '';

  const preview = document.createElement('td');
  preview.className = 'preview mono';

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove';
  remove.textContent = '×';
  remove.title = 'Remove this rule';
  remove.addEventListener('click', () => {
    tr.remove();
    setStatus('Removed — not saved yet.');
  });

  const td = el => {
    const cell = document.createElement('td');
    cell.appendChild(el);
    return cell;
  };

  tr.append(td(trigger), td(format), preview, td(remove));
  format.addEventListener('input', () => renderPreview(tr));
  renderPreview(tr);

  return tr;
}

function renderPreview(tr) {
  const pattern = tr.querySelector('.format').value;
  const cell = tr.querySelector('.preview');
  cell.textContent = pattern ? formatDate(pattern, new Date()) : '—';
}

function render(rules) {
  rowsEl.replaceChildren(...rules.map(makeRow));
  if (!rules.length) rowsEl.appendChild(makeRow({ trigger: '', format: '' }));
}

function readRows() {
  return [...rowsEl.querySelectorAll('tr')].map(tr => ({
    trigger: tr.querySelector('.trigger').value,
    format: tr.querySelector('.format').value
  }));
}

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = kind || '';
}

// Returns an error string, or null when the list is safe to store.
function validate(rules) {
  const seen = new Set();

  for (const rule of rules) {
    if (!rule.trigger || !rule.format) {
      return 'Every rule needs both a trigger and a format.';
    }
    if (rule.trigger.trim() !== rule.trigger) {
      return `Trigger "${rule.trigger}" has leading or trailing whitespace.`;
    }
    if (seen.has(rule.trigger)) {
      return `Duplicate trigger "${rule.trigger}" — only the first would ever fire.`;
    }
    // The expansion re-enters the input handler; a format containing its own
    // trigger would expand forever if the runtime guard were ever bypassed.
    if (rule.format.includes(rule.trigger)) {
      return `Format for "${rule.trigger}" contains the trigger itself, which would loop.`;
    }
    seen.add(rule.trigger);
  }

  return null;
}

document.getElementById('add').addEventListener('click', () => {
  rowsEl.appendChild(makeRow({ trigger: '', format: '' }));
});

document.getElementById('save').addEventListener('click', () => {
  // A row left completely blank is treated as "never filled in", not an error.
  const rules = readRows().filter(r => r.trigger || r.format);

  const error = validate(rules);
  if (error) {
    setStatus(error, 'error');
    return;
  }

  chrome.storage.sync.set({ rules }, () => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, 'error');
    } else if (!rules.length) {
      setStatus('Saved with no rules — nothing will expand.', 'ok');
    } else {
      setStatus(`Saved ${rules.length} rule${rules.length > 1 ? 's' : ''}. Active immediately in open tabs.`, 'ok');
    }
  });
});

document.getElementById('reset').addEventListener('click', () => {
  render(DEFAULT_RULES);
  setStatus('Defaults loaded — press Save to apply.');
});

chrome.storage.sync.get({ rules: DEFAULT_RULES }, stored => {
  render(Array.isArray(stored.rules) ? stored.rules : DEFAULT_RULES);
});
