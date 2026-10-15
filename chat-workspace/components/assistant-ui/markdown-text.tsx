"use client";

import "@assistant-ui/react-markdown/styles/dot.css";
import "katex/dist/katex.min.css";

import {
  escapeCurrencyDollars,
  type CodeHeaderProps,
  MarkdownTextPrimitive,
  normalizeMathDelimiters,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { type ComponentProps, type FC, memo, useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon, DownloadIcon, ExternalLinkIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { MermaidDiagram } from "@/components/assistant-ui/mermaid-diagram";
import { SyntaxHighlighter } from "@/components/assistant-ui/shiki-highlighter";
import { Source, SourceIcon, SourceTitle } from "@/components/assistant-ui/sources";
import { copyTextToClipboard, downloadTextFile, fileDetailsForCode } from "@/lib/browser-actions";
import { cn } from "@/lib/utils";

const preprocessMarkdown = (text: string) => escapeCurrencyDollars(normalizeMathDelimiters(text));

const extractDomain = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const MarkdownLink: FC<ComponentProps<"a">> = ({ className, children, href, ...props }) => {
  const label = typeof children === "string" ? children : "";
  const normalizedLabel = label.replace(/\/$/, "");
  const normalizedHref = href?.replace(/\/$/, "");
  const isBareUrl = Boolean(
    href?.match(/^https?:\/\//i) && normalizedLabel && normalizedLabel === normalizedHref,
  );

  if (href && isBareUrl) {
    const domain = extractDomain(href);
    return (
      <Source
        href={href}
        title={href}
        className={cn(
          "aui-md-source-link border-border/70 bg-muted/40 text-foreground hover:border-border hover:bg-muted my-1 h-8 max-w-full gap-2 rounded-lg px-2.5 py-1.5 no-underline shadow-xs transition-[background-color,border-color,box-shadow]",
          className,
        )}
        {...props}
      >
        <SourceIcon url={href} className="size-4 rounded" />
        <SourceTitle className="max-w-[16rem] font-medium">{domain}</SourceTitle>
        <ExternalLinkIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
      </Source>
    );
  }

  return (
    <a
      href={href}
      className={cn(
        "aui-md-a text-primary hover:text-primary/80 font-medium underline decoration-current/35 underline-offset-3 transition-colors",
        className,
      )}
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  );
};

const MarkdownTextImpl = () => {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
      preprocess={preprocessMarkdown}
      className="aui-md"
      components={defaultComponents}
      componentsByLanguage={{
        mermaid: { SyntaxHighlighter: MermaidDiagram },
      }}
      defer
    />
  );
};

export const MarkdownText = memo(MarkdownTextImpl);

const filenameFromMeta = (node: CodeHeaderProps["node"]) => {
  const metadata = node?.data as Record<string, unknown> | undefined;
  const meta = typeof metadata?.meta === "string" ? metadata.meta : "";
  const match = meta.match(/(?:^|\s)filename=(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
};

const CodeHeader: FC<CodeHeaderProps> = ({ node, language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const file = fileDetailsForCode(language, filenameFromMeta(node));
  const onCopy = async () => {
    if (!code || isCopied) return;
    await copyToClipboard(code);
  };

  return (
    <div className="aui-code-header-root border-border/50 bg-muted/50 mt-3 flex items-center justify-between rounded-t-xl border border-b-0 px-3.5 py-1.5 text-xs">
      <span className="flex min-w-0 items-center gap-2">
        <span className="aui-code-header-language text-muted-foreground shrink-0 font-medium lowercase">
          {language}
        </span>
        <span className="text-foreground/80 truncate font-medium">{file.filename}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <TooltipIconButton
          tooltip={`下载 ${file.filename}`}
          onClick={() => downloadTextFile(code, file.filename, file.mime)}
        >
          <DownloadIcon />
        </TooltipIconButton>
        <TooltipIconButton tooltip="复制代码" onClick={onCopy}>
          {!isCopied && <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />}
          {isCopied && (
            <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
          )}
        </TooltipIconButton>
      </span>
    </div>
  );
};

const useCopyToClipboard = ({
  copiedDuration = 3000,
}: {
  copiedDuration?: number;
} = {}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const copyToClipboard = async (value: string) => {
    const copied = await copyTextToClipboard(value);
    if (!copied) return false;

    setIsCopied(true);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      resetTimerRef.current = null;
      setIsCopied(false);
    }, copiedDuration);
    return true;
  };

  return { isCopied, copyToClipboard };
};

const defaultComponents = memoizeMarkdownComponents({
  SyntaxHighlighter,
  h1: ({ className, ...props }) => (
    <h1
      className={cn(
        "aui-md-h1 mt-5 mb-2 scroll-m-20 text-xl font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        "aui-md-h2 mt-5 mb-2 scroll-m-20 text-lg font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        "aui-md-h3 mt-4 mb-1.5 scroll-m-20 text-base font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn(
        "aui-md-h4 mt-3.5 mb-1 scroll-m-20 text-base font-medium first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h5: ({ className, ...props }) => (
    <h5
      className={cn("aui-md-h5 mt-3 mb-1 text-sm font-semibold first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  h6: ({ className, ...props }) => (
    <h6
      className={cn("aui-md-h6 mt-3 mb-1 text-sm font-medium first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p className={cn("aui-md-p my-3 leading-relaxed first:mt-0 last:mb-0", className)} {...props} />
  ),
  a: MarkdownLink,
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "aui-md-blockquote border-muted-foreground/30 text-muted-foreground my-3 border-s-2 ps-4",
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn(
        "aui-md-ul marker:text-muted-foreground my-3 ms-5 list-disc [&>li]:mt-1",
        className,
      )}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn(
        "aui-md-ol marker:text-muted-foreground my-3 ms-5 list-decimal [&>li]:mt-1",
        className,
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr className={cn("aui-md-hr border-muted-foreground/20 my-3", className)} {...props} />
  ),
  table: ({ className, ...props }) => (
    <table
      className={cn(
        "aui-md-table my-3 w-full border-separate border-spacing-0 overflow-y-auto",
        className,
      )}
      {...props}
    />
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "aui-md-th bg-muted px-3 py-1.5 text-start font-medium first:rounded-ss-lg last:rounded-se-lg [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn(
        "aui-md-td border-muted-foreground/20 border-s border-b px-3 py-1.5 text-start last:border-e [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  tr: ({ className, ...props }) => (
    <tr
      className={cn(
        "aui-md-tr m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-es-lg [&:last-child>td:last-child]:rounded-ee-lg",
        className,
      )}
      {...props}
    />
  ),
  li: ({ className, ...props }) => (
    <li className={cn("aui-md-li leading-relaxed", className)} {...props} />
  ),
  strong: ({ className, ...props }) => (
    <strong className={cn("aui-md-strong font-semibold", className)} {...props} />
  ),
  sup: ({ className, ...props }) => (
    <sup className={cn("aui-md-sup [&>a]:text-xs [&>a]:no-underline", className)} {...props} />
  ),
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "aui-md-pre border-border/50 bg-muted/30 overflow-x-auto rounded-t-none rounded-b-xl border border-t-0 p-3.5 text-[13px] leading-relaxed",
        className,
      )}
      {...props}
    />
  ),
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        className={cn(
          !isCodeBlock &&
            "aui-md-inline-code bg-muted rounded-md px-1.5 py-0.5 font-mono text-[0.85em]",
          className,
        )}
        {...props}
      />
    );
  },
  CodeHeader,
});
