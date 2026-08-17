// Shared by the content script and the options page, so the live preview in the
// options GUI is produced by the same code that does the real expansion.

(function (root) {
  const DEFAULT_RULES = [
    { trigger: '<da', format: '[YYYY-MM-DD HH:mm]' }
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

  root.DateExpander = { DEFAULT_RULES, TOKENS, formatDate, findMatch };
})(globalThis);
