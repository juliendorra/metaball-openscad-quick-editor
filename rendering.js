import { editorState } from './state.js';

export function createRenderer({ xyCanvas, xzCanvas, yzCanvas, previewCanvas, thresholdInput, resolutionInput }) {
  const xyCtx = xyCanvas.getContext('2d');
  const xzCtx = xzCanvas.getContext('2d');
  const yzCtx = yzCanvas.getContext('2d');
  const previewRotation = {
    yaw: Math.PI / 6,
    pitch: -Math.PI / 6
  };

  const MAX_BALLS = 128;

  const ballCache = {
    xs: new Float32Array(0),
    ys: new Float32Array(0),
    zs: new Float32Array(0),
    rs: new Float32Array(0),
    negative: new Uint8Array(0),
    count: 0
  };

  function refreshBallCache() {
    const count = Math.min(editorState.balls.length, MAX_BALLS);
    if (ballCache.count !== count || ballCache.xs.length < count) {
      ballCache.xs = new Float32Array(count);
      ballCache.ys = new Float32Array(count);
      ballCache.zs = new Float32Array(count);
      ballCache.rs = new Float32Array(count);
      ballCache.negative = new Uint8Array(count);
    }
    for (let i = 0; i < count; i++) {
      const ball = editorState.balls[i];
      ballCache.xs[i] = ball.x;
      ballCache.ys[i] = ball.y;
      ballCache.zs[i] = ball.z;
      ballCache.rs[i] = ball.r;
      ballCache.negative[i] = ball.negative ? 1 : 0;
    }
    ballCache.count = count;
  }

  function resizeCanvases() {
    [xyCanvas, xzCanvas, yzCanvas, previewCanvas].forEach(canvas => {
      if (!canvas) return;
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    });
    requestRender();
  }

  const viewState = {
    xy: { offsetX: 0, offsetY: 0, zoom: 1 },
    xz: { offsetX: 0, offsetY: 0, zoom: 1 },
    yz: { offsetX: 0, offsetY: 0, zoom: 1 }
  };

  const isoSurfaceBuffers = {
    xy: createIsoBuffer(),
    xz: createIsoBuffer(),
    yz: createIsoBuffer()
  };

  function createIsoBuffer() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) || canvas.getContext('2d');
    return {
      canvas,
      ctx,
      width: 0,
      height: 0,
      imageData: null
    };
  }

  function getIsoBuffer(view, width, height) {
    const buffer = isoSurfaceBuffers[view] || createIsoBuffer();
    if (!isoSurfaceBuffers[view]) {
      isoSurfaceBuffers[view] = buffer;
    }
    const targetWidth = Math.max(1, Math.round(width));
    const targetHeight = Math.max(1, Math.round(height));
    if (buffer.width !== targetWidth || buffer.height !== targetHeight) {
      buffer.canvas.width = targetWidth;
      buffer.canvas.height = targetHeight;
      buffer.imageData = buffer.ctx.createImageData(targetWidth, targetHeight);
      buffer.width = targetWidth;
      buffer.height = targetHeight;
    }
    return buffer;
  }

  function createPreviewRenderer(canvas) {
    if (!canvas) return null;
    const gl = canvas.getContext('webgl2', { antialias: true }) || canvas.getContext('webgl', { antialias: true });
    if (!gl) return null;

    const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const gl2Prefix = isWebGL2 ? '#version 300 es\n' : '';
    const varyingDecl = isWebGL2 ? 'out vec2 vPos;' : 'varying vec2 vPos;';
    const varyingUse = isWebGL2 ? 'in vec2 vPos;' : 'varying vec2 vPos;';
    const outColorDecl = isWebGL2 ? 'out vec4 outColor;' : '';
    const fragColor = isWebGL2 ? 'outColor' : 'gl_FragColor';
    const attributeDecl = isWebGL2 ? 'in vec2 position;' : 'attribute vec2 position;';
    const precision = 'precision highp float;\nprecision highp int;';

    const vertexSrc = `${gl2Prefix}${precision}
${attributeDecl}
${varyingDecl}
void main() {
  vPos = position;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

    const MAX_STEPS = 160;
    const fragmentSrc = `${gl2Prefix}${precision}
${varyingUse}
${outColorDecl}
uniform vec3 uCameraPos;
uniform mat3 uCameraRot;
uniform float uFovScale;
uniform float uThreshold;
uniform float uMaxDistance;
uniform float uSceneExtent;
uniform int uBallCount;
uniform vec4 uBalls[${MAX_BALLS}];

float fieldValue(vec3 p) {
  float total = 0.0;
  for (int i = 0; i < ${MAX_BALLS}; i++) {
    if (i >= uBallCount) break;
    vec4 b = uBalls[i];
    float r = abs(b.w);
    float sign = b.w < 0.0 ? -1.0 : 1.0;
    float d = length(p - b.xyz);
    float contrib = d == 0.0 ? 1e9 : r / max(d, 1e-3);
    total += sign * contrib;
  }
  return total;
}

vec3 estimateNormal(vec3 p) {
  float eps = max(0.5, uSceneExtent * 0.003);
  float dx = fieldValue(vec3(p.x + eps, p.y, p.z)) - fieldValue(vec3(p.x - eps, p.y, p.z));
  float dy = fieldValue(vec3(p.x, p.y + eps, p.z)) - fieldValue(vec3(p.x, p.y - eps, p.z));
  float dz = fieldValue(vec3(p.x, p.y, p.z + eps)) - fieldValue(vec3(p.x, p.y, p.z - eps));
  return normalize(vec3(dx, dy, dz));
}

void main() {
  vec2 uv = vPos;
  vec3 dir = normalize(uCameraRot * normalize(vec3(uv * uFovScale, -1.0)));
  float stepSize = max(uMaxDistance / float(${MAX_STEPS}), uSceneExtent * 0.015);
  float t = 0.0;
  bool hit = false;
  vec3 pos;
  float prevVal = 0.0;
  float prevT = 0.0;
  bool hasPrev = false;
  for (int i = 0; i < ${MAX_STEPS}; i++) {
    pos = uCameraPos + dir * t;
    float v = fieldValue(pos);
    if (v >= uThreshold) {
      if (hasPrev) {
        float denom = max(v - prevVal, 1e-4);
        float ratio = clamp((uThreshold - prevVal) / denom, 0.0, 1.0);
        float refinedT = mix(prevT, t, ratio);
        pos = uCameraPos + dir * refinedT;
        t = refinedT;
      }
      hit = true;
      break;
    }
    hasPrev = true;
    prevVal = v;
    prevT = t;
    t += stepSize;
    if (t > uMaxDistance) break;
  }

  if (!hit) {
    ${fragColor} = vec4(0.05, 0.07, 0.09, 1.0);
    return;
  }

  vec3 normal = estimateNormal(pos);
  vec3 lightDir = normalize(vec3(0.6, 0.7, 0.4));
  float diffuse = clamp(dot(normal, lightDir), 0.05, 1.0);
  vec3 viewDir = normalize(uCameraPos - pos);
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0) * 0.35;
  vec3 baseColor = mix(vec3(0.28, 0.45, 0.62), vec3(0.15, 0.2, 0.28), fresnel);
  ${fragColor} = vec4(baseColor * diffuse + fresnel * 0.6, 1.0);
}`;

    function createShader(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('Shader compile error', gl.getShaderInfoLog(shader));
        return null;
      }
      return shader;
    }

    const vs = createShader(gl.VERTEX_SHADER, vertexSrc);
    const fs = createShader(gl.FRAGMENT_SHADER, fragmentSrc);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('Program link error', gl.getProgramInfoLog(program));
      return null;
    }

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
        3, -1,
        -1, 3
      ]),
      gl.STATIC_DRAW
    );

    const attribLocation = gl.getAttribLocation(program, 'position');
    gl.vertexAttribPointer(attribLocation, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(attribLocation);

    const uniforms = {
      cameraPos: gl.getUniformLocation(program, 'uCameraPos'),
      cameraRot: gl.getUniformLocation(program, 'uCameraRot'),
      fovScale: gl.getUniformLocation(program, 'uFovScale'),
      threshold: gl.getUniformLocation(program, 'uThreshold'),
      maxDistance: gl.getUniformLocation(program, 'uMaxDistance'),
      sceneExtent: gl.getUniformLocation(program, 'uSceneExtent'),
      ballCount: gl.getUniformLocation(program, 'uBallCount'),
      balls: gl.getUniformLocation(program, 'uBalls')
    };

    const ballsBuffer = new Float32Array(MAX_BALLS * 4);

    function normalizeVec3(v) {
      const length = Math.hypot(v[0], v[1], v[2]);
      if (!length) return [0, 0, 0];
      return [v[0] / length, v[1] / length, v[2] / length];
    }

    function crossVec3(a, b) {
      return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
      ];
    }

    function draw({ threshold, rotation, extent, balls, center }) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);

      ballsBuffer.fill(0);
      const count = Math.min(balls.count, MAX_BALLS);
      for (let i = 0; i < count; i++) {
        ballsBuffer[i * 4] = balls.xs[i];
        ballsBuffer[i * 4 + 1] = balls.ys[i];
        ballsBuffer[i * 4 + 2] = balls.zs[i];
        ballsBuffer[i * 4 + 3] = balls.negative[i] ? -balls.rs[i] : balls.rs[i];
      }

      const yaw = rotation?.yaw ?? 0;
      const pitch = rotation?.pitch ?? 0;
      const cosPitch = Math.cos(pitch);
      const forward = normalizeVec3([
        Math.sin(yaw) * cosPitch,
        Math.sin(pitch),
        Math.cos(yaw) * cosPitch
      ]);
      const upHint = Math.abs(forward[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
      let right = crossVec3(upHint, forward);
      const rightLen = Math.hypot(right[0], right[1], right[2]);
      if (rightLen < 1e-5) {
        right = crossVec3([0, 0, 1], forward);
      }
      right = normalizeVec3(right);
      const up = normalizeVec3(crossVec3(forward, right));
      const rotMatrix = new Float32Array([
        right[0], up[0], -forward[0],
        right[1], up[1], -forward[1],
        right[2], up[2], -forward[2]
      ]);

      const safeExtent = Math.max(extent, 10);
      const cameraDistance = safeExtent * 1.35 + 80;
      const sceneCenter = center || { x: 0, y: 0, z: 0 };
      const cameraPos = [
        sceneCenter.x - forward[0] * cameraDistance,
        sceneCenter.y - forward[1] * cameraDistance,
        sceneCenter.z - forward[2] * cameraDistance
      ];
      const maxDistance = cameraDistance + safeExtent * 2;

      gl.uniform3f(uniforms.cameraPos, cameraPos[0], cameraPos[1], cameraPos[2]);
      gl.uniformMatrix3fv(uniforms.cameraRot, false, rotMatrix);
      gl.uniform1f(uniforms.fovScale, Math.tan((45 * Math.PI) / 180));
      gl.uniform1f(uniforms.threshold, threshold);
      gl.uniform1f(uniforms.maxDistance, maxDistance);
      gl.uniform1f(uniforms.sceneExtent, safeExtent);
      gl.uniform1i(uniforms.ballCount, count);
      gl.uniform4fv(uniforms.balls, ballsBuffer);

      gl.clearColor(0.04, 0.05, 0.07, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    return {
      draw
    };
  }

  const previewRenderer = createPreviewRenderer(previewCanvas);

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

  function fieldComponents(wx, wy, wz) {
    let positive = 0;
    let negative = 0;
    let value = 0;
    const { xs, ys, zs, rs, negative: negFlags, count } = ballCache;
    for (let i = 0; i < count; i++) {
      const dx = wx - xs[i];
      const dy = wy - ys[i];
      const dz = wz - zs[i];
      const dist = Math.hypot(dx, dy, dz);
      const contrib = dist === 0 ? 1e9 : rs[i] / dist;
      if (negFlags[i]) {
        negative += contrib;
        value -= contrib;
      } else {
        positive += contrib;
        value += contrib;
      }
    }
    return { total: value, positive, negative };
  }

  function computeAxisBounds() {
    if (!editorState.balls.length) {
      return {
        x: { min: -100, max: 100 },
        y: { min: -100, max: 100 },
        z: { min: -100, max: 100 }
      };
    }
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    editorState.balls.forEach(ball => {
      minX = Math.min(minX, ball.x - ball.r);
      maxX = Math.max(maxX, ball.x + ball.r);
      minY = Math.min(minY, ball.y - ball.r);
      maxY = Math.max(maxY, ball.y + ball.r);
      minZ = Math.min(minZ, ball.z - ball.r);
      maxZ = Math.max(maxZ, ball.z + ball.r);
    });
    const pad = 20;
    return {
      x: { min: minX - pad, max: maxX + pad },
      y: { min: minY - pad, max: maxY + pad },
      z: { min: minZ - pad, max: maxZ + pad }
    };
  }

  let axisBounds = computeAxisBounds();
  const interactionState = {
    fastMode: false,
    fullQualityTimer: null
  };

  function currentResolution() {
    const base = Math.max(10, parseInt(resolutionInput.value, 10) || 120);
    return interactionState.fastMode ? Math.max(10, Math.round(base * 0.35)) : base;
  }

  function currentSamples(defaultSamples, fastSamples) {
    return interactionState.fastMode ? fastSamples : defaultSamples;
  }

  function clearFullQualityTimer() {
    if (interactionState.fullQualityTimer !== null) {
      clearTimeout(interactionState.fullQualityTimer);
      interactionState.fullQualityTimer = null;
    }
  }

  function scheduleFullQualityRedraw() {
    clearFullQualityTimer();
    interactionState.fullQualityTimer = setTimeout(() => {
      interactionState.fullQualityTimer = null;
      interactionState.fastMode = false;
      flushPendingRender();
      renderInternal({ deferFullRedraw: true });
    }, 150);
  }

  function beginFastRender() {
    if (!interactionState.fastMode) {
      interactionState.fastMode = true;
    }
    clearFullQualityTimer();
  }

  function endFastRender({ immediate = false } = {}) {
    if (immediate) {
      clearFullQualityTimer();
      interactionState.fastMode = false;
      flushPendingRender();
      renderInternal({ deferFullRedraw: true });
    } else {
      scheduleFullQualityRedraw();
    }
  }

  function drawIsosurface(ctx, canvas, view, sampleToWorld) {
    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) return;

    const iso = parseFloat(thresholdInput.value) || 1;
    const resolution = currentResolution();
    const stepX = width / resolution;
    const stepY = height / resolution;
    const buffer = getIsoBuffer(view, resolution, resolution);
    const imgData = buffer.imageData;
    const data = imgData.data;
    data.fill(0);
    const missingAxis = view === 'xy' ? 'z' : view === 'xz' ? 'y' : 'x';
    const { min: axisMin, max: axisMax } = axisBounds[missingAxis];
    const samples = currentSamples(Math.max(5, Math.round(resolution * 0.25)), 1);

    for (let iy = 0; iy < resolution; iy++) {
      const sampleY = iy * stepY + stepY / 2;
      for (let ix = 0; ix < resolution; ix++) {
        const sampleX = ix * stepX + stepX / 2;
        const coords = sampleToWorld(sampleX, sampleY);
        let exceedsPositive = false;
        let exceedsNegative = false;
        for (let si = 0; si < samples; si++) {
          const t = samples === 1 ? 0.5 : si / (samples - 1);
          const axisValue = axisMin + t * (axisMax - axisMin);
          let wx;
          let wy;
          let wz;

          if (view === 'xy') {
            wx = coords.x;
            wy = coords.y;
            wz = axisValue;
          } else if (view === 'xz') {
            wx = coords.x;
            wy = axisValue;
            wz = coords.z;
          } else {
            wx = axisValue;
            wy = coords.y;
            wz = coords.z;
          }

          const components = fieldComponents(wx, wy, wz);
          if (components.total >= iso) {
            exceedsPositive = true;
          }
          if (components.negative >= iso) {
            exceedsNegative = true;
          }
          if (exceedsPositive && exceedsNegative) break;
        }

        if (!exceedsPositive && !exceedsNegative) continue;
        const idx = (iy * resolution + ix) * 4;
        if (exceedsPositive) {
          data[idx] = 70;
          data[idx + 1] = 130;
          data[idx + 2] = 180;
          data[idx + 3] = 200;
        }

        if (exceedsNegative) {
          data[idx] = Math.round((data[idx] + 230) / 2);
          data[idx + 1] = Math.round((data[idx + 1] + 110) / 2);
          data[idx + 2] = Math.round((data[idx + 2] + 30) / 2);
          data[idx + 3] = Math.min(255, Math.round((data[idx + 3] + 200) / 2));
        }
      }
    }

    buffer.ctx.putImageData(imgData, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buffer.canvas, 0, 0, width, height);
    ctx.restore();
  }

  function getSceneCenter() {
    if (!editorState.balls.length) {
      return { x: 0, y: 0, z: 0 };
    }
    return {
      x: (axisBounds.x.min + axisBounds.x.max) * 0.5,
      y: (axisBounds.y.min + axisBounds.y.max) * 0.5,
      z: (axisBounds.z.min + axisBounds.z.max) * 0.5
    };
  }

  function getSceneExtent() {
    if (!editorState.balls.length) return 100;
    const spanX = Math.abs(axisBounds.x.max - axisBounds.x.min) * 0.5;
    const spanY = Math.abs(axisBounds.y.max - axisBounds.y.min) * 0.5;
    const spanZ = Math.abs(axisBounds.z.max - axisBounds.z.min) * 0.5;
    return Math.max(10, spanX, spanY, spanZ);
  }

  function drawPreview3D() {
    if (previewRenderer && previewCanvas) {
      const extent = getSceneExtent();
      const threshold = parseFloat(thresholdInput.value) || 1;
      previewRenderer.draw({
        threshold,
        rotation: previewRotation,
        extent,
        balls: ballCache,
        center: getSceneCenter()
      });
    }
  }

  function adjustPreviewRotation(deltaX, deltaY) {
    previewRotation.yaw += deltaX * 0.01;
    previewRotation.pitch += deltaY * 0.01;
    const limit = Math.PI / 2 - 0.1;
    previewRotation.pitch = Math.max(-limit, Math.min(limit, previewRotation.pitch));
    requestRender();
  }

  function drawXY() {
    drawIsosurface(xyCtx, xyCanvas, 'xy', (sampleX, sampleY) => screenToWorldXY(sampleX, sampleY));

    const zoom = viewState.xy.zoom;
    editorState.balls.forEach((ball, index) => {
      const { px, py } = worldToScreenXY(ball.x, ball.y);
      const radiusPx = Math.max(1, ball.r * zoom);
      const baseColor = ball.negative ? '#d45500' : '#000000';
      xyCtx.beginPath();
      xyCtx.strokeStyle = index === editorState.selectedIndex ? '#cc0000' : baseColor;
      xyCtx.lineWidth = index === editorState.selectedIndex ? 2 : 1;
      xyCtx.arc(px, py, radiusPx, 0, Math.PI * 2);
      xyCtx.stroke();

      xyCtx.beginPath();
      xyCtx.fillStyle = index === editorState.selectedIndex ? '#cc0000' : baseColor;
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
      const baseColor = ball.negative ? '#d45500' : '#000000';
      xzCtx.beginPath();
      xzCtx.strokeStyle = index === editorState.selectedIndex ? '#cc0000' : baseColor;
      xzCtx.lineWidth = index === editorState.selectedIndex ? 2 : 1;
      xzCtx.arc(px, py, radiusPx, 0, Math.PI * 2);
      xzCtx.stroke();

      xzCtx.beginPath();
      xzCtx.fillStyle = index === editorState.selectedIndex ? '#cc0000' : baseColor;
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
      const baseColor = ball.negative ? '#d45500' : '#000000';
      yzCtx.beginPath();
      yzCtx.strokeStyle = index === editorState.selectedIndex ? '#cc0000' : baseColor;
      yzCtx.lineWidth = index === editorState.selectedIndex ? 2 : 1;
      yzCtx.arc(px, py, radiusPx, 0, Math.PI * 2);
      yzCtx.stroke();

      yzCtx.beginPath();
      yzCtx.fillStyle = index === editorState.selectedIndex ? '#cc0000' : baseColor;
      yzCtx.arc(px, py, 3, 0, Math.PI * 2);
      yzCtx.fill();
    });
  }

  function renderInternal({ deferFullRedraw = false } = {}) {
    refreshBallCache();
    axisBounds = computeAxisBounds();
    drawXY();
    drawXZ();
    drawYZ();
    drawPreview3D();

    if (interactionState.fastMode && !deferFullRedraw) {
      scheduleFullQualityRedraw();
    }
  }

  let pendingRender = null;
  let pendingRenderOptions = null;

  function flushPendingRender() {
    if (pendingRender !== null) {
      cancelAnimationFrame(pendingRender);
      pendingRender = null;
    }
    pendingRenderOptions = null;
  }

  function requestRender(options = {}) {
    pendingRenderOptions = options;
    if (pendingRender !== null) return;
    pendingRender = requestAnimationFrame(() => {
      const opts = pendingRenderOptions || {};
      pendingRenderOptions = null;
      pendingRender = null;
      renderInternal(opts);
    });
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
    requestRender();
  }

  function zoomViews(amount) {
    const factor = amount > 0 ? 0.9 : 1.1;
    ['xy', 'xz', 'yz'].forEach(view => {
      const state = viewState[view];
      if (!state) return;
      state.zoom = Math.min(5, Math.max(0.2, state.zoom * factor));
    });
    requestRender();
  }

  return {
    resizeCanvases,
    drawAll: requestRender,
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
    zoomViews,
    beginFastRender,
    endFastRender
  };
}
