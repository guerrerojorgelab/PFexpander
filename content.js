const {
  DEFAULT_RULES,
  RULES_SCHEMA_VERSION,
  expandRule,
  findEndingMatch,
  migrateRules,
  normalizeRules
} = globalThis.DateExpander;

// Storage reads are async but the input handler is not, so the rules are cached
// here. Without the onChanged listener below, an options change would not take
// effect until every open tab was reloaded.
let rules = DEFAULT_RULES;

chrome.storage.sync.get({ rules: null, rulesSchemaVersion: 0 }, stored => {
  const migration = migrateRules(stored.rules, stored.rulesSchemaVersion);
  rules = migration.rules;

  if (migration.changed) {
    chrome.storage.sync.set({
      rules,
      rulesSchemaVersion: RULES_SCHEMA_VERSION
    });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.rules && Array.isArray(changes.rules.newValue)) {
    rules = normalizeRules(changes.rules.newValue);
  }
});

// Replacement emits an input event so frameworks can update their state.
let replacing = false;
let keyboardSequence = 0;
const typingState = new WeakMap();
const replacementEvents = new WeakSet();

const TEXT_INPUT_TYPES = new Set([
  'email',
  'password',
  'search',
  'tel',
  'text',
  'url'
]);

function isTextControl(element) {
  return element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(element.type));
}

function isGoogleTextEventFrame() {
  try {
    const frame = window.frameElement;
    if (frame?.classList) {
      return [...frame.classList].some(name =>
        name.includes('docs-texteventtarget-iframe'));
    }
  } catch (_error) {
    // Cross-origin parents can block frameElement access.
  }

  return /https:\/\/docs\.google\.com\/(document|presentation|spreadsheets)\//
    .test(document.referrer);
}

function editableHostFromElement(element, allowVirtual) {
  if (!(element instanceof Element)) return null;
  if (isTextControl(element)) return element;

  if (element.isContentEditable) {
    let host = element;
    while (host.parentElement && host.parentElement.isContentEditable) {
      host = host.parentElement;
    }
    return host;
  }

  if (allowVirtual && element.getAttribute('role') === 'textbox') {
    return element;
  }

  return null;
}

function editableFromEvent(event) {
  const allowVirtual = isGoogleTextEventFrame();
  const path = typeof event.composedPath === 'function'
    ? event.composedPath()
    : [event.target];

  for (const item of path) {
    const host = editableHostFromElement(item, allowVirtual);
    if (host) return host;
  }

  const activeHost = editableHostFromElement(document.activeElement, allowVirtual);
  if (activeHost) return activeHost;

  // Slides can leave the iframe body itself as the active keyboard sink.
  if (allowVirtual && document.activeElement instanceof Element) {
    return document.activeElement;
  }

  if (document.designMode === 'on') return document.body;
  return null;
}

function getState(target) {
  let state = typingState.get(target);
  if (!state) {
    state = { buffer: '', keyBuffer: '', pending: null, waitingKey: null };
    typingState.set(target, state);
  }
  return state;
}

function maxTriggerLength() {
  return rules.reduce((max, rule) =>
    rule && rule.trigger ? Math.max(max, rule.trigger.length) : max, 0);
}

function appendToBuffer(buffer, text) {
  const limit = maxTriggerLength();
  if (!limit) return '';
  return (buffer + text).slice(-limit);
}

function makeInputEvent(text) {
  try {
    return new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: text,
      inputType: 'insertReplacementText'
    });
  } catch (_error) {
    return new Event('input', { bubbles: true, composed: true });
  }
}

function dispatchReplacement(target, stamp) {
  const event = makeInputEvent(stamp);
  replacementEvents.add(event);

  // Let the canceled beforeinput event finish before the replacement input
  // event reaches the page.
  setTimeout(() => target.dispatchEvent(event), 0);
}

function textControlSelection(target) {
  try {
    if (Number.isInteger(target.selectionStart) &&
        Number.isInteger(target.selectionEnd)) {
      return { start: target.selectionStart, end: target.selectionEnd };
    }
  } catch (_error) {
    // Some input types expose value but do not expose a text selection.
  }
  return null;
}

