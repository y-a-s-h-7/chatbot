/**
 * Syntax highlighting is lazily pulled in: the highlight.js core plus only the
 * grammars a conversation actually uses. Nothing here is in the initial bundle.
 */

import type { LanguageFn } from 'highlight.js';

type LanguageModule = { default: LanguageFn };

const LOADERS: Record<string, () => Promise<LanguageModule>> = {
  bash: () => import('highlight.js/lib/languages/bash'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  css: () => import('highlight.js/lib/languages/css'),
  diff: () => import('highlight.js/lib/languages/diff'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  go: () => import('highlight.js/lib/languages/go'),
  graphql: () => import('highlight.js/lib/languages/graphql'),
  ini: () => import('highlight.js/lib/languages/ini'),
  java: () => import('highlight.js/lib/languages/java'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  json: () => import('highlight.js/lib/languages/json'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  less: () => import('highlight.js/lib/languages/less'),
  lua: () => import('highlight.js/lib/languages/lua'),
  makefile: () => import('highlight.js/lib/languages/makefile'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  nginx: () => import('highlight.js/lib/languages/nginx'),
  objectivec: () => import('highlight.js/lib/languages/objectivec'),
  perl: () => import('highlight.js/lib/languages/perl'),
  php: () => import('highlight.js/lib/languages/php'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  python: () => import('highlight.js/lib/languages/python'),
  r: () => import('highlight.js/lib/languages/r'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  rust: () => import('highlight.js/lib/languages/rust'),
  scss: () => import('highlight.js/lib/languages/scss'),
  shell: () => import('highlight.js/lib/languages/shell'),
  sql: () => import('highlight.js/lib/languages/sql'),
  swift: () => import('highlight.js/lib/languages/swift'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  xml: () => import('highlight.js/lib/languages/xml'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
};

const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  zsh: 'bash',
  console: 'bash',
  yml: 'yaml',
  md: 'markdown',
  html: 'xml',
  vue: 'xml',
  svelte: 'xml',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  golang: 'go',
  ps1: 'powershell',
  toml: 'ini',
  cfg: 'ini',
  conf: 'ini',
  env: 'ini',
  docker: 'dockerfile',
  objc: 'objectivec',
};

let corePromise: Promise<{ hljs: HljsLike }> | null = null;
const loadedLanguages = new Set<string>();

interface HljsLike {
  registerLanguage(name: string, language: unknown): void;
  highlight(code: string, options: { language: string; ignoreIllegals?: boolean }): { value: string };
  getLanguage(name: string): unknown;
}

async function getCore() {
  if (!corePromise) {
    corePromise = import('highlight.js/lib/core').then((mod) => ({ hljs: mod.default as unknown as HljsLike }));
  }
  return corePromise;
}

function escapeHtml(code: string): string {
  return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function normalizeLanguage(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase().split(/[\s:,]/)[0].replace(/^language-/, '');
  if (!cleaned) return null;
  const resolved = ALIASES[cleaned] ?? cleaned;
  return LOADERS[resolved] ? resolved : null;
}

/** Returns syntax-highlighted HTML, or escaped plain text if we cannot help. */
export async function highlightCode(code: string, rawLanguage: string | undefined): Promise<string> {
  const language = normalizeLanguage(rawLanguage);
  if (!language) return escapeHtml(code);

  try {
    const { hljs } = await getCore();
    if (!loadedLanguages.has(language)) {
      const mod = await LOADERS[language]();
      hljs.registerLanguage(language, mod.default as unknown);
      loadedLanguages.add(language);
    }
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}
