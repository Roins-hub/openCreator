import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 假的中转站(new-api rc.43 的接口形状):账号 7 已有一个粘贴用过的 Key「old7」,
 * 登录后应自动创建工作台令牌,并把 old7 以前的空间合并进账号。
 */
type Token = { id: number; user_id: number; name: string; key: string; status: number; expired_time: number };

let tokens: Token[];
let quota: number;
const calls: string[] = [];

function relay(input: RequestInfo | URL, init: RequestInit = {}) {
  const url = new URL(String(input));
  const method = init.method || "GET";
  const auth = new Headers(init.headers).get("authorization") || "";
  calls.push(`${method} ${url.pathname}`);
  const json = (data: unknown, status = 200) => Promise.resolve(Response.json(data, { status }));
  const session = auth === "Bearer session-7";

  if (url.pathname === "/api/status") {
    return json({ success: true, data: { quota_per_unit: 500000, quota_display_type: "USD", email_verification: true, register_enabled: true, turnstile_check: false } });
  }
  if (url.pathname === "/api/user/login/encryption-key") return json({ success: true, data: { enabled: false } });
  if (url.pathname === "/api/user/login" && method === "POST") {
    const body = JSON.parse(String(init.body));
    if (body.username !== "alice" || body.password !== "password123") {
      // rc.43 只返回英文原文和 message_key
      const key = "Username or password is incorrect, or user has been banned";
      return json({ success: false, message: key, message_key: key });
    }
    return json({ success: true, data: { access_token: "session-7", user: { id: 7, username: "alice" } } });
  }
  if (url.pathname === "/api/user/auth/logout") return json({ success: true });
  if (url.pathname === "/api/token/" && session && method === "GET") {
    return json({ success: true, data: { items: tokens.map(({ key, ...rest }) => ({ ...rest, key: `${key.slice(0, 2)}****` })), total: tokens.length } });
  }
  if (url.pathname === "/api/token/" && session && method === "POST") {
    const body = JSON.parse(String(init.body));
    tokens.push({ id: tokens.length + 1, user_id: 7, name: body.name, key: `new${tokens.length + 1}`, status: 1, expired_time: -1 });
    return json({ success: true });
  }
  if (url.pathname === "/api/token/batch/keys" && session) {
    const { ids } = JSON.parse(String(init.body));
    return json({ success: true, data: { keys: Object.fromEntries(tokens.filter((t) => ids.includes(t.id)).map((t) => [t.id, t.key])) } });
  }
  if (url.pathname === "/api/user/7" && auth === "Bearer admin-pat") return json({ success: true, data: { id: 7, quota } });
  return json({ success: false, message: `unexpected ${method} ${url.pathname}` }, 404);
}

let root: string;
const now = "2026-10-12T00:00:00.000Z";

beforeAll(async () => {
  root = await mkdtemp(join(process.env.TMP || tmpdir(), "mote-login-"));
  process.env.MOTE_STORAGE_ROOT = root;
  process.env.MOTE_SESSION_SECRET = "test-secret-test-secret-test-secret";
  process.env.RELAY_ADMIN_TOKEN = "admin-pat";
});
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn(relay));
  tokens = [{ id: 1, user_id: 7, name: "我自己建的", key: "old7", status: 1, expired_time: -1 }];
  quota = 1_250_000;
  calls.length = 0;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

const cookiesOf = (response: Response) =>
  response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");

async function login(body: Record<string, unknown> = { username: "alice", password: "password123" }) {
  const { POST } = await import("@/app/api/auth/login/route");
  return POST(new Request("https://video.1xxai.com/api/auth/login", {
    method: "POST", headers: { "x-forwarded-proto": "https", "x-real-ip": "203.0.113.9" }, body: JSON.stringify(body),
  }));
}