function replaceTextControlRange(target, start, end, stamp) {
  try {
    target.setRangeText(stamp, start, end, 'end');
  } catch (_error) {
    // Email inputs do not support setRangeText. This fallback applies when the
    // trigger is at the end because those inputs do not expose a caret offset.
    target.value = target.value.slice(0, start) + stamp + target.value.slice(end);
  }
  dispatchReplacement(target, stamp);
}

function selectionRangeInside(host) {
  const selection = host.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) {
    return null;
  }
  return range;
}

function lastTextNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return node;

  for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
    const text = lastTextNode(node.childNodes[index]);
    if (text) return text;
  }
  return null;
}

function previousTextNode(container, offset, root) {
  let node = container;
  let childOffset = offset;

  if (node.nodeType === Node.TEXT_NODE) {
    childOffset = Array.prototype.indexOf.call(node.parentNode.childNodes, node);
    node = node.parentNode;
  }

  while (node && node !== root) {
    if (childOffset > 0) {
      const text = lastTextNode(node.childNodes[childOffset - 1]);
      if (text) return text;
      childOffset -= 1;
      continue;
    }

    const parent = node.parentNode;
    if (!parent) return null;
    childOffset = Array.prototype.indexOf.call(parent.childNodes, node);
    node = parent;
  }

  if (node === root && childOffset > 0) {
    for (let index = childOffset - 1; index >= 0; index -= 1) {
      const text = lastTextNode(root.childNodes[index]);
      if (text) return text;
    }
  }

  return null;
}

function moveRangeStartBackward(range, host, count) {
  let container = range.startContainer;
  let offset = range.startOffset;
  let remaining = count;

  while (remaining > 0) {
    if (container.nodeType === Node.TEXT_NODE && offset > 0) {
      const amount = Math.min(offset, remaining);
      offset -= amount;
      remaining -= amount;
      continue;
    }

    const previous = previousTextNode(container, offset, host);
    if (!previous) return false;
    container = previous;
    offset = previous.data.length;
  }

  range.setStart(container, offset);
  return true;
}

function insertIntoContentEditable(target, range, stamp) {
  range.deleteContents();
  const text = target.ownerDocument.createTextNode(stamp);
  range.insertNode(text);
  range.setStartAfter(text);
  range.collapse(true);

  const selection = target.ownerDocument.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  dispatchReplacement(target, stamp);
}

function contentBeforeCaret(target, range) {
  const before = range.cloneRange();
  before.selectNodeContents(target);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString();
}

function replaceExistingTrigger(target, stamp) {
  if (isTextControl(target)) {
    const selection = textControlSelection(target);

    if (selection) {
      const before = target.value.slice(0, selection.start);
      const match = findEndingMatch(before, rules);
      if (!match) return false;

      replaceTextControlRange(
        target,
        selection.start - match.rule.trigger.length,
        selection.start,
        stamp
      );
      return true;
    }

    const match = findEndingMatch(target.value, rules);
    if (!match) return false;
    replaceTextControlRange(target, match.index, target.value.length, stamp);
    return true;
  }

  const range = selectionRangeInside(target);
  if (!range || !range.collapsed) return false;

  const match = findEndingMatch(contentBeforeCaret(target, range), rules);
  if (!match) return false;

  if (!moveRangeStartBackward(range, target, match.rule.trigger.length)) {
    return false;
  }

  insertIntoContentEditable(target, range, stamp);
  return true;
}

function replacePendingCharacter(event, target, stamp) {
  if (!event.cancelable || typeof event.data !== 'string' || !event.data) {
    return false;
  }

  if (isTextControl(target)) {
    const selection = textControlSelection(target);
    if (!selection) return false;

    const before = target.value.slice(0, selection.start) + event.data;
    const match = findEndingMatch(before, rules);
    if (!match || event.data.length > match.rule.trigger.length) return false;

    event.preventDefault();
    replaceTextControlRange(
      target,
      selection.start - (match.rule.trigger.length - event.data.length),
      selection.end,
      stamp
    );
    return true;
  }

  const range = selectionRangeInside(target);
  if (!range || !range.collapsed) return false;

  const before = contentBeforeCaret(target, range) + event.data;
  const match = findEndingMatch(before, rules);
  if (!match || event.data.length > match.rule.trigger.length) return false;

  if (!moveRangeStartBackward(
    range,
    target,
    match.rule.trigger.length - event.data.length
  )) {
    return false;
  }

  event.preventDefault();
  insertIntoContentEditable(target, range, stamp);
  return true;
}

