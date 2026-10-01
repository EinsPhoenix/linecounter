'use strict';

/**
 * Finds functions / methods in source code with their line range and cyclomatic complexity,
 * and the call sites of a file (name + line). Heuristic, language-agnostic regexes – good enough for statistics.
 */

const BRACE_LANGS = new Set(['JavaScript', 'JSX', 'TypeScript', 'TSX', 'Vue', 'Svelte', 'Astro', 'Java', 'Kotlin', 'Scala', 'C#', 'C', 'C++',
  'Objective-C', 'Go', 'Rust', 'Swift', 'Dart', 'PHP', 'Groovy']);
const INDENT_LANGS = new Set(['Python']);
const END_LANGS = new Set(['Ruby', 'Lua', 'Elixir', 'Julia']);
const NOT_A_NAME = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'do', 'try', 'with', 'new', 'typeof',
  'sizeof', 'await', 'yield', 'delete', 'throw', 'case', 'in', 'of', 'super', 'this', 'constructor', 'print', 'elif', 'except', 'lambda',
  'not', 'and', 'or', 'assert', 'del', 'is', 'from', 'import', 'raise', 'foreach', 'using', 'lock', 'fixed', 'when', 'match', 'loop', 'defer', 'go',
  'select', 'unless', 'until', 'def', 'fn', 'func', 'fun', 'end', 'then', 'local', 'require', 'include', 'echo', 'isset', 'empty', 'list', 'array']);

