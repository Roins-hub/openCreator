// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCardDrag } from "./card-drag";

afterEach(cleanup);

function Harness({ onDrop, onClick }: { onDrop: (target: string, paths: string[], point: { x: number; y: number }) => void; onClick: () => void }) {
  const drag = useCardDrag(onDrop);
  return <>
    <div data-testid="card" onClick={onClick}
      onPointerDown={(event) => drag.begin(event, { kind: "image", path: "users/x/uploads/a.png", name: "a.png" }, ["users/x/uploads/a.png"])}>a</div>
    <div data-testid="editor" data-drop-target="__editor__" data-drop-external>editor</div>
    {drag.overlay}
  </>;
}

describe("useCardDrag", () => {
  it("drops onto an external target with the release point and swallows the follow-up click", async () => {
    const onDrop = vi.fn();
    const onClick = vi.fn();
    render(<Harness onDrop={onDrop} onClick={onClick} />);
    const editor = screen.getByTestId("editor");
    const original = document.elementFromPoint;
    document.elementFromPoint = () => editor;
    try {
      fireEvent.pointerDown(screen.getByTestId("card"), { button: 0, pointerType: "mouse", clientX: 0, clientY: 0 });
      fireEvent.pointerMove(window, { clientX: 120, clientY: 80 });
      expect(editor.classList.contains("is-card-drop-hover")).toBe(true);
      expect(document.querySelector(".card-drag.is-over-area")).toBeTruthy();
      await act(async () => { fireEvent.pointerUp(window, { clientX: 120, clientY: 80 }); });
      expect(onDrop).toHaveBeenCalledWith("__editor__", ["users/x/uploads/a.png"], { x: 120, y: 80 });
      fireEvent.click(screen.getByTestId("card"));
      expect(onClick).not.toHaveBeenCalled();
    } finally {
      document.elementFromPoint = original;
    }
  });

  it("does not start a drag for a plain click", () => {
    const onDrop = vi.fn();
    const onClick = vi.fn();
    render(<Harness onDrop={onDrop} onClick={onClick} />);
    fireEvent.pointerDown(screen.getByTestId("card"), { button: 0, pointerType: "mouse", clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 2, clientY: 1 });
    fireEvent.pointerUp(window, { clientX: 2, clientY: 1 });
    fireEvent.click(screen.getByTestId("card"));
    expect(onDrop).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".card-drag")).toBeNull();
  });
});
