import { editorState } from './state.js';
import * as THREE from 'https://unpkg.com/three@0.160.0?module';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js?module';

const PREVIEW_SHADER_BALL_LIMIT = 64;
const PREVIEW_SHADER_MAX_STEPS = 160;

const PREVIEW_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const PREVIEW_FRAGMENT_SHADER = `
  precision highp float;

  #define MAX_SHADER_BALLS ${PREVIEW_SHADER_BALL_LIMIT}
  #define MAX_MARCH_STEPS ${PREVIEW_SHADER_MAX_STEPS}

  uniform mat4 viewMatrixInverse;
  uniform mat4 projectionMatrixInverse;
  uniform vec3 boundsMin;
  uniform vec3 boundsMax;
  uniform vec3 boundsSize;
  uniform float isoLevel;
  uniform int ballCount;
  uniform vec4 ballData[MAX_SHADER_BALLS];
  uniform int marchSteps;
  uniform vec3 lightDir;
  uniform vec3 colorPositive;
  uniform vec3 colorNegative;

  varying vec2 vUv;

  struct FieldSample {
    float total;
    float negative;
  };

  float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
  }

  FieldSample sampleField(vec3 p) {
    FieldSample result;
    result.total = 0.0;
    result.negative = 0.0;
    for (int i = 0; i < MAX_SHADER_BALLS; i++) {
      if (i >= ballCount) {
        break;
      }
      vec4 ball = ballData[i];
      if (ball.w == 0.0) {
        continue;
      }
      vec3 diff = p - ball.xyz;
      float dist = length(diff);
      if (dist == 0.0) {
        dist = 0.0001;
      }
      float magnitude = abs(ball.w);
      float contrib = magnitude / dist;
      if (ball.w < 0.0) {
        result.negative += contrib;
        result.total -= contrib;
      } else {
        result.total += contrib;
      }
    }
    return result;
  }

  float componentValue(FieldSample sampleValue, int componentIndex) {
    return componentIndex == 1 ? sampleValue.negative : sampleValue.total;
  }

  vec3 getRayDirection(vec2 uv) {
    vec2 ndc = vec2(uv.x * 2.0 - 1.0, (1.0 - uv.y) * 2.0 - 1.0);
    vec4 clip = vec4(ndc, -1.0, 1.0);
    vec4 view = projectionMatrixInverse * clip;
    view = vec4(view.xy, -1.0, 0.0);
    vec4 world = viewMatrixInverse * view;
    return normalize(world.xyz);
  }

  bool intersectBox(vec3 ro, vec3 rd, vec3 bMin, vec3 bMax, out float tNear, out float tFar) {
    vec3 inv = 1.0 / rd;
    vec3 t0 = (bMin - ro) * inv;
    vec3 t1 = (bMax - ro) * inv;
    vec3 tsmaller = min(t0, t1);
    vec3 tbigger = max(t0, t1);
    tNear = max(max(tsmaller.x, tsmaller.y), max(tsmaller.z, 0.0));
    tFar = min(tbigger.x, min(tbigger.y, tbigger.z));
    return tFar > tNear;
  }

  vec3 estimateNormal(vec3 p, int componentIndex) {
    float eps = max(0.4, length(boundsSize) * 0.003);
    vec3 ex = vec3(eps, 0.0, 0.0);
    vec3 ey = vec3(0.0, eps, 0.0);
    vec3 ez = vec3(0.0, 0.0, eps);
    float nx = componentValue(sampleField(p + ex), componentIndex) - componentValue(sampleField(p - ex), componentIndex);
    float ny = componentValue(sampleField(p + ey), componentIndex) - componentValue(sampleField(p - ey), componentIndex);
    float nz = componentValue(sampleField(p + ez), componentIndex) - componentValue(sampleField(p - ez), componentIndex);
    vec3 grad = vec3(nx, ny, nz);
    float lenGrad = length(grad);
    if (lenGrad < 0.0001) {
      return vec3(0.0, 0.0, 1.0);
    }
    return normalize(-grad);
  }

  void main() {
    if (ballCount == 0) {
      discard;
    }

    vec3 ro = cameraPosition;
    vec3 rd = getRayDirection(vUv);
    float tNear;
    float tFar;
    if (!intersectBox(ro, rd, boundsMin, boundsMax, tNear, tFar)) {
      discard;
    }

    float range = tFar - tNear;
    if (range <= 0.0) {
      discard;
    }

    int steps = max(marchSteps, 1);
    float stepSize = max(range / float(steps), 0.5);
    float jitter = rand(gl_FragCoord.xy) * 0.5;
    float t = tNear + stepSize * jitter;

    vec3 hitPos = vec3(0.0);
    int hitComponent = 0;
    bool hit = false;

    for (int i = 0; i < MAX_MARCH_STEPS; i++) {
      if (i >= steps) {
        break;
      }
      if (t > tFar) {
        break;
      }
      vec3 samplePos = ro + rd * t;
      FieldSample fieldValue = sampleField(samplePos);
      bool positiveHit = fieldValue.total >= isoLevel;
      bool negativeHit = fieldValue.negative >= isoLevel;
      if (positiveHit || negativeHit) {
        float tLow = max(t - stepSize, tNear);
        float tHigh = t;
        for (int j = 0; j < 5; j++) {
          float mid = 0.5 * (tLow + tHigh);
          FieldSample midSampleValue = sampleField(ro + rd * mid);
          bool midPos = midSampleValue.total >= isoLevel;
          bool midNeg = midSampleValue.negative >= isoLevel;
          if ((positiveHit && midPos) || (negativeHit && midNeg)) {
            tHigh = mid;
            positiveHit = midPos;
            negativeHit = midNeg;
          } else {
            tLow = mid;
          }
        }
        hitPos = ro + rd * tHigh;
        hitComponent = negativeHit ? 1 : 0;
        hit = true;
        break;
      }
      t += stepSize;
    }

    if (!hit) {
      discard;
    }

    vec3 normal = estimateNormal(hitPos, hitComponent);
    vec3 baseColor = hitComponent == 1 ? colorNegative : colorPositive;
    vec3 l = normalize(lightDir);
    float ndotl = clamp(dot(normal, l), 0.0, 1.0);
    vec3 viewDir = normalize(ro - hitPos);
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
    vec3 color = baseColor * (0.35 + 0.65 * ndotl) + fresnel * vec3(0.6);
    float alpha = hitComponent == 1 ? 0.9 : 0.92;
    gl_FragColor = vec4(color, alpha);
  }
`;