const DEF_PATTERNS = {
  js: [
    // function foo(…) / function foo<T>(…) / export default async function* foo(
    /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\s*\(/,
    // const foo = (…) => / async <T,>(…) => / function / x => / multi-line parameters "(" at the end of the line
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|(?:<[^()]*>\s*)?\((?:[^)]*\)\s*(?::[^=]+)?=>|[^)]*$)|[A-Za-z_$][\w$]*\s*=>)/,
    // const Foo = React.memo(…) / forwardRef / useCallback / useMemo / observer wrapping a function
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:[\w$]+\.)?(?:memo|forwardRef|useCallback|observer|defineComponent|debounce|throttle)\s*(?:<[^()]*>)?\(\s*(?:async\s+)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/,
    // class methods: async load(…): Promise<T> {  /  get name() {  /  static create<T>(
    /^\s*(?:(?:public|private|protected|static|async|override|readonly|get|set|abstract)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\s*\([^)]*\)\s*(?::\s*[^{=;]+)?\{\s*(?:\}\s*)?$/,
    // class fields / object properties: handle = async (…) => / handle: function (
    /^\s*(?:(?:public|private|protected|static|readonly)\s+)*([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s+)?(?:function\b|(?:<[^()]*>\s*)?\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
  ],
  py: [/^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/],
  go: [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*[(<[]/],
  rust: [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s+([A-Za-z_]\w*)/],
  kotlin: [/^\s*(?:[\w@]+\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?([A-Za-z_]\w*)\s*\(/],
  swift: [/^\s*(?:[\w@]+\s+)*func\s+([A-Za-z_]\w*)\s*[(<]/],
  php: [/^\s*(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+&?\s*([A-Za-z_]\w*)\s*\(/],
  ruby: [/^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/],
  lua: [/^\s*(?:local\s+)?function\s+(?:[\w.:]+[.:])?([A-Za-z_]\w*)\s*\(/],
  cish: [/^\s*(?:(?:public|private|protected|internal|static|final|virtual|override|abstract|async|inline|extern|const|unsafe|synchronized|sealed|partial|constexpr|friend)\s+)*(?:[\w:<>,\[\]*&?.]+\s+)+[*&]*([A-Za-z_~]\w*)\s*\([^;]*$/],
};
const KIND_OF = {
  JavaScript: 'js', JSX: 'js', TypeScript: 'js', TSX: 'js', Vue: 'js', Svelte: 'js', Astro: 'js', Dart: 'js',
  Python: 'py', Go: 'go', Rust: 'rust', Kotlin: 'kotlin', Swift: 'swift', PHP: 'php', Ruby: 'ruby', Lua: 'lua',
  Java: 'cish', 'C#': 'cish', C: 'cish', 'C++': 'cish', 'Objective-C': 'cish', Scala: 'kotlin', Groovy: 'cish',
};

/** Replaces string contents and comments by spaces (keeps line structure) so braces/keywords in them don't count. */
function blankStringsAndComments(text, kind) {
  const hash = kind === 'py' || kind === 'ruby';
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i], d = text[i + 1];
    if (!hash && c === '/' && d === '/') { while (i < n && text[i] !== '\n') { out += ' '; i++; } continue; }
    if (!hash && c === '/' && d === '*') { out += '  '; i += 2; while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { out += text[i] === '\n' ? '\n' : ' '; i++; } out += '  '; i += 2; continue; }
    if (hash && c === '#') { while (i < n && text[i] !== '\n') { out += ' '; i++; } continue; }
    if (kind === 'lua' && c === '-' && d === '-') { while (i < n && text[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '"' || c === "'" || c === '`') {
      const triple = kind === 'py' && text.startsWith(c.repeat(3), i);
      const close = triple ? c.repeat(3) : c;
      out += triple ? '   ' : c; i += close.length;
      while (i < n && !text.startsWith(close, i)) {
        if (text[i] === '\\') { out += '  '; i += 2; continue; }
        if (text[i] === '\n' && !triple && c !== '`') break;
        out += text[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (text.startsWith(close, i)) { out += close; i += close.length; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

// text right before a "{" that opens a function body (arrow, parameter list, return type, throws clause)
const BODY_START = /(=>|\)|->\s*[^{]*|\)\s*:\s*[^{]*|throws\s+[\w., ]+)\s*$/;

const DECISION = {
  default: /\b(?:if|for|foreach|while|case|catch|when)\b|&&|\|\||\?\?|\s\?\s/g,
  py: /\b(?:if|elif|for|while|except|and|or|case)\b|\bif\b.*\belse\b/g,
  ruby: /\b(?:if|elsif|unless|while|until|for|when|rescue|and|or)\b|&&|\|\|/g,
};

function complexityOf(lines, from, to, kind) {
  const re = DECISION[kind] || DECISION.default;
  let c = 1;
  for (let k = from; k <= to && k < lines.length; k++) {
    re.lastIndex = 0;
    const m = lines[k].match(re);
    if (m) c += m.length;
  }
  return c;
}

/**
 * @returns {{ name: string, line: number, end: number, lines: number, complexity: number, params: number }[]} 1-based lines
 */
function extractFunctions(text, langName, max = 400) {
  const kind = KIND_OF[langName];
  if (!kind || text.length > 800000) return [];
  const clean = blankStringsAndComments(text, kind);
  const lines = clean.split(/\r\n|\r|\n/);
  const raw = text.split(/\r\n|\r|\n/);
  const out = [];
  const patterns = DEF_PATTERNS[kind];
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const l = lines[i];
    if (l.length > 400) continue;
    let name = null, indent = 0;
    for (const re of patterns) {
      const m = re.exec(l);
      if (!m) continue;
      if (kind === 'py') { indent = m[1].replace(/\t/g, '    ').length; name = m[2]; } else name = m[1];
      break;
    }
    if (!name || NOT_A_NAME.has(name)) continue;
    let end = i;
    if (kind === 'py') {
      // body = following lines indented deeper than the def (blank lines don't end it)
      let k = i + 1;
      // skip multi-line signatures
      while (k < lines.length && !/:\s*(?:#.*)?$/.test(lines[k - 1]) && k - i < 20) k++;
      end = k - 1;
      for (; k < lines.length; k++) {
        const t = lines[k];
        if (!t.trim()) continue;
        const ind = t.match(/^\s*/)[0].replace(/\t/g, '    ').length;
        if (ind <= indent) break;
        end = k;
      }
    } else if (END_LANGS.has(langName)) {
      const ind = l.match(/^\s*/)[0].length;
      for (let k = i + 1; k < lines.length; k++) {
        if (/^\s*end\b/.test(lines[k]) && lines[k].match(/^\s*/)[0].length <= ind) { end = k; break; }
      }
    } else {
      // brace matching from the first "{" (on this line or the next few); arrow functions without braces end on their line
      let depth = 0, started = false, paren = 0;
      for (let k = i; k < lines.length && k < i + 5000; k++) {
        const t = lines[k];
        for (let c = 0; c < t.length; c++) {
          const ch = t[c];
          if (!started) {
            // before the body: skip braces of destructured parameters / inline types
            if (ch === '(') paren++;
            else if (ch === ')') paren = Math.max(0, paren - 1);
            else if (ch === '{' && (paren === 0 || BODY_START.test(t.slice(0, c)))) { depth = 1; started = true; }
            continue;
          }
          if (ch === '{') depth++; else if (ch === '}') depth--;
          if (depth === 0) { end = k; break; }
        }
        if (started && depth === 0) break;
        if (!started && k > i + 12) break;
        if (!started && paren === 0 && /=>\s*[^{\s(]/.test(t)) break; // expression-bodied arrow function
        if (!started && /;\s*$/.test(t)) break; // declaration only (C prototypes, abstract methods)
      }
      if (!started && kind === 'cish') continue;
    }
    const sig = raw[i] || '';
    const paramsMatch = sig.match(/\(([^)]*)\)/);
    const params = paramsMatch && paramsMatch[1].trim() ? paramsMatch[1].split(',').filter(p => p.trim() && !/^\s*(self|cls|this)\s*$/.test(p)).length : 0;
    out.push({ name, line: i + 1, end: end + 1, lines: end - i + 1, complexity: 1, params });
  }
  // complexity counts only the function's own lines – nested functions are measured on their own
  const perLine = lines.map((_, k) => complexityOf(lines, k, k, kind) - 1);
  for (const fn of out) {
    const children = out.filter(c => c !== fn && c.line > fn.line && c.end <= fn.end && !out.some(p => p !== fn && p !== c && p.line > fn.line && p.end <= fn.end && c.line > p.line && c.end <= p.end));
    let cx = 1;
    for (let k = fn.line; k <= fn.end - 1 && k < lines.length; k++) {
      if (children.some(c => k + 1 >= c.line && k + 1 <= c.end)) continue;
      cx += perLine[k];
    }
    fn.complexity = cx;
  }
  return out;
}

/** Call sites "name(" of a file: Map name -> [lines] (without definitions). */
function callSites(text, langName, max = 4000) {
  const kind = KIND_OF[langName];
  if (!kind || text.length > 800000) return null;
  const clean = blankStringsAndComments(text, kind);
  const lines = clean.split(/\r\n|\r|\n/);
  const calls = Object.create(null);
  let count = 0;
  const re = /(?:^|[^\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  for (let i = 0; i < lines.length && count < max; i++) {
    const l = lines[i];
    if (/^\s*(?:(?:export|default|async|public|private|static|pub)\s+)*(?:def|function|func|fn|fun)\b/.test(l)) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(l))) {
      const name = m[1];
      if (NOT_A_NAME.has(name) || name.length < 3) continue;
      (calls[name] || (calls[name] = [])).push(i + 1);
      if (++count >= max) break;
    }
    // JSX: <Component … /> counts as a call of the component
    if (kind === 'js') {
      for (const m of l.matchAll(/<([A-Z][\w$]*)(?=[\s/>.])/g)) {
        (calls[m[1]] || (calls[m[1]] = [])).push(i + 1);
        if (++count >= max) break;
      }
    }
  }
  return calls;
}

module.exports = { extractFunctions, callSites, blankStringsAndComments, KIND_OF };
