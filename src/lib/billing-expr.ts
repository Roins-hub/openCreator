/**
 * new-api 的阶梯计费表达式(billing_mode = tiered_expr)求值,用来把中转站后台设置的价格同步到工作台显示。
 * 例:
 *   tier("standard", p * 5 + cr * 1.25 + img * 8 + c * 30)                   按 token:每百万 token 的美元单价
 *   (!(has(param("size"), "2048") || …) ? tier("1K", fixed(0.12)) : …) * image_count   按尺寸分档的每张价格
 * 结果单位统一为「百万分之一美元」:token 变量的系数本来就是每百万单价;fixed(x) 是绝对金额,乘以 1e6。
 * 只支持这类表达式用到的语法:数字、字符串、标识符、函数调用、! && || ?: + - * / 比较运算和括号。
 */
type Value = number | string | boolean;

export interface ExprEnv {
  /** 变量(p、c、cr、img、image_count、len…),没给的按 0 */
  vars?: Record<string, number>;
  /** 请求参数,param("size") 读这里 */
  params?: Record<string, string>;
}

export interface ExprResult {
  /** 百万分之一美元 */
  micros: number;
  /** 命中的 tier 名称(最后一次调用 tier 的名字) */
  tier?: string;
}

type Token = { type: "num"; value: number } | { type: "str"; value: string } | { type: "id"; value: string } | { type: "op"; value: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      const match = /^\d*\.?\d+(?:e[+-]?\d+)?/i.exec(source.slice(i));
      if (!match) throw new Error(`无法解析的数字：${source.slice(i, i + 10)}`);
      tokens.push({ type: "num", value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (ch === "\"" || ch === "'") {
      const end = source.indexOf(ch, i + 1);
      if (end < 0) throw new Error("字符串没有结束引号");
      tokens.push({ type: "str", value: source.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i)) as RegExpExecArray;
      tokens.push({ type: "id", value: match[0] });
      i += match[0].length;
      continue;
    }
    const two = source.slice(i, i + 2);
    if (["||", "&&", "==", "!=", "<=", ">="].includes(two)) {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    if ("!?:+-*/(),<>".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    throw new Error(`无法解析的字符：${ch}`);
  }
  return tokens;
}

type Node =
  | { kind: "lit"; value: Value }
  | { kind: "var"; name: string }
  | { kind: "call"; name: string; args: Node[] }
  | { kind: "unary"; op: string; arg: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "cond"; test: Node; yes: Node; no: Node };

const PRECEDENCE: Record<string, number> = {
  "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, ">": 4, "<=": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6,
};

export function parseExpr(source: string): Node {
  const tokens = tokenize(source);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (value: string) => peek()?.type === "op" && peek()?.value === value;
  const expect = (value: string) => {
    if (!isOp(value)) throw new Error(`缺少 ${value}`);
    pos++;
  };

  const primary = (): Node => {
    const token = tokens[pos++];
    if (!token) throw new Error("表达式不完整");
    if (token.type === "num") return { kind: "lit", value: token.value };
    if (token.type === "str") return { kind: "lit", value: token.value };
    if (token.type === "id") {
      if (token.value === "true" || token.value === "false") return { kind: "lit", value: token.value === "true" };
      if (isOp("(")) {
        pos++;
        const args: Node[] = [];
        if (!isOp(")")) {
          do { args.push(conditional()); } while (isOp(",") && ++pos);
        }
        expect(")");
        return { kind: "call", name: token.value, args };
      }
      return { kind: "var", name: token.value };
    }
    if (token.value === "(") {
      const inner = conditional();
      expect(")");
      return inner;
    }
    if (token.value === "!" || token.value === "-") return { kind: "unary", op: token.value, arg: unary() };
    throw new Error(`意外的符号：${token.value}`);
  };

  const unary = (): Node => {
    if (isOp("!") || isOp("-")) {
      const op = tokens[pos++].value as string;
      return { kind: "unary", op, arg: unary() };
    }
    return primary();
  };

  const binary = (minPrecedence: number): Node => {
    let left = unary();
    for (;;) {
      const token = peek();
      const precedence = token?.type === "op" ? PRECEDENCE[token.value] : undefined;
      if (precedence === undefined || precedence < minPrecedence) return left;
      pos++;
      const right = binary(precedence + 1);
      left = { kind: "binary", op: token.value as string, left, right };
    }
  };

  const conditional = (): Node => {
    const test = binary(1);
    if (!isOp("?")) return test;
    pos++;
    const yes = conditional();
    expect(":");
    const no = conditional();
    return { kind: "cond", test, yes, no };
  };

  const root = conditional();
  if (pos < tokens.length) throw new Error("表达式结尾有多余内容");
  return root;
}

export function evaluateExpr(source: string | Node, env: ExprEnv = {}): ExprResult {
  const root = typeof source === "string" ? parseExpr(source) : source;
  let tier: string | undefined;
  const num = (value: Value) => typeof value === "number" ? value : typeof value === "boolean" ? Number(value) : Number(value) || 0;
  const visit = (node: Node): Value => {
    switch (node.kind) {
      case "lit": return node.value;
      case "var": return env.vars?.[node.name] ?? 0;
      case "unary": return node.op === "!" ? !visit(node.arg) : -num(visit(node.arg));
      case "cond": return visit(node.test) ? visit(node.yes) : visit(node.no);
      case "binary": {
        if (node.op === "||") return Boolean(visit(node.left)) || Boolean(visit(node.right));
        if (node.op === "&&") return Boolean(visit(node.left)) && Boolean(visit(node.right));
        const left = visit(node.left);
        const right = visit(node.right);
        switch (node.op) {
          case "+": return num(left) + num(right);
          case "-": return num(left) - num(right);
          case "*": return num(left) * num(right);
          case "/": return num(right) ? num(left) / num(right) : 0;
          case "==": return left === right;
          case "!=": return left !== right;
          case "<": return num(left) < num(right);
          case ">": return num(left) > num(right);
          case "<=": return num(left) <= num(right);
          default: return num(left) >= num(right);
        }
      }
      case "call": {
        const args = node.args.map(visit);
        switch (node.name) {
          case "tier": tier = String(args[0]); return num(args[1]);
          case "fixed": return num(args[0]) * 1e6;
          case "param": return env.params?.[String(args[0])] ?? "";
          case "has": return String(args[0]).includes(String(args[1]));
          case "max": return Math.max(...args.map(num));
          case "min": return Math.min(...args.map(num));
          // u("seconds") 等按用量取值的函数:没给就按 0
          case "u": return env.vars?.[`u:${String(args[0])}`] ?? 0;
          default: throw new Error(`不支持的函数：${node.name}`);
        }
      }
    }
  };
  return { micros: num(visit(root)), tier };
}
