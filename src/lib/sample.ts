import { PAGE_WIDTH, uid, type Cut } from './types';
import { createEffect } from './effectMeta';
import type { MaskDef } from './types';

const H = 700;

/** 콜라병을 든 손이 있는 샘플 장면을 캔버스로 직접 그린다 (외부 이미지/저작물 없음) */
export function drawSampleScene(): string {
  const c = document.createElement('canvas');
  c.width = PAGE_WIDTH;
  c.height = H;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#cfe6ff');
  bg.addColorStop(1, '#f2f8ff');
  g.fillStyle = bg;
  g.fillRect(0, 0, PAGE_WIDTH, H);
  g.fillStyle = '#e4eefb';
  g.fillRect(0, 560, PAGE_WIDTH, 140);

  const ink = '#2a1d17';
  g.lineJoin = 'round';
  g.lineCap = 'round';

  // 인물(왼쪽, 정지)
  g.fillStyle = '#4a73b8';
  g.beginPath();
  g.moveTo(60, 700);
  g.quadraticCurveTo(70, 480, 220, 470);
  g.quadraticCurveTo(370, 480, 380, 700);
  g.closePath();
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = ink;
  g.stroke();
  g.fillStyle = '#ffd9b8';
  g.beginPath();
  g.ellipse(220, 300, 112, 128, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#2f2430';
  g.beginPath();
  g.moveTo(104, 290);
  g.quadraticCurveTo(110, 150, 230, 160);
  g.quadraticCurveTo(335, 170, 336, 290);
  g.quadraticCurveTo(300, 215, 220, 220);
  g.quadraticCurveTo(140, 215, 104, 290);
  g.fill();
  g.fillStyle = ink;
  g.beginPath();
  g.ellipse(180, 310, 9, 14, 0, 0, Math.PI * 2);
  g.ellipse(262, 310, 9, 14, 0, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 4;
  g.beginPath();
  g.arc(222, 360, 22, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();

  // 팔(오른쪽 아래에서 올라옴)
  g.fillStyle = '#f2c299';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(640, 700);
  g.lineTo(900, 700);
  g.lineTo(900, 600);
  g.lineTo(700, 400);
  g.lineTo(600, 470);
  g.closePath();
  g.fill();
  g.stroke();

  // 콜라병
  const bx = 560;
  g.fillStyle = '#34190f';
  g.beginPath();
  g.moveTo(bx - 20, 150);
  g.lineTo(bx + 20, 150);
  g.lineTo(bx + 20, 225);
  g.quadraticCurveTo(bx + 70, 255, bx + 70, 320);
  g.lineTo(bx + 70, 440);
  g.quadraticCurveTo(bx + 70, 480, bx + 30, 482);
  g.lineTo(bx - 30, 482);
  g.quadraticCurveTo(bx - 70, 480, bx - 70, 440);
  g.lineTo(bx - 70, 320);
  g.quadraticCurveTo(bx - 70, 255, bx - 20, 225);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = '#d4262b';
  g.fillRect(bx - 20, 130, 40, 26);
  g.strokeRect(bx - 20, 130, 40, 26);
  g.fillStyle = '#d4262b';
  g.fillRect(bx - 70, 325, 140, 86);
  g.strokeStyle = ink;
  g.strokeRect(bx - 70, 325, 140, 86);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(bx - 56, 380);
  g.bezierCurveTo(bx - 25, 340, bx + 5, 420, bx + 56, 355);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.45)';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(bx - 50, 270);
  g.lineTo(bx - 50, 310);
  g.stroke();

  // 손가락
  g.strokeStyle = ink;
  g.lineWidth = 4;
  g.fillStyle = '#f2c299';
  g.beginPath();
  g.ellipse(bx + 8, 442, 92, 52, -0.12, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.ellipse(bx - 62 + i * 40, 400 + i * 2, 20, 34, 0.1, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.beginPath();
  g.ellipse(bx + 82, 420, 22, 42, 0.5, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  return c.toDataURL('image/png');
}

/** 손 + 콜라를 감싸는 올가미 */
export const SAMPLE_LASSO: MaskDef = {
  feather: 3,
  ops: [
    {
      kind: 'poly',
      mode: 'add',
      points: [534, 122, 586, 122, 588, 210, 640, 250, 646, 330, 668, 392, 760, 470, 900, 600, 900, 700, 650, 700, 590, 520, 500, 510, 470, 440, 486, 330, 500, 255, 536, 215],
    },
  ],
};

export function createSampleCut(withEffects: boolean): Cut {
  const cut: Cut = { id: uid(), src: drawSampleScene(), height: H, effects: [] };
  if (withEffects) {
    const shake = createEffect('shake');
    shake.name = '콜라 흔들림';
    shake.mask = SAMPLE_LASSO;
    shake.params = { ...shake.params, distance: 26, count: 3, strength: 0.7, rotation: 2 };
    const lines = createEffect('speedlines');
    lines.name = '속도선';
    lines.mask = SAMPLE_LASSO;
    lines.params = { ...lines.params, angle: 0, spread: 90, lineLength: 280 };
    cut.effects = [shake, lines];
  }
  return cut;
}
