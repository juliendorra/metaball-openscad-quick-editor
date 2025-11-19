import { editorState } from './state.js';

export function createRenderer({ xyCanvas, xzCanvas, yzCanvas, previewCanvas, thresholdInput, resolutionInput }) {
  const xyCtx = xyCanvas.getContext('2d');
  const xzCtx = xzCanvas.getContext('2d');
  const yzCtx = yzCanvas.getContext('2d');
  const previewCtx = previewCanvas ? previewCanvas.getContext('2d') : null;
  const previewRotation = {
    yaw: Math.PI / 6,
    pitch: -Math.PI / 6
  };

  function resizeCanvases() {
    [xyCanvas, xzCanvas, yzCanvas, previewCanvas].forEach(canvas => {
      if (!canvas) return;
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    });
    drawAll();
  }

  const viewState = {
    xy: { offsetX: 0, offsetY: 0, zoom: 1 },
    xz: { offsetX: 0, offsetY: 0, zoom: 1 },
    yz: { offsetX: 0, offsetY: 0, zoom: 1 }
  };

  function worldToScreenXY(x, y) {
    const { offsetX, offsetY, zoom } = viewState.xy;
    return {
      px: (x + offsetX) * zoom + xyCanvas.width / 2,
      py: xyCanvas.height / 2 - (y + offsetY) * zoom
    };
  }

  function screenToWorldXY(px, py) {
    const { offsetX, offsetY, zoom } = viewState.xy;
    return {
      x: (px - xyCanvas.width / 2) / zoom - offsetX,
      y: (xyCanvas.height / 2 - py) / zoom - offsetY
    };
  }

  function worldToScreenXZ(x, z) {
    const { offsetX, offsetY, zoom } = viewState.xz;
    return {
      px: (x + offsetX) * zoom + xzCanvas.width / 2,
      py: xzCanvas.height / 2 - (z + offsetY) * zoom
    };
  }

  function screenToWorldXZ(px, py) {
    const { offsetX, offsetY, zoom } = viewState.xz;
    return {
      x: (px - xzCanvas.width / 2) / zoom - offsetX,
      z: (xzCanvas.height / 2 - py) / zoom - offsetY
    };
  }

  function worldToScreenYZ(y, z) {
    const { offsetX, offsetY, zoom } = viewState.yz;
    return {
      px: (z + offsetX) * zoom + yzCanvas.width / 2,
      py: yzCanvas.height / 2 - (y + offsetY) * zoom
    };
  }

  function screenToWorldYZ(px, py) {
    const { offsetX, offsetY, zoom } = viewState.yz;
    return {
      y: (yzCanvas.height / 2 - py) / zoom - offsetY,
      z: (px - yzCanvas.width / 2) / zoom - offsetX
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

  function getSceneExtent() {
    if (!editorState.balls.length) return 100;
    let maxExtent = 0;
    for (const ball of editorState.balls) {
      const extent = Math.max(Math.abs(ball.x), Math.abs(ball.y), Math.abs(ball.z)) + ball.r;
      if (extent > maxExtent) maxExtent = extent;
    }
    return Math.max(maxExtent, 10);
  }

  function rotatePoint(x, y, z) {
    const cosYaw = Math.cos(previewRotation.yaw);
    const sinYaw = Math.sin(previewRotation.yaw);
    const cosPitch = Math.cos(previewRotation.pitch);
    const sinPitch = Math.sin(previewRotation.pitch);

    const x1 = x * cosYaw + z * sinYaw;
    const z1 = -x * sinYaw + z * cosYaw;
    const y1 = y * cosPitch - z1 * sinPitch;
    const z2 = y * sinPitch + z1 * cosPitch;
    return { x: x1, y: y1, z: z2 };
  }

  function drawPreview3D() {
    if (!previewCtx || !previewCanvas) return;
    const width = previewCanvas.width;
    const height = previewCanvas.height;
    if (!width || !height) return;
    previewCtx.clearRect(0, 0, width, height);

    const extent = getSceneExtent();
    const scale = (Math.min(width, height) * 0.4) / extent;
    const cameraDistance = extent * 3;
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    const spheres = editorState.balls.map((ball, index) => {
      const rotated = rotatePoint(ball.x, ball.y, ball.z);
      const denom = cameraDistance - rotated.z;
      if (denom <= 10) return null;
      const perspective = cameraDistance / denom;
      const radius = ball.r * scale * perspective;
      if (!Number.isFinite(radius) || radius <= 0.5) return null;
      return {
        px: halfWidth + rotated.x * scale * perspective,
        py: halfHeight - rotated.y * scale * perspective,
        radius,
        depth: rotated.z,
        index
      };
    }).filter(Boolean);

    spheres.sort((a, b) => a.depth - b.depth);

    spheres.forEach(sphere => {
      const gradient = previewCtx.createRadialGradient(
        sphere.px - sphere.radius * 0.3,
        sphere.py - sphere.radius * 0.3,
        sphere.radius * 0.1,
        sphere.px,
        sphere.py,
        sphere.radius
      );
      gradient.addColorStop(0, 'rgba(120, 150, 190, 0.9)');
      gradient.addColorStop(1, 'rgba(70, 110, 150, 0.8)');
      previewCtx.fillStyle = gradient;
      previewCtx.beginPath();
      previewCtx.arc(sphere.px, sphere.py, sphere.radius, 0, Math.PI * 2);
      previewCtx.fill();

      previewCtx.lineWidth = sphere.index === editorState.selectedIndex ? 2 : 1;
      previewCtx.strokeStyle = sphere.index === editorState.selectedIndex ? '#cc0000' : '#1f2f3f';
      previewCtx.beginPath();
      previewCtx.arc(sphere.px, sphere.py, sphere.radius, 0, Math.PI * 2);
      previewCtx.stroke();
    });
  }

  function adjustPreviewRotation(deltaX, deltaY) {
    previewRotation.yaw += deltaX * 0.01;
    previewRotation.pitch += deltaY * 0.01;
    const limit = Math.PI / 2 - 0.1;
    previewRotation.pitch = Math.max(-limit, Math.min(limit, previewRotation.pitch));
    drawPreview3D();
  }

  function drawXY() {
    drawIsosurface(xyCtx, xyCanvas, 'xy', (sampleX, sampleY) => screenToWorldXY(sampleX, sampleY));

    const zoom = viewState.xy.zoom;
    editorState.balls.forEach((ball, index) => {
      const { px, py } = worldToScreenXY(ball.x, ball.y);
      const radiusPx = Math.max(1, ball.r * zoom);
      xyCtx.beginPath();
      xyCtx.strokeStyle = index === editorState.selectedIndex ? '#cc0000' : '#000000';
      xyCtx.lineWidth = index === editorState.selectedIndex ? 2 : 1;
      xyCtx.arc(px, py, radiusPx, 0, Math.PI * 2);
      xyCtx.stroke();

      xyCtx.beginPath();
      xyCtx.fillStyle = index === editorState.selectedIndex ? '#cc0000' : '#000000';
      xyCtx.arc(px, py, 3, 0, Math.PI * 2);
      xyCtx.fill();
    });
  }

  function drawXZ() {
    drawIsosurface(xzCtx, xzCanvas, 'xz', (sampleX, sampleY) => screenToWorldXZ(sampleX, sampleY));

    const zoom = viewState.xz.zoom;
    editorState.balls.forEach((ball, index) => {
      const { px, py } = worldToScreenXZ(ball.x, ball.z);
      const radiusPx = Math.max(1, ball.r * zoom);
      xzCtx.beginPath();
      xzCtx.strokeStyle = index === editorState.selectedIndex ? '#cc0000' : '#000000';
      xzCtx.lineWidth = index === editorState.selectedIndex ? 2 : 1;
      xzCtx.arc(px, py, radiusPx, 0, Math.PI * 2);
      xzCtx.stroke();

      xzCtx.beginPath();
      xzCtx.fillStyle = index === editorState.selectedIndex ? '#cc0000' : '#000000';
      xzCtx.arc(px, py, 3, 0, Math.PI * 2);
      xzCtx.fill();
    });
  }

  function drawYZ() {
    drawIsosurface(yzCtx, yzCanvas, 'yz', (sampleX, sampleY) => screenToWorldYZ(sampleX, sampleY));

    const zoom = viewState.yz.zoom;
    editorState.balls.forEach((ball, index) => {
      const { px, py } = worldToScreenYZ(ball.y, ball.z);
      const radiusPx = Math.max(1, ball.r * zoom);
      yzCtx.beginPath();
      yzCtx.strokeStyle = index === editorState.selectedIndex ? '#cc0000' : '#000000';
      yzCtx.lineWidth = index === editorState.selectedIndex ? 2 : 1;
      yzCtx.arc(px, py, radiusPx, 0, Math.PI * 2);
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
    drawPreview3D();
  }

  function hitTest(view, px, py) {
    const zoom = viewState[view]?.zoom || 1;
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
      const radiusPx = ball.r * zoom;
      if (Math.hypot(dx, dy) <= radiusPx) {
        return i;
      }
    }
    return -1;
  }

  function getDefaultRadius() {
    const base = Math.min(xyCanvas.width, xyCanvas.height) * 0.1 || 50;
    return base / viewState.xy.zoom;
  }

  function panViews(dx, dy) {
    ['xy', 'xz', 'yz'].forEach(view => {
      const state = viewState[view];
      if (state) {
        state.offsetX += dx / state.zoom;
        state.offsetY -= dy / state.zoom;
      }
    });
    drawAll();
  }

  function zoomViews(amount) {
    const factor = amount > 0 ? 0.9 : 1.1;
    ['xy', 'xz', 'yz'].forEach(view => {
      const state = viewState[view];
      if (!state) return;
      state.zoom = Math.min(5, Math.max(0.2, state.zoom * factor));
    });
    drawAll();
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
    getDefaultRadius,
    adjustPreviewRotation,
    drawPreview3D,
    panViews,
    zoomViews
  };
}
