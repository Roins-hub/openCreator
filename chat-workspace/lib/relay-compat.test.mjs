import { test } from 'node:test';
import assert from 'node:assert/strict';
const { createOpenAI } = await import(process.env.SDK_MODULE || '@ai-sdk/openai');
import { repairResponsesStream } from './relay-compat.ts';

// 把事件列表包装成中转站的 SSE 响应,经过(或不经过)修补后交给 AI SDK 的真实解析器
const sse = (events) => new Response(
  events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
  { headers: { 'content-type': 'text/event-stream' } },
);

async function parse(events, repair = true) {
  const provider = createOpenAI({
    baseURL: 'https://relay.invalid/v1', apiKey: 'dummy',
    fetch: async () => (repair ? repairResponsesStream(sse(events)) : sse(events)),
  });
  const { stream } = await provider.responses('gpt-6-astra').doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: '你是谁' }] }],
    providerOptions: { openai: { store: false } },
  });
  const parts = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return parts;
}

// 和 ai 核心处理 UI 消息时的检查一致:思考片段必须落在已开始、未结束的思考段里
function reasoningProblems(parts) {
  const open = new Set();
  const problems = [];
  for (const part of parts) {
    if (part.type === 'reasoning-start') open.add(part.id);
    if (part.type === 'reasoning-end') open.delete(part.id);
    if (part.type === 'reasoning-delta' && !open.has(part.id)) problems.push(part.id);
    if (part.type === 'error') problems.push(`error: ${JSON.stringify(part.error).slice(0, 120)}`);
  }
  return problems;
}

const text = (parts) => parts.filter((part) => part.type === 'text-delta').map((part) => part.delta).join('');
const reasoning = (parts) => parts.filter((part) => part.type === 'reasoning-delta').map((part) => part.delta).join('');

const created = { type: 'response.created', response: { id: 'resp_1', created_at: 1, model: 'gpt-6-astra', service_tier: null } };
const completed = {
  type: 'response.completed',
  response: { incomplete_details: null, service_tier: null, usage: { input_tokens: 3, input_tokens_details: null, output_tokens: 5, output_tokens_details: null } },
};
const rsAdded = (id, index = 0) => ({ type: 'response.output_item.added', output_index: index, item: { type: 'reasoning', id, encrypted_content: null, summary: [] } });
const rsDone = (id, index = 0) => ({ type: 'response.output_item.done', output_index: index, item: { type: 'reasoning', id, encrypted_content: null, summary: [] } });
const rsDelta = (id, delta, index = 0, summary = 0) => ({ type: 'response.reasoning_summary_text.delta', item_id: id, output_index: index, summary_index: summary, delta });
const message = (index = 1) => [
  { type: 'response.output_item.added', output_index: index, item: { type: 'message', id: 'msg_1' } },
  { type: 'response.output_text.delta', item_id: 'msg_1', output_index: index, content_index: 0, delta: '我是', logprobs: [] },
  { type: 'response.output_text.delta', item_id: 'msg_1', output_index: index, content_index: 0, delta: '助手', logprobs: [] },
  { type: 'response.output_item.done', output_index: index, item: { type: 'message', id: 'msg_1' } },
];

const cases = {
  'well-formed stream (control)': [created, rsAdded('rs_1'), rsDelta('rs_1', '思考'), rsDone('rs_1'), ...message(), completed],
  'reasoning deltas without output_item.added': [created, rsDelta('rs_1', '思考'), rsDone('rs_1'), ...message(), completed],
  'reasoning delta arriving after the reasoning item is done': [created, rsAdded('rs_1'), rsDelta('rs_1', '思考'), rsDone('rs_1'), ...message(), rsDelta('rs_1', '迟到'), completed],
  'delta item_id differs from output_item.added': [created, rsAdded('rs_a'), rsDelta('rs_b', '思考'), rsDone('rs_a'), ...message(), completed],
  'new summary_index without summary_part.added': [created, rsAdded('rs_1'), rsDelta('rs_1', '一'), rsDelta('rs_1', '二', 0, 1), rsDone('rs_1'), ...message(), completed],
  'reasoning at the end with an index the message already uses': [created, ...message(0), rsDelta('rs_1', '思考', 0), completed],
};

for (const [name, events] of Object.entries(cases)) {
  test(`repaired: ${name}`, async () => {
    const parts = await parse(events);
    assert.deepEqual(reasoningProblems(parts), []);
    assert.equal(text(parts), '我是助手');
  });
}

test('the raw malformed streams really break the SDK (so the cases above are meaningful)', async () => {
  const broken = [];
  for (const [name, events] of Object.entries(cases)) {
    if (name.includes('control')) continue;
    if (reasoningProblems(await parse(events, false)).length) broken.push(name);
  }
  assert.ok(broken.length >= 3, `only ${broken.length} raw cases broke: ${broken.join(', ')}`);
});

test('reasoning text is kept when it can be placed', async () => {
  const parts = await parse(cases['reasoning deltas without output_item.added']);
  assert.equal(reasoning(parts), '思考');
});
