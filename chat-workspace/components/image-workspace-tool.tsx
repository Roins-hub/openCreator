"use client";

import { ArrowRight, ImageIcon, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { defineToolkit, type ToolCallMessagePartProps } from "@assistant-ui/react";
import {
  IMAGE_WORKSPACE_ORIGIN,
  IMAGE_WORKSPACE_TOOL_NAME,
  buildImageWorkspaceUrl,
  getImageWorkspaceOrigin,
} from "@/lib/image-workspace";
import { MOTE_MODE, moteComposeUrl } from "@/lib/mote";

type ImageWorkspaceArgs = {
  prompt: string;
};

type ImageWorkspaceResult = {
  url: string;
};

function ImageWorkspaceToolCard({
  args,
  status,
}: ToolCallMessagePartProps<ImageWorkspaceArgs, ImageWorkspaceResult>) {
  const prompt = typeof args?.prompt === "string" ? args.prompt.trim() : "";
  const running = status?.type === "running";
  const [origin, setOrigin] = useState(IMAGE_WORKSPACE_ORIGIN);

  useEffect(() => setOrigin(getImageWorkspaceOrigin()), []);

  const href = MOTE_MODE
    ? moteComposeUrl(prompt)
    : prompt ? buildImageWorkspaceUrl(prompt, origin) : origin;

  return (
    <section className="my-3 w-full max-w-2xl overflow-hidden rounded-xl border bg-card text-card-foreground">
      <div className="flex items-center gap-3 border-b bg-muted/45 px-4 py-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground ring-1 ring-border">
          <ImageIcon className="size-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">生图提示词已准备</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {running ? "正在整理画面描述" : "跳转后会自动填入，不会自动开始生成"}
          </p>
        </div>
        <Sparkles className="size-4 text-muted-foreground" />
      </div>

      <div className="px-4 py-4">
        <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
          {prompt || "正在生成完整提示词……"}
        </p>
        <a
          href={href}
          aria-disabled={running || !prompt}
          onClick={(event) => {
            if (running || !prompt) event.preventDefault();
          }}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          {MOTE_MODE ? "去工作台生图" : "前往生图工作台"} <ArrowRight className="size-4" />
        </a>
      </div>
    </section>
  );
}

export const imageWorkspaceToolkit = defineToolkit({
  [IMAGE_WORKSPACE_TOOL_NAME]: {
    type: "frontend",
    display: "standalone",
    description:
      "Prepare an optimized image-generation prompt and let the user open the image workspace with that prompt prefilled.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: {
          type: "string",
          minLength: 1,
          maxLength: 6000,
          description: "A polished, detailed prompt ready for an image generation model.",
        },
      },
      required: ["prompt"],
    },
    execute: async ({ prompt }: ImageWorkspaceArgs): Promise<ImageWorkspaceResult> => ({
      url: MOTE_MODE ? moteComposeUrl(prompt.trim()) : buildImageWorkspaceUrl(prompt.trim()),
    }),
    render: ImageWorkspaceToolCard,
  },
});
