'use strict';

// Comment syntax presets
const C_STYLE = { line: ['//'], block: [['/*', '*/']] };
const HASH = { line: ['#'], block: [] };
const HTML = { line: [], block: [['<!--', '-->']] };
const SQL = { line: ['--'], block: [['/*', '*/']] };
const NONE = { line: [], block: [] };

// name, comment syntax, extensions (lowercase, without dot), special file names
const LANGUAGES = [
  ['JavaScript', C_STYLE, ['js', 'mjs', 'cjs']],
  ['JSX', C_STYLE, ['jsx']],
  ['TypeScript', C_STYLE, ['ts', 'mts', 'cts']],
  ['TSX', C_STYLE, ['tsx']],
  ['Python', { line: ['#'], block: [['"""', '"""'], ["'''", "'''"]] }, ['py', 'pyw', 'pyi']],
  ['Jupyter Notebook', NONE, ['ipynb']],
  ['Java', C_STYLE, ['java']],
  ['Kotlin', C_STYLE, ['kt', 'kts']],
  ['Scala', C_STYLE, ['scala', 'sc']],
  ['Groovy', C_STYLE, ['groovy', 'gradle']],
  ['C', C_STYLE, ['c', 'h']],
  ['C++', C_STYLE, ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx', 'ino']],
  ['C#', C_STYLE, ['cs', 'csx']],
  ['Objective-C', C_STYLE, ['m', 'mm']],
  ['Go', C_STYLE, ['go']],
  ['Rust', C_STYLE, ['rs']],
  ['Swift', C_STYLE, ['swift']],
  ['Dart', C_STYLE, ['dart']],
  ['PHP', { line: ['//', '#'], block: [['/*', '*/']] }, ['php', 'phtml']],
  ['Ruby', { line: ['#'], block: [['=begin', '=end']] }, ['rb', 'rake', 'gemspec'], ['Gemfile', 'Rakefile']],
  ['Perl', HASH, ['pl', 'pm']],
  ['Lua', { line: ['--'], block: [['--[[', ']]']] }, ['lua']],
  ['R', HASH, ['r']],
  ['Julia', { line: ['#'], block: [['#=', '=#']] }, ['jl']],
  ['Haskell', { line: ['--'], block: [['{-', '-}']] }, ['hs']],
  ['Elixir', HASH, ['ex', 'exs']],
  ['Erlang', { line: ['%'], block: [] }, ['erl', 'hrl']],
  ['Clojure', { line: [';'], block: [] }, ['clj', 'cljs', 'cljc', 'edn']],
  ['F#', { line: ['//'], block: [['(*', '*)']] }, ['fs', 'fsx', 'fsi']],
  ['OCaml', { line: [], block: [['(*', '*)']] }, ['ml', 'mli']],
  ['Zig', C_STYLE, ['zig']],
  ['Nim', HASH, ['nim']],
  ['V', C_STYLE, ['v']],
  ['Solidity', C_STYLE, ['sol']],
  ['Assembly', { line: [';', '#'], block: [] }, ['asm', 's']],
  ['Shell', HASH, ['sh', 'bash', 'zsh', 'fish', 'ksh']],
  ['PowerShell', { line: ['#'], block: [['<#', '#>']] }, ['ps1', 'psm1', 'psd1']],
  ['Batch', { line: ['REM ', 'rem ', '::'], block: [] }, ['bat', 'cmd']],
  ['HTML', HTML, ['html', 'htm', 'xhtml']],
  ['Vue', { line: ['//'], block: [['<!--', '-->'], ['/*', '*/']] }, ['vue']],
  ['Svelte', { line: ['//'], block: [['<!--', '-->'], ['/*', '*/']] }, ['svelte']],
  ['Astro', { line: ['//'], block: [['<!--', '-->'], ['/*', '*/']] }, ['astro']],
  ['CSS', { line: [], block: [['/*', '*/']] }, ['css']],
  ['SCSS', C_STYLE, ['scss', 'sass']],
  ['Less', C_STYLE, ['less']],
  ['XML', HTML, ['xml', 'xsd', 'xsl', 'svg', 'plist', 'csproj', 'fsproj', 'vbproj', 'props', 'targets', 'resx']],
  ['JSON', NONE, ['json', 'jsonc', 'json5', 'geojson']],
  ['YAML', HASH, ['yml', 'yaml']],
  ['TOML', HASH, ['toml']],
  ['INI', { line: [';', '#'], block: [] }, ['ini', 'cfg', 'conf', 'properties', 'env']],
  ['Markdown', HTML, ['md', 'markdown', 'mdx']],
  ['reStructuredText', NONE, ['rst']],
  ['Text', NONE, ['txt', 'text', 'log']],
  ['CSV', NONE, ['csv', 'tsv']],
  ['SQL', SQL, ['sql', 'psql', 'mysql']],
  ['GraphQL', HASH, ['graphql', 'gql']],
  ['Protobuf', C_STYLE, ['proto']],
  ['Dockerfile', HASH, ['dockerfile'], ['Dockerfile', 'Containerfile']],
  ['Makefile', HASH, ['mk', 'mak'], ['Makefile', 'makefile', 'GNUmakefile']],
  ['CMake', HASH, ['cmake'], ['CMakeLists.txt']],
  ['Terraform', { line: ['#', '//'], block: [['/*', '*/']] }, ['tf', 'tfvars', 'hcl']],
  ['Nix', { line: ['#'], block: [['/*', '*/']] }, ['nix']],
  ['LaTeX', { line: ['%'], block: [] }, ['tex', 'sty', 'cls', 'bib']],
  ['Visual Basic', { line: ["'"], block: [] }, ['vb', 'vbs', 'bas']],
  ['Pascal', { line: ['//'], block: [['{', '}'], ['(*', '*)']] }, ['pas', 'pp']],
  ['Fortran', { line: ['!'], block: [] }, ['f', 'f90', 'f95', 'for']],
  ['GLSL', C_STYLE, ['glsl', 'vert', 'frag', 'hlsl', 'shader', 'wgsl']],
  ['Handlebars', { line: [], block: [['{{!--', '--}}'], ['<!--', '-->']] }, ['hbs', 'handlebars', 'mustache']],
  ['Pug', { line: ['//'], block: [] }, ['pug', 'jade']],
  ['Razor', { line: [], block: [['@*', '*@'], ['<!--', '-->']] }, ['cshtml', 'razor']],
  ['Twig', { line: [], block: [['{#', '#}']] }, ['twig']],
  ['Jinja', { line: [], block: [['{#', '#}']] }, ['j2', 'jinja', 'jinja2']],
  ['Prisma', C_STYLE, ['prisma']],
  ['Gitignore & Co', HASH, [], ['.gitignore', '.dockerignore', '.npmignore', '.gitattributes', '.editorconfig', '.prettierignore', '.eslintignore']],
];

const byExt = new Map();
const byName = new Map();
for (const [name, comments, exts, names] of LANGUAGES) {
  const lang = { name, comments };
  for (const e of exts) byExt.set(e, lang);
  for (const n of names || []) byName.set(n, lang);
}

const UNKNOWN = { name: 'Other', comments: NONE };

/** Extension label as shown in the UI, e.g. ".ts" or "(no extension)" */
function extensionOf(fileName) {
  const i = fileName.lastIndexOf('.');
  if (i <= 0 || i === fileName.length - 1) return '(none)';
  return '.' + fileName.slice(i + 1).toLowerCase();
}

function languageOf(fileName) {
  if (byName.has(fileName)) return byName.get(fileName);
  const ext = extensionOf(fileName);
  if (ext !== '(none)' && byExt.has(ext.slice(1))) return byExt.get(ext.slice(1));
  if (/^dockerfile/i.test(fileName)) return byExt.get('dockerfile');
  return UNKNOWN;
}

module.exports = { languageOf, extensionOf };
