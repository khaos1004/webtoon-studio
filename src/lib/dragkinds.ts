/**
 * 패널에서 웹툰 화면으로 끌어다 놓기(소재 · 의성어 · 말풍선).
 * 끄는 동안(dragover)에는 브라우저가 데이터 내용을 읽지 못하게 막아 두므로,
 * 화면에 보여 줄 이름은 여기 따로 기억해 둔다.
 */

export const DRAG_MAT = 'application/x-wls-material';
export const DRAG_SFX = 'application/x-wls-sfx';
export const DRAG_BUBBLE = 'application/x-wls-bubble';

export const DRAG_TYPES = [DRAG_MAT, DRAG_SFX, DRAG_BUBBLE];

let label = '';

export const dragLabel = () => label;

/** 끌기를 시작할 때 부른다. preview 를 주면 그 요소가 커서 옆에 붙어 다닌다 */
export function startPanelDrag(e: DragEvent, type: string, data: string, name: string, preview?: Element | null) {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(type, data);
  e.dataTransfer.effectAllowed = 'copy';
  label = name;
  if (preview instanceof HTMLElement) {
    const r = preview.getBoundingClientRect();
    e.dataTransfer.setDragImage(preview, r.width / 2, r.height / 2);
  }
}

export function endPanelDrag() {
  label = '';
}

export const panelDragType = (types: readonly string[] | DOMStringList | undefined) => {
  const list = Array.from(types ?? []);
  return DRAG_TYPES.find((t) => list.includes(t)) ?? null;
};
