import type { CollisionDetection, DragStartEvent } from "@dnd-kit/core";

/**
 * 拖动时鼠标/手指在屏幕上的真实位置。
 * 列表在拖动中会自动滚动,dnd-kit 给碰撞检测的指针坐标会叠加这段滚动,判断「鼠标在哪个放置区上」会偏,
 * 所以单独记一份,用放置区当下的位置来比。键盘拖动没有指针,tracking 为 false。
 */
export const dragPointer = { x: 0, y: 0, tracking: false };

const move = (event: MouseEvent | TouchEvent) => {
  const point = "touches" in event ? event.touches[0] : event;
  if (point) { dragPointer.x = point.clientX; dragPointer.y = point.clientY; }
};

/** 在 onDragStart 里调用:鼠标/触摸拖动时开始记录位置 */
export function startDragPointer({ activatorEvent }: Pick<DragStartEvent, "activatorEvent">) {
  const isTouch = typeof TouchEvent !== "undefined" && activatorEvent instanceof TouchEvent;
  if (!(activatorEvent instanceof MouseEvent) && !isTouch) return;
  move(activatorEvent as MouseEvent | TouchEvent);
  if (dragPointer.tracking) return;
  window.addEventListener("mousemove", move, true);
  window.addEventListener("touchmove", move, true);
  dragPointer.tracking = true;
}

/** 在 onDragEnd / onDragCancel 里调用 */
export function stopDragPointer() {
  window.removeEventListener("mousemove", move, true);
  window.removeEventListener("touchmove", move, true);
  dragPointer.tracking = false;
}

/** 鼠标正下方、ID 以 prefix 开头的放置区(按当下位置判断) */
export function droppablesUnderPointer(args: Parameters<CollisionDetection>[0], prefix: string) {
  if (!dragPointer.tracking) return [];
  const { x, y } = dragPointer;
  return args.droppableContainers.filter((item) => {
    if (!String(item.id).startsWith(prefix)) return false;
    const rect = item.node.current?.getBoundingClientRect();
    return Boolean(rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  });
}
