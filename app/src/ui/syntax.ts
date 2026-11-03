/**
 * 轻量语法高亮：不引 highlight.js/prism，按语言做正则分词。
 *
 * 目标不是 100% 准确，而是让手机上的代码块"看得出结构"：
 * 关键字、字符串、注释、数字、函数名、标点各有颜色。
 * 未知语言直接返回一段 plain，不影响原样显示。
 */

export type SyntaxKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'keyword'
  | 'literal'
  | 'number'
  | 'function'
  | 'operator'
  | 'property'
  | 'tag';

export interface SyntaxToken {
  text: string;
  kind: SyntaxKind;
}

interface Rule {
  re: RegExp;
  /** 与捕获组一一对应的类型（组 1..n） */
  kinds: SyntaxKind[];
}

const JS_KEYWORDS =
  'const|let|var|function|return|if|else|for|while|class|extends|new|await|async|import|from|export|default|try|catch|finally|throw|typeof|instanceof|switch|case|break|continue|do|in|of|this|super|yield|delete|void|static|interface|type|enum|implements|public|private|protected|readonly|declare|namespace';

const PY_KEYWORDS =
  'def|class|return|if|elif|else|for|while|in|not|and|or|is|import|from|as|with|try|except|finally|raise|lambda|yield|async|await|pass|break|continue|global|nonlocal|del|assert';

const SH_KEYWORDS =
  'if|then|else|elif|fi|for|while|do|done|case|esac|function|in|return|exit|export|local|readonly|shift|source|alias|echo|cd|set|unset';

const RULES: Record<string, Rule> = {
  js: {
    re: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b(?:const|let|var|function|return|if|else|for|while|class|extends|new|await|async|import|from|export|default|try|catch|finally|throw|typeof|instanceof|switch|case|break|continue|do|in|of|this|super|yield|delete|void|static|interface|type|enum|implements|public|private|protected|readonly|declare|namespace)\b)|(\b(?:true|false|null|undefined|NaN|Infinity)\b)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([=+\-*/%<>!&|?:.,;(){}\[\]])/g,
    kinds: ['comment', 'string', 'keyword', 'literal', 'number', 'function', 'operator'],
  },
  py: {
    re: /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(\b(?:def|class|return|if|elif|else|for|while|in|not|and|or|is|import|from|as|with|try|except|finally|raise|lambda|yield|async|await|pass|break|continue|global|nonlocal|del|assert)\b)|(\b(?:None|True|False)\b)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)(?=\s*\()|([=+\-*/%<>!&|?:.,;(){}\[\]])/g,
    kinds: ['comment', 'string', 'keyword', 'literal', 'number', 'function', 'operator'],
  },
  sh: {
    re: /(#[^\n]*)|("(?:[^"\\]|\\.)*"|'[^']*')|(\$\{?[A-Za-z_]\w*\}?|\$[0-9@*?#!$-])|(\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|function|in|return|exit|export|local|readonly|shift|source|alias|echo|cd|set|unset)\b)|(\b\d+\b)|([=+\-*/%<>!&|?:.,;(){}\[\]])/g,
    kinds: ['comment', 'string', 'property', 'keyword', 'number', 'operator'],
  },
  json: {
    re: /("(?:[^"\\]|\\.)*")(?=\s*:)|("(?:[^"\\]|\\.)*")|(\b(?:true|false|null)\b)|(-?\b\d+(?:\.\d+)?\b)/g,
    kinds: ['property', 'string', 'keyword', 'number'],
  },
  html: {
    re: /(<!--[\s\S]*?-->)|(<\/?[A-Za-z][\w:-]*)|("[^"]*"|'[^']*')|([A-Za-z-]+)(?==)|(\/?>)/g,
    kinds: ['comment', 'tag', 'string', 'property', 'operator'],
  },
};

function family(lang: string): string | null {
  const l = lang.trim().toLowerCase();
  if (['js', 'javascript', 'jsx', 'ts', 'typescript', 'tsx', 'mjs', 'cjs'].includes(l)) return 'js';
  if (['py', 'python'].includes(l)) return 'py';
  if (['sh', 'bash', 'shell', 'zsh', 'console'].includes(l)) return 'sh';
  if (['json', 'jsonc'].includes(l)) return 'json';
  if (['html', 'xml', 'svg', 'vue'].includes(l)) return 'html';
  return null;
}

/** 把代码切成带类型的片段；未知语言返回单个 plain 片段 */
export function highlight(code: string, lang: string): SyntaxToken[] {
  const fam = family(lang);
  if (!fam) return [{ text: code, kind: 'plain' }];

  const { re, kinds } = RULES[fam]!;
  const out: SyntaxToken[] = [];
  let last = 0;
  re.lastIndex = 0;

  for (let m = re.exec(code); m !== null; m = re.exec(code)) {
    const index = m.index;
    if (index > last) out.push({ text: code.slice(last, index), kind: 'plain' });

    let kind: SyntaxKind = 'plain';
    for (let g = 1; g < m.length; g++) {
      if (m[g] !== undefined) {
        kind = kinds[g - 1] ?? 'plain';
        break;
      }
    }
    out.push({ text: m[0], kind });
    last = index + m[0].length;
    if (m[0].length === 0) re.lastIndex += 1;
  }

  if (last < code.length) out.push({ text: code.slice(last), kind: 'plain' });
  return out;
}