export function createRenderer({ xyCanvas, xzCanvas, yzCanvas, previewCanvas, thresholdInput, resolutionInput }) {
  const xyCtx = xyCanvas.getContext('2d');
  const xzCtx = xzCanvas.getContext('2d');
  const yzCtx = yzCanvas.getContext('2d');

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
    [xyCanvas, xzCanvas, yzCanvas].forEach(canvas => {
      if (!canvas) return;
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    });
    if (previewViewport) {
      previewViewport.resize();
    }
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

  const previewViewport = createThreePreview(previewCanvas);

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

  function createThreePreview(container) {
    if (!container) return null;

    const toolbar = container.querySelector('.three-preview__toolbar');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x0a0c10, 1);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.setAttribute('aria-label', '3D preview');

    if (toolbar) {
      container.insertBefore(renderer.domElement, toolbar);
    } else {
      container.appendChild(renderer.domElement);
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.enablePan = true;

    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
    dirLight.position.set(1, 1.3, 0.8);
    scene.add(dirLight);
    const rimLight = new THREE.DirectionalLight(0xaaccff, 0.45);
    rimLight.position.set(-0.6, -0.7, -1.0);
    scene.add(rimLight);

    const ballVectors = Array.from({ length: PREVIEW_SHADER_BALL_LIMIT }, () => new THREE.Vector4());
    const raymarchUniforms = {
      isoLevel: { value: 1 },
      ballCount: { value: 0 },
      ballData: { value: ballVectors },
      boundsMin: { value: new THREE.Vector3(-120, -120, -120) },
      boundsMax: { value: new THREE.Vector3(120, 120, 120) },
      boundsSize: { value: new THREE.Vector3(240, 240, 240) },
      marchSteps: { value: 96 },
      lightDir: { value: new THREE.Vector3(0.6, 0.8, 0.3).normalize() },
      viewMatrixInverse: { value: new THREE.Matrix4() },
      projectionMatrixInverse: { value: new THREE.Matrix4() },
      colorPositive: { value: new THREE.Color(0x3a6ea5) },
      colorNegative: { value: new THREE.Color(0xd45500) }
    };

    const quadGeometry = new THREE.PlaneGeometry(2, 2);
    const quadMaterial = new THREE.ShaderMaterial({
      uniforms: raymarchUniforms,
      vertexShader: PREVIEW_VERTEX_SHADER,
      fragmentShader: PREVIEW_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false
    });
    const metaballSurface = new THREE.Mesh(quadGeometry, quadMaterial);
    metaballSurface.frustumCulled = false;
    scene.add(metaballSurface);

    const tempCenter = new THREE.Vector3();
    const reusedOffset = new THREE.Vector3();
    let lastCenter = new THREE.Vector3();
    let lastExtent = 150;
    let currentView = 'iso';
    let initialized = false;

    function updateBallUniforms(balls = []) {
      const count = Math.min(balls.length, PREVIEW_SHADER_BALL_LIMIT);
      raymarchUniforms.ballCount.value = count;
      for (let i = 0; i < count; i++) {
        const vector = ballVectors[i];
        const ball = balls[i];
        const radius = Math.max(0.001, Number(ball.r) || 0);
        vector.set(
          Number(ball.x) || 0,
          Number(ball.y) || 0,
          Number(ball.z) || 0,
          ball.negative ? -radius : radius
        );
      }
      for (let i = count; i < PREVIEW_SHADER_BALL_LIMIT; i++) {
        ballVectors[i].set(0, 0, 0, 0);
      }
      raymarchUniforms.ballData.needsUpdate = true;
    }

    function updateBoundsUniform(bounds) {
      const fallback = bounds || {
        x: { min: -100, max: 100 },
        y: { min: -100, max: 100 },
        z: { min: -100, max: 100 }
      };
      const bMin = raymarchUniforms.boundsMin.value;
      const bMax = raymarchUniforms.boundsMax.value;
      bMin.set(
        fallback.x?.min ?? -100,
        fallback.y?.min ?? -100,
        fallback.z?.min ?? -100
      );
      bMax.set(
        fallback.x?.max ?? 100,
        fallback.y?.max ?? 100,
        fallback.z?.max ?? 100
      );
      raymarchUniforms.boundsSize.value.set(bMax.x - bMin.x, bMax.y - bMin.y, bMax.z - bMin.z);
    }

    function setQuality(fast) {
      raymarchUniforms.marchSteps.value = fast ? 48 : 96;
    }

    function syncCameraUniforms() {
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      raymarchUniforms.viewMatrixInverse.value.copy(camera.matrixWorld);
      raymarchUniforms.projectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
    }

    function render({ skipControlsUpdate = false } = {}) {
      if (!skipControlsUpdate) {
        controls.update();
      }
      syncCameraUniforms();
      renderer.render(scene, camera);
    }

    controls.addEventListener('change', () => render({ skipControlsUpdate: true }));

    function resize() {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    }

    function setView(view = currentView) {
      const distance = Math.max(120, lastExtent * 2.2);
      const center = lastCenter;
      let offset;
      switch (view) {
        case 'front':
          offset = [0, 0, distance];
          break;
        case 'side':
          offset = [0, distance, 0];
          break;
        case 'bottom':
          offset = [distance, 0, 0];
          break;
        default:
          view = 'iso';
          offset = [distance * 0.65, distance * 0.45, distance];
          break;
      }
      currentView = view;
      camera.position.set(center.x + offset[0], center.y + offset[1], center.z + offset[2]);
      controls.target.copy(center);
      controls.update();
      render({ skipControlsUpdate: true });
    }

    function updateScene({ balls = [], center, extent, bounds, iso, fast }) {
      const targetCenter = center || { x: 0, y: 0, z: 0 };
      tempCenter.set(targetCenter.x, targetCenter.y, targetCenter.z);
      lastExtent = Math.max(10, extent || 120);
      updateBallUniforms(balls);
      updateBoundsUniform(bounds);
      raymarchUniforms.isoLevel.value = iso || 1;
      setQuality(Boolean(fast));

      if (!initialized) {
        lastCenter.copy(tempCenter);
        initialized = true;
        setView('iso');
        resize();
        return;
      }

      if (!tempCenter.equals(lastCenter)) {
        reusedOffset.subVectors(camera.position, controls.target);
        controls.target.copy(tempCenter);
        camera.position.copy(tempCenter).add(reusedOffset);
        lastCenter.copy(tempCenter);
        controls.update();
      }
      render({ skipControlsUpdate: true });
    }

    return {
      resize,
      setView,
      updateScene,
      render
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
    if (!previewViewport) return;
    const extent = getSceneExtent();
    const center = getSceneCenter();
    const iso = parseFloat(thresholdInput.value) || 1;
    previewViewport.updateScene({
      balls: editorState.balls,
      center,
      extent,
      bounds: axisBounds,
      iso,
      fast: interactionState.fastMode
    });
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

  function setPreviewView(view) {
    if (previewViewport) {
      previewViewport.setView(view);
    }
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
    drawPreview3D,
    setPreviewView,
    panViews,
    zoomViews,
    beginFastRender,
    endFastRender
  };
}
