const {
  DEFAULT_RULES,
  RULES_SCHEMA_VERSION,
  expandRule,
  migrateRules,
  normalizeRule
} = globalThis.DateExpander;

const rowsEl = document.getElementById('rows');
const statusEl = document.getElementById('status');

function makeRow(rule) {
  const normalized = normalizeRule(rule);
  const tr = document.createElement('tr');

  const trigger = document.createElement('input');
  trigger.type = 'text';
  trigger.className = 'mono trigger';
  trigger.placeholder = ':fecha';
  trigger.value = normalized.trigger;

  const mode = document.createElement('select');
  mode.className = 'mode';
  mode.append(
    new Option('Plain text', 'text'),
    new Option('Date/time', 'date')
  );
  mode.value = normalized.mode;

  const output = document.createElement('textarea');
  output.className = 'mono output';
  output.rows = 1;
  output.value = normalized.output;

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

  tr.append(td(trigger), td(mode), td(output), preview, td(remove));
  mode.addEventListener('change', () => {
    updateOutputHint(tr);
    renderPreview(tr);
  });
  output.addEventListener('input', () => renderPreview(tr));
  updateOutputHint(tr);
  renderPreview(tr);

  return tr;
}

function updateOutputHint(tr) {
  const mode = tr.querySelector('.mode').value;
  const output = tr.querySelector('.output');
  output.placeholder = mode === 'date' ? '[YYYY-MM-DD HH:mm]' : '✅ or any text';
  output.title = mode === 'date'
    ? 'Date and time tokens are expanded.'
    : 'Every character is inserted exactly as entered.';
}

function renderPreview(tr) {
  const rule = readRow(tr);
  const cell = tr.querySelector('.preview');
  cell.textContent = rule.output ? expandRule(rule, new Date()) : '—';
}

function render(rules) {
  rowsEl.replaceChildren(...rules.map(makeRow));
  if (!rules.length) {
    rowsEl.appendChild(makeRow({ trigger: '', mode: 'text', output: '' }));
  }
}

function readRow(tr) {
  return {
    trigger: tr.querySelector('.trigger').value,
    mode: tr.querySelector('.mode').value,
    output: tr.querySelector('.output').value
  };
}

function readRows() {
  return [...rowsEl.querySelectorAll('tr')].map(readRow);
}

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = kind || '';
}

// Returns an error string, or null when the list is safe to store.
function validate(rules) {
  const seen = new Set();

  for (const rule of rules) {
    if (!rule.trigger || !rule.output) {
      return 'Every rule needs both a trigger and an output.';
    }
    if (rule.trigger.trim() !== rule.trigger) {
      return `Trigger "${rule.trigger}" has leading or trailing whitespace.`;
    }
    if (seen.has(rule.trigger)) {
      return `Duplicate trigger "${rule.trigger}" — only the first would ever fire.`;
    }
    seen.add(rule.trigger);
  }

  return null;
}

document.getElementById('add').addEventListener('click', () => {
  rowsEl.appendChild(makeRow({ trigger: '', mode: 'text', output: '' }));
});

document.getElementById('save').addEventListener('click', () => {
  // A row left completely blank is treated as "never filled in", not an error.
  const rules = readRows().filter(rule => rule.trigger || rule.output);

  const error = validate(rules);
  if (error) {
    setStatus(error, 'error');
    return;
  }

  chrome.storage.sync.set({ rules, rulesSchemaVersion: RULES_SCHEMA_VERSION }, () => {
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

chrome.storage.sync.get({ rules: null, rulesSchemaVersion: 0 }, stored => {
  const migration = migrateRules(stored.rules, stored.rulesSchemaVersion);
  render(migration.rules);

  if (migration.changed) {
    chrome.storage.sync.set({
      rules: migration.rules,
      rulesSchemaVersion: RULES_SCHEMA_VERSION
    });
  }
});