// Google Docs and Slides can keep the document text outside the event target.
// Browser edit commands let those editors apply the change to their own model.
function replaceThroughEditorCommands(target, triggerLength, stamp) {
  if (target.ownerDocument.activeElement !== target &&
      !target.contains(target.ownerDocument.activeElement)) {
    return false;
  }

  let deleted = 0;
  while (deleted < triggerLength) {
    if (!target.ownerDocument.execCommand('delete', false, null)) break;
    deleted += 1;
  }

  if (deleted !== triggerLength) return false;
  return target.ownerDocument.execCommand('insertText', false, stamp);
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

// Zero holds the whole backspace-then-type sequence inside one task, so the
// browser paints the finished text once instead of animating the trigger away
// one character at a time. Any value above zero yields to the event loop
// between keystrokes and brings that visible typing back; raise it only if an
// editor turns out to drop keys delivered this fast.
const KEY_DELAY_MS = 0;

async function paceKeystrokes() {
  if (KEY_DELAY_MS > 0) await wait(KEY_DELAY_MS);
}

function dispatchGoogleKeyboardEvent(target, type, init) {
  const view = target.ownerDocument.defaultView;
  const keyCode = init.keyCode || 0;
  const event = new view.KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view,
    key: init.key,
    code: init.code || '',
    keyCode,
    which: keyCode,
    charCode: init.charCode ?? keyCode
  });

  // Google Workspace still reads legacy keyboard fields in its event router.
  try {
    Object.defineProperties(event, {
      keyCode: { value: keyCode },
      which: { value: keyCode },
      charCode: { value: init.charCode ?? keyCode },
      key: { value: init.key },
      code: { value: init.code || '' }
    });
  } catch (_error) {
    // Constructor values remain available if Chrome rejects redefinition.
  }

  target.dispatchEvent(event);
}

function keyCodeForCharacter(character) {
  if (/^[a-z]$/i.test(character)) return character.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(character)) return character.charCodeAt(0);
  if (character === ' ') return 32;
  return character.codePointAt(0);
}

// Slides routes text through key events instead of a mutable DOM value. Use the
// iframe's own KeyboardEvent constructor so its event router accepts the input.
// Slides handles each event synchronously, so at the default pacing the entire
// sequence lands before the editor yields and the user sees only the result.
async function replaceThroughGoogleKeyboard(target, triggerLength, stamp) {
  for (let index = 0; index < triggerLength; index += 1) {
    dispatchGoogleKeyboardEvent(target, 'keydown', {
      key: 'Backspace',
      code: 'Backspace',
      keyCode: 8,
      charCode: 0
    });
    await paceKeystrokes();
  }

  const output = String(stamp).replace(/\r\n?/g, '\n');
  for (const character of output) {
    if (character === '\n') {
      dispatchGoogleKeyboardEvent(target, 'keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        charCode: 13
      });
    } else {
      const keyCode = keyCodeForCharacter(character);
      dispatchGoogleKeyboardEvent(target, 'keypress', {
        key: character,
        keyCode,
        charCode: keyCode
      });
    }
    await paceKeystrokes();
  }

  return true;
}

function updateBufferFromInput(state, event) {
  if (state.pending && state.pending.data === event.data) {
    state.buffer = state.pending.buffer;
    state.pending = null;
    return;
  }

  state.pending = null;
  if (event.inputType && event.inputType.startsWith('insert') &&
      typeof event.data === 'string') {
    state.buffer = appendToBuffer(state.buffer, event.data);
  } else if (event.inputType === 'deleteContentBackward') {
    state.buffer = state.buffer.slice(0, -1);
  } else {
    state.buffer = '';
  }
}

