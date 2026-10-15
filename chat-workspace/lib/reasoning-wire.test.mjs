import { test } from 'node:test';
import assert from 'node:assert/strict';
const { createOpenAI } = await import(process.env.SDK_MODULE || '@ai-sdk/openai');
import { reasoningOptionsForModel } from './reasoning.ts';

for (const [id, level] of [['gpt-6-astra','max'],['gemini-2.5-flash','none'],['grok-4.5','high'],['gpt-5.6-sol','medium'],['gpt-4o',null]]) {
  test(`SDK serializes ${id} thinking option without contacting an upstream`, async () => {
    let body;
    const provider = createOpenAI({ baseURL:'https://relay.invalid/v1', apiKey:'dummy', fetch:async (url, init) => {
      assert.match(String(url), /\/responses$/);
      body = JSON.parse(init.body);
      return Response.json({error:{message:'test boundary',type:'invalid_request_error'}},{status:400});
    }});
    await assert.rejects(provider.responses(id).doGenerate({
      prompt:[{role:'user',content:[{type:'text',text:'test'}]}],
      providerOptions:{openai:{store:false,...reasoningOptionsForModel(id,level)}},
    }));
    assert.equal(body.model,id);
    assert.equal(body.reasoning?.effort, level ?? undefined);
    assert.equal(body.forceReasoning,undefined);
  });
}