describe("站内登录", () => {
  it("登录后自动创建工作台令牌,合并旧 Key 的记录,之后不带 Key 也能识别用户", async () => {
    const { userIdOf, accountUserId } = await import("./identity");
    const legacy = join(root, "data", "users", userIdOf("sk-old7"));
    await mkdir(join(legacy, "conversations"), { recursive: true });
    await writeFile(join(legacy, "profile.json"), JSON.stringify({ createdAt: now }));
    await writeFile(join(legacy, "conversations", "old-chat.json"), JSON.stringify({ id: "old-chat", title: "旧对话", createdAt: now, updatedAt: now, messages: [] }));

    const response = await login();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ username: "alice" });
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((item) => item.startsWith("mote_auth=") && item.includes("HttpOnly") && item.includes("Secure"))).toBe(true);
    expect(cookies.some((item) => item.startsWith("mote_uid="))).toBe(true);

    // 创建了工作台令牌,并且退出了这次中转站会话
    expect(tokens.map((t) => t.name)).toContain("video.1xxai.com 工作台");
    expect(calls).toContain("POST /api/user/auth/logout");

    // 令牌加密保存,文件里没有明文
    const userId = accountUserId("7");
    const saved = await readFile(join(root, "data", "users", userId, "account.json"), "utf8");
    expect(saved).not.toContain("new2");

    const { requireUser } = await import("./identity");
    // 浏览器里残留的旧 Key 不影响:内置中转站按登录账号识别
    const user = await requireUser(new Request("https://video.1xxai.com/api/conversations", {
      headers: { cookie: cookiesOf(response), "x-tangzhi-key": "sk-someone-else" },
    }));
    expect(user.userId).toBe(userId);
    expect(user.apiKey).toBe("sk-new2");

    const { listConversations } = await import("./conversation-store");
    expect((await listConversations(userId)).map((item) => item.id)).toEqual(["old-chat"]);

    // 余额按中转站的显示方式换算:1,250,000 / 500,000 = $2.50
    const { GET } = await import("@/app/api/account/route");
    const account = await (await GET(new Request("https://video.1xxai.com/api/account", { headers: { cookie: cookiesOf(response) } }))).json();
    expect(account).toMatchObject({ loggedIn: true, username: "alice", balance: "$2.50", auth: { emailVerification: true } });
  }, 20_000); // 第一次加载路由模块较慢

  it("再次登录复用已有的工作台令牌,不会重复创建", async () => {
    await login();
    const count = tokens.length;
    await login();
    expect(tokens.length).toBe(count);
  });

  it("密码错误时把中转站的提示告诉用户", async () => {
    const response = await login({ username: "alice", password: "wrong-password" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("用户名或密码错误，或用户已被封禁");
  });

  it("把用户真实 IP 转给中转站,限流才会按人计算", async () => {
    await login();
    const loginCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/api/user/login"));
    expect(new Headers(loginCall?.[1]?.headers).get("x-forwarded-for")).toBe("203.0.113.9");
  });
});

describe("登录 Cookie", () => {
  it("篡改、过期的 Cookie 都不认", async () => {
    const { authCookie, authUserId, accountUserId } = await import("./identity");
    const userId = accountUserId("7");
    const cookie = (await authCookie(userId, new Request("https://video.1xxai.com/"))).split(";")[0];
    const withCookie = (value: string) => new Request("https://video.1xxai.com/", { headers: { cookie: value } });
    expect(await authUserId(withCookie(cookie))).toBe(userId);

    const [, value] = cookie.split("=");
    const [id, expires, sig] = value.split(".");
    expect(await authUserId(withCookie(`mote_auth=${accountUserId("8")}.${expires}.${sig}`))).toBeUndefined();
    expect(await authUserId(withCookie(`mote_auth=${id}.${Number(expires) + 1}.${sig}`))).toBeUndefined();
    expect(await authUserId(withCookie(`mote_auth=${id}.1.${sig}`))).toBeUndefined();
  });

  it("没登录也没 Key 时提示登录;自定义中转站仍然要求 Key", async () => {
    const { requireUser } = await import("./identity");
    await expect(requireUser(new Request("https://video.1xxai.com/api/conversations"))).rejects.toThrow("请先登录");
    await expect(requireUser(new Request("https://video.1xxai.com/api/conversations", {
      headers: { "x-tangzhi-base": "https://api.example.com" },
    }))).rejects.toThrow("API Key");
  });
});

describe("中转站提示翻译", () => {
  it("按 message_key 翻译并代入参数,没有译文时原样返回", async () => {
    const { relayMessage } = await import("./relay-messages");
    expect(relayMessage({
      message: "Please wait 42 seconds before requesting another verification code.",
      message_key: "Please wait {{seconds}} seconds before requesting another verification code.",
      message_params: { seconds: 42 },
    })).toBe("发送过于频繁，请等待 42 秒后再试");
    expect(relayMessage({ message: "Verification code is incorrect or has expired" })).toBe("验证码错误或已过期");
    expect(relayMessage({ message: "一条中文提示" })).toBe("一条中文提示");
  });
});

describe("余额显示", () => {
  it("按中转站设置换算成美元、人民币或原始额度", async () => {
    const { formatQuota } = await import("./relay-auth");
    const base = { systemName: "", registerEnabled: true, passwordRegisterEnabled: true, emailVerification: false, turnstileSiteKey: "", quotaPerUnit: 500000, usdExchangeRate: 7.3 };
    expect(formatQuota(1_000_000, { ...base, quotaDisplayType: "USD" })).toBe("$2.00");
    expect(formatQuota(1_000_000, { ...base, quotaDisplayType: "CNY" })).toBe("¥14.60");
    expect(formatQuota(1_000_000, { ...base, quotaDisplayType: "TOKENS" })).toBe("1,000,000");
  });
});