document.addEventListener('beforeinput', event => {
  if (replacing || event.isComposing ||
      !event.inputType || !event.inputType.startsWith('insert') ||
      typeof event.data !== 'string') {
    return;
  }

  const target = editableFromEvent(event);
  if (!target || target.readOnly || target.disabled) return;

  const state = getState(target);
  state.pending = {
    data: event.data,
    buffer: appendToBuffer(state.buffer, event.data)
  };

  const directText = isTextControl(target)
    ? target.value.slice(0, textControlSelection(target)?.start ?? 0) + event.data
    : (() => {
        const range = selectionRangeInside(target);
        return range ? contentBeforeCaret(target, range) + event.data : '';
      })();
  const match = findEndingMatch(directText, rules);
  if (!match) return;

  const stamp = expandRule(match.rule, new Date());
  replacing = true;
  try {
    if (replacePendingCharacter(event, target, stamp)) {
      state.buffer = '';
      state.keyBuffer = '';
      state.pending = null;
      state.waitingKey = null;
    }
  } finally {
    replacing = false;
  }
}, true);

document.addEventListener('input', event => {
  if (replacing || replacementEvents.has(event)) return;

  const target = editableFromEvent(event);
  if (!target || target.readOnly || target.disabled || event.isComposing) return;

  const state = getState(target);
  state.waitingKey = null;
  updateBufferFromInput(state, event);

  let match = null;
  if (isTextControl(target)) {
    const selection = textControlSelection(target);
    const before = selection
      ? target.value.slice(0, selection.start)
      : target.value;
    match = findEndingMatch(before, rules);
  } else {
    const range = selectionRangeInside(target);
    if (range) match = findEndingMatch(contentBeforeCaret(target, range), rules);
  }

  const bufferedMatch = findEndingMatch(state.buffer, rules);
  const rule = match?.rule || bufferedMatch?.rule;
  if (!rule) return;

  const stamp = expandRule(rule, new Date());

  if (!match) {
    state.buffer = '';
    state.keyBuffer = '';
    state.pending = null;
    setTimeout(async () => {
      replacing = true;
      try {
        if (isGoogleTextEventFrame()) {
          await replaceThroughGoogleKeyboard(target, rule.trigger.length, stamp);
        } else if (!replaceExistingTrigger(target, stamp)) {
          replaceThroughEditorCommands(target, rule.trigger.length, stamp);
        }
      } finally {
        replacing = false;
      }
    }, 0);
    return;
  }

  replacing = true;
  try {
    const replaced = replaceExistingTrigger(target, stamp);
    if (replaced) {
      state.buffer = '';
      state.keyBuffer = '';
    }
    state.pending = null;
  } finally {
    replacing = false;
  }
}, true);

document.addEventListener('keydown', event => {
  if (replacing) return;

  const target = editableFromEvent(event);
  if (!target || target.readOnly || target.disabled) return;

  const state = getState(target);
  if (['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Home',
    'PageDown', 'PageUp'].includes(event.key)) {
    state.buffer = '';
    state.keyBuffer = '';
    state.pending = null;
    state.waitingKey = null;
    return;
  }

  if (event.key === 'Backspace') {
    state.keyBuffer = state.keyBuffer.slice(0, -1);
    return;
  }

  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
      event.key.length !== 1) {
    return;
  }

  state.keyBuffer = appendToBuffer(state.keyBuffer, event.key);
  const match = findEndingMatch(state.keyBuffer, rules);
  if (!match) return;

  const token = ++keyboardSequence;
  state.waitingKey = token;
  const stamp = expandRule(match.rule, new Date());

  // Some virtual editors consume key events without emitting input events.
  // Run the edit command after the editor processes the final trigger key.
  setTimeout(async () => {
    if (state.waitingKey !== token) return;

    state.waitingKey = null;
    state.buffer = '';
    state.keyBuffer = '';
    replacing = true;
    try {
      if (isGoogleTextEventFrame()) {
        await replaceThroughGoogleKeyboard(target, match.rule.trigger.length, stamp);
      } else if (!replaceExistingTrigger(target, stamp)) {
        replaceThroughEditorCommands(target, match.rule.trigger.length, stamp);
      }
    } finally {
      replacing = false;
    }
  }, 0);
}, true);

document.addEventListener('pointerdown', event => {
  const target = editableFromEvent(event);
  if (target) {
    const state = getState(target);
    state.buffer = '';
    state.keyBuffer = '';
    state.pending = null;
    state.waitingKey = null;
  }
}, true);
