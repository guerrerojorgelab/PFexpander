// Shared by the content script and the options page, so the live preview in the
// options GUI is produced by the same code that does the real expansion.

(function (root) {
  const RULES_SCHEMA_VERSION = 4;
  const LEGACY_CHECK_MARK_RULE = {
    trigger: ':white_check_mark:',
    mode: 'text',
    output: '✅'
  };
  const PASS_RULE = { trigger: ':pass', mode: 'text', output: '✅' };
  const FAIL_RULE = { trigger: ':fail', mode: 'text', output: '❌' };
  const DEFAULT_RULES = [
    { trigger: ':fecha', mode: 'date', output: '[YYYY-MM-DD HH:mm]' },
    PASS_RULE,
    FAIL_RULE
  ];

  const TOKENS = {
    YYYY: d => String(d.getFullYear()),
    YY: d => String(d.getFullYear()).slice(-2),
    MM: d => String(d.getMonth() + 1).padStart(2, '0'),
    DD: d => String(d.getDate()).padStart(2, '0'),
    HH: d => String(d.getHours()).padStart(2, '0'),
    hh: d => String(d.getHours() % 12 || 12).padStart(2, '0'),
    mm: d => String(d.getMinutes()).padStart(2, '0'),
    ss: d => String(d.getSeconds()).padStart(2, '0'),
    A: d => (d.getHours() < 12 ? 'AM' : 'PM')
  };

  // One pass over the pattern: every token is consumed exactly once, so a
  // substituted value is never rescanned by a later token. The leading escape
  // branch consumes `\x` first, which is how a literal "mm" survives as `\m\m`.
  // Longer tokens precede their prefixes (YYYY before YY) so the greedy
  // alternation picks the right one.
  const TOKEN_RE = /\\([\s\S])|YYYY|YY|MM|DD|HH|hh|mm|ss|A/g;

  function formatDate(pattern, date) {
    return String(pattern).replace(TOKEN_RE, (match, escaped) =>
      escaped !== undefined ? escaped : TOKENS[match](date)
    );
  }

  function normalizeRule(rule) {
    const source = rule && typeof rule === 'object' ? rule : {};
    const hasLegacyFormat = Object.prototype.hasOwnProperty.call(source, 'format');
    const mode = source.mode === 'text' || source.mode === 'date'
      ? source.mode
      : hasLegacyFormat ? 'date' : 'text';
    const rawOutput = Object.prototype.hasOwnProperty.call(source, 'output')
      ? source.output
      : source.format;

    return {
      trigger: source.trigger == null ? '' : String(source.trigger),
      mode,
      output: rawOutput == null ? '' : String(rawOutput)
    };
  }

  function normalizeRules(value) {
    return Array.isArray(value) ? value.map(normalizeRule) : [];
  }

  function expandRule(rule, date) {
    const normalized = normalizeRule(rule);
    return normalized.mode === 'date'
      ? formatDate(normalized.output, date)
      : normalized.output;
  }

  // Version 2 separates literal text from date templates. Version 3 renames the
  // date trigger. Version 4 renames the pass trigger and adds the fail trigger.
  function migrateRules(storedRules, storedVersion) {
    const version = Number.isInteger(storedVersion) ? storedVersion : 0;
    const hasStoredRules = Array.isArray(storedRules);
    const source = hasStoredRules ? storedRules : DEFAULT_RULES;
    const rules = normalizeRules(source);
    let changed = !hasStoredRules ||
      JSON.stringify(source) !== JSON.stringify(rules) ||
      version !== RULES_SCHEMA_VERSION;

    if (hasStoredRules && version < 2 &&
        !rules.some(rule =>
          rule.trigger === LEGACY_CHECK_MARK_RULE.trigger ||
          rule.trigger === PASS_RULE.trigger)) {
      rules.push(normalizeRule(LEGACY_CHECK_MARK_RULE));
      changed = true;
    }

    if (hasStoredRules && version < 3) {
      const oldDefault = rules.find(rule =>
        rule.trigger === '<da' &&
        rule.mode === 'date' &&
        rule.output === '[YYYY-MM-DD HH:mm]');
      if (oldDefault) {
        oldDefault.trigger = ':fecha';
        changed = true;
      }
    }

    if (hasStoredRules && version < 4) {
      const oldPassIndex = rules.findIndex(rule =>
        rule.trigger === LEGACY_CHECK_MARK_RULE.trigger &&
        rule.mode === LEGACY_CHECK_MARK_RULE.mode &&
        rule.output === LEGACY_CHECK_MARK_RULE.output);

      if (oldPassIndex !== -1) {
        if (rules.some(rule => rule.trigger === PASS_RULE.trigger)) {
          rules.splice(oldPassIndex, 1);
        } else {
          rules[oldPassIndex].trigger = PASS_RULE.trigger;
        }
        changed = true;
      }

      if (!rules.some(rule => rule.trigger === FAIL_RULE.trigger)) {
        rules.push(normalizeRule(FAIL_RULE));
        changed = true;
      }
    }

    return { rules, changed, version: RULES_SCHEMA_VERSION };
  }

  // Earliest occurrence in the text wins. On a tie the longer trigger wins, so
  // `<dat` beats `<da` when both are configured and both start at the same spot.
  function findMatch(text, rules) {
    let best = null;

    for (const rule of rules) {
      if (!rule || !rule.trigger) continue;

      const index = text.indexOf(rule.trigger);
      if (index === -1) continue;

      const better =
        !best ||
        index < best.index ||
        (index === best.index && rule.trigger.length > best.rule.trigger.length);

      if (better) best = { index, rule };
    }

    return best;
  }

  // Match only at the caret. The longest trigger wins when one trigger is a
  // suffix of another trigger.
  function findEndingMatch(text, rules) {
    let best = null;

    for (const rule of rules) {
      if (!rule || !rule.trigger || !text.endsWith(rule.trigger)) continue;

      if (!best || rule.trigger.length > best.rule.trigger.length) {
        best = { index: text.length - rule.trigger.length, rule };
      }
    }

    return best;
  }

  root.DateExpander = {
    RULES_SCHEMA_VERSION,
    PASS_RULE,
    FAIL_RULE,
    DEFAULT_RULES,
    TOKENS,
    formatDate,
    normalizeRule,
    normalizeRules,
    expandRule,
    migrateRules,
    findMatch,
    findEndingMatch
  };
})(globalThis);
