import { editorState } from './state.js';

export function createRenderer({ xyCanvas, xzCanvas, yzCanvas, thresholdInput, resolutionInput }) {
  const xyCtx = xyCanvas.getContext('2d');
  const xzCtx = xzCanvas.getContext('2d');
  const yzCtx = yzCanvas.getContext('2d');

  function resizeCanvases() {
    [xyCanvas, xzCanvas, yzCanvas].forEach(canvas => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    });
    drawAll();
  }

  function worldToScreenXY(x, y) {
    return {
      px: x + xyCanvas.width / 2,
      py: xyCanvas.height / 2 - y
    };
  }

  function screenToWorldXY(px, py) {
    return {
      x: px - xyCanvas.width / 2,
      y: xyCanvas.height / 2 - py
    };
  }

  function worldToScreenXZ(x, z) {
    return {
      px: x + xzCanvas.width / 2,
      py: xzCanvas.height / 2 - z
    };
  }

  function screenToWorldXZ(px, py) {
    return {
      x: px - xzCanvas.width / 2,
      z: xzCanvas.height / 2 - py
    };
  }

  function worldToScreenYZ(y, z) {
    return {
      px: z + yzCanvas.width / 2,
      py: yzCanvas.height / 2 - y
    };
  }

  function screenToWorldYZ(px, py) {
    return {
      y: yzCanvas.height / 2 - py,
      z: px - yzCanvas.width / 2
    };
  }

  function fieldAtSlice(view, coords) {
    let value = 0;
    for (const ball of editorState.balls) {
      let dist;
      if (view === 'xy') {
        const dx = coords.x - ball.x;
        const dy = coords.y - ball.y;
        dist = Math.hypot(dx, dy);
      } else if (view === 'xz') {
        const dx = coords.x - ball.x;
        const dz = coords.z - ball.z;
        dist = Math.hypot(dx, dz);
      } else {
        const dy = coords.y - ball.y;
        const dz = coords.z - ball.z;
        dist = Math.hypot(dy, dz);
      }
      value += dist === 0 ? 1e9 : ball.r / dist;
    }
    return value;
  }

  function drawIsosurface(ctx, canvas, view, sampleToWorld) {
    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) return;

    const iso = parseFloat(thresholdInput.value) || 1;
    const resolution = Math.max(10, parseInt(resolutionInput.value, 10) || 120);
    const stepX = width / resolution;
    const stepY = height / resolution;
    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;

    for (let iy = 0; iy < resolution; iy++) {
      const sampleY = iy * stepY + stepY / 2;
      for (let ix = 0; ix < resolution; ix++) {
        const sampleX = ix * stepX + stepX / 2;
        const coords = sampleToWorld(sampleX, sampleY);
        if (fieldAtSlice(view, coords) < iso) continue;

        const startX = Math.floor(ix * stepX);
        const startY = Math.floor(iy * stepY);
        const endX = Math.min(Math.floor((ix + 1) * stepX), width);
        const endY = Math.min(Math.floor((iy + 1) * stepY), height);

        for (let py = startY; py < endY; py++) {
          for (let px = startX; px < endX; px++) {
            const idx = (py * width + px) * 4;
            data[idx] = 70;
            data[idx + 1] = 130;
            data[idx + 2] = 180;
            data[idx + 3] = 200;
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }

  function drawXY() {
    drawIsosurface(xyCtx, xyCanvas, 'xy', (sampleX, sampleY) => screenToWorldXY(sampleX, sampleY));

    editorState.balls.forEach((ball, index) => {
      const { px, py } = worldToScreenXY(ball.x, ball.y);
      xyCtx.beginPath();
      xyCtx.strokeStyle = index === editorState.selectedIndex ? '#cc0000' : '#000000';
      xyCtx.lineWidth = index === editorState.selectedIndex ? 2 : 1;
      xyCtx.arc(px, py, ball.r, 0, Math.PI * 2);
      xyCtx.stroke();

      xyCtx.beginPath();
      xyCtx.fillStyle = index === editorState.selectedIndex ? '#cc0000' : '#000000';
      xyCtx.arc(px, py, 3, 0, Math.PI * 2);
      xyCtx.fill();
    });
  }

  function drawXZ() {
    drawIsosurface(xzCtx, xzCanvas, 'xz', (sampleX, sampleY) => screenToWorldXZ(sampleX, sampleY));

    editorState.balls.forEach((ball, index) => {
      const { px, py } = worldToScreenXZ(ball.x, ball.z);
      xzCtx.beginPath();
      xzCtx.strokeStyle = index === editorState.selectedIndex ? '#cc0000' : '#000000';
      xzCtx.lineWidth = index === editorState.selectedIndex ? 2 : 1;
      xzCtx.arc(px, py, ball.r, 0, Math.PI * 2);
      xzCtx.stroke();

      xzCtx.beginPath();
      xzCtx.fillStyle = index === editorState.selectedIndex ? '#cc0000' : '#000000';
      xzCtx.arc(px, py, 3, 0, Math.PI * 2);
      xzCtx.fill();
    });
  }

  function drawYZ() {
    drawIsosurface(yzCtx, yzCanvas, 'yz', (sampleX, sampleY) => screenToWorldYZ(sampleX, sampleY));

    editorState.balls.forEach((ball, index) => {
      const { px, py } = worldToScreenYZ(ball.y, ball.z);
      yzCtx.beginPath();
      yzCtx.strokeStyle = index === editorState.selectedIndex ? '#cc0000' : '#000000';
      yzCtx.lineWidth = index === editorState.selectedIndex ? 2 : 1;
      yzCtx.arc(px, py, ball.r, 0, Math.PI * 2);
      yzCtx.stroke();

      yzCtx.beginPath();
      yzCtx.fillStyle = index === editorState.selectedIndex ? '#cc0000' : '#000000';
      yzCtx.arc(px, py, 3, 0, Math.PI * 2);
      yzCtx.fill();
    });
  }

  function drawAll() {
    drawXY();
    drawXZ();
    drawYZ();
  }

  function hitTest(view, px, py) {
    for (let i = editorState.balls.length - 1; i >= 0; i--) {
      const ball = editorState.balls[i];
      let sx;
      let sy;

      if (view === 'xy') {
        ({ px: sx, py: sy } = worldToScreenXY(ball.x, ball.y));
      } else if (view === 'xz') {
        ({ px: sx, py: sy } = worldToScreenXZ(ball.x, ball.z));
      } else {
        ({ px: sx, py: sy } = worldToScreenYZ(ball.y, ball.z));
      }

      const dx = px - sx;
      const dy = py - sy;
      if (Math.hypot(dx, dy) <= ball.r) {
        return i;
      }
    }
    return -1;
  }

  function getDefaultRadius() {
    return Math.min(xyCanvas.width, xyCanvas.height) * 0.1 || 50;
  }

  return {
    resizeCanvases,
    drawAll,
    worldToScreenXY,
    screenToWorldXY,
    worldToScreenXZ,
    screenToWorldXZ,
    worldToScreenYZ,
    screenToWorldYZ,
    hitTest,
    getDefaultRadius
  };
}
