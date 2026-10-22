import { test } from "node:test";
import assert from "node:assert/strict";
import { chatModelIds, compareModelsNewestFirst, isChatModel } from "./chat-models.ts";

test("keeps text models and drops video and image models by endpoint type", () => {
  const data = [
    { id: "gpt-5.5", supported_endpoint_types: ["openai"] },
    { id: "gpt-6-astra", supported_endpoint_types: ["openai"] },
    { id: "ch0101-sd-2.0-720p", supported_endpoint_types: ["openai-video"] },
    { id: "doubao-seedance-2-5-260628", supported_endpoint_types: ["openai-video"] },
    { id: "gpt-image-2", supported_endpoint_types: ["image-generation", "openai"] },
    {
      id: "ch5-gpt-image-2",
      supported_endpoint_types: [
        "image-generation",
        "openai",
        "openai-response",
        "anthropic",
        "gemini",
      ],
    },
    { id: "claude-x", supported_endpoint_types: ["anthropic"] },
    { id: "gpt-5.5", supported_endpoint_types: ["openai"] },
  ];
  assert.deepEqual(chatModelIds(data), ["claude-x", "gpt-6-astra", "gpt-5.5"]);
});

test("falls back to the model name when the relay gives no endpoint types", () => {
  assert.equal(isChatModel({ id: "gpt-4o" }), true);
  assert.equal(isChatModel({ id: "deepseek-chat", supported_endpoint_types: [] }), true);
  assert.equal(isChatModel({ id: "ch0110-sd-2.0-4k" }), false);
  assert.equal(isChatModel({ id: "sora-2" }), false);
  assert.equal(isChatModel({ id: "dall-e-3" }), false);
  assert.equal(isChatModel({ id: "" }), false);
  assert.equal(isChatModel({ id: 42 }), false);
});

test("an embeddings-only model is not offered for chat", () => {
  assert.equal(
    isChatModel({ id: "text-embedding-3", supported_endpoint_types: ["embeddings"] }),
    false,
  );
});

test("lists newer models first within a family", () => {
  const ids = ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-6-astra", "gpt-6-luna", "gpt-6.1-sol", "gpt-5.6-terra", "claude-opus-4-5", "claude-opus-4-7", "gpt-legacy"];
  assert.deepEqual([...ids].sort(compareModelsNewestFirst), [
    "claude-opus-4-7", "claude-opus-4-5",
    "gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-legacy",
  ]);
});
