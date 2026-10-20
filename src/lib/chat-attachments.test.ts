import { describe, expect, it } from "vitest";
import { chatAttachmentPaths, describeUpload } from "./chat-attachments";

const user = "0123456789abcdef0123456789abcdef";
const other = "ffffffffffffffffffffffffffffffff";
const file = (name: string) => `users/${user}/uploads/1760000000000-${"a".repeat(32)}-${name}`;

describe("chat attachments", () => {
  it("finds this user's uploaded images in chat records", () => {
    const record = JSON.stringify({
      messages: [{ parts: [
        { type: "file", url: `https://vip.example/api/media/${file("cat.png")}` },
        { type: "file", url: `https://vip.example/api/media/${file("%E7%8C%AB.jpg")}` },
        { type: "file", url: `https://vip.example/api/media/users/${other}/uploads/x-y.png` },
        { type: "file", url: `https://vip.example/api/media/users/${user}/images/generated.png` },
      ] }],
    });
    expect(chatAttachmentPaths([record, record], user)).toEqual([file("cat.png"), file("猫.jpg")]);
  });

  it("recovers the original name, time and type from the key", () => {
    expect(describeUpload(file("cat.png"))).toEqual({
      name: "cat.png", createdAt: new Date(1760000000000).toISOString(), mimeType: "image/png",
    });
  });
});
