"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { ModelIcon } from "@lobehub/icons";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type ModelSelectProps = {
  models: string[];
  value: string;
  onValueChange: (value: string) => void;
  compact?: boolean;
};

function ModelMark({ model }: { model: string }) {
  return <ModelIcon model={model} type="color" size={18} className="shrink-0" />;
}

export function ModelSelect({ models, value, onValueChange, compact = false }: ModelSelectProps) {
  const selectedValue = models.includes(value) ? value : (models[0] ?? null);

  return (
    <SelectPrimitive.Root
      value={selectedValue}
      onValueChange={(nextValue) => {
        if (typeof nextValue === "string") onValueChange(nextValue);
      }}
    >
      <SelectPrimitive.Trigger
        className={cn(
          "model-select-trigger flex items-center justify-between gap-2 outline-none",
          compact
            ? "h-8 max-w-[210px] min-w-0 px-2 text-sm font-medium"
            : "h-11 w-full px-3.5 text-sm",
        )}
        aria-label="选择模型"
      >
        <span className="flex min-w-0 items-center gap-2">
          {selectedValue && <ModelMark model={selectedValue} />}
          <SelectPrimitive.Value>
            {(currentValue) => (
              <span className="min-w-0 truncate">{currentValue ?? "选择模型"}</span>
            )}
          </SelectPrimitive.Value>
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 in-data-[popup-open]:rotate-180" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          side="bottom"
          align="start"
          sideOffset={7}
          alignItemWithTrigger={false}
          className="z-[70] outline-none"
        >
          <SelectPrimitive.Popup className="model-select-popup data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 origin-(--transform-origin) overflow-hidden outline-none duration-100">
            <SelectPrimitive.List className="max-h-[min(18rem,var(--available-height))] overflow-y-auto p-1.5 outline-none">
              {models.map((model) => (
                <SelectPrimitive.Item
                  key={model}
                  value={model}
                  className="model-select-item flex cursor-default items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] outline-none select-none"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    <ModelMark model={model} />
                  </span>
                  <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate font-medium">
                    {model}
                  </SelectPrimitive.ItemText>
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    <SelectPrimitive.ItemIndicator>
                      <Check className="size-4" />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
