import { editorState } from './state.js';
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js?module';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js?module';

const PREVIEW_SHADER_BALL_LIMIT = 64;
const PREVIEW_SHADER_MAX_STEPS = 160;
const PREVIEW_SHADER_MAX_HITS = 10;
const SLICE_SHADER_BALL_LIMIT = 128;
const SLICE_SHADER_MAX_SAMPLES = 64;

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
  #define MAX_RAY_HITS ${PREVIEW_SHADER_MAX_HITS}

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
    float positive;
  };

  float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
  }

  FieldSample sampleField(vec3 p) {
    FieldSample result;
    result.total = 0.0;
    result.negative = 0.0;
    result.positive = 0.0;
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
        result.positive += contrib;
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

  vec3 cameraWorldPosition() {
    return vec3(viewMatrixInverse[3][0], viewMatrixInverse[3][1], viewMatrixInverse[3][2]);
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

  vec4 shadeSurface(vec3 ro, vec3 hitPos, int componentIndex) {
    vec3 normal = estimateNormal(hitPos, componentIndex);
    vec3 baseColor = componentIndex == 1 ? colorNegative : colorPositive;
    vec3 l = normalize(lightDir);
    float ndotl = clamp(dot(normal, l), 0.0, 1.0);
    vec3 viewDir = normalize(ro - hitPos);
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 1.8);
    float ambient = 0.6;
    float diffuse = ambient + 0.4 * ndotl;
    vec3 color = baseColor * diffuse + fresnel * 0.12 * baseColor;
    float alpha = componentIndex == 1 ? 0.4 : 1.0;
    return vec4(color, alpha);
  }

  void main() {
    if (ballCount == 0) {
      discard;
    }

    vec3 ro = cameraWorldPosition();
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
    float stepSize = max(range / float(steps), 0.35);
    float tPrev = tNear;
    if (tPrev > tFar) {
      discard;
    }
    FieldSample prevSample = sampleField(ro + rd * tPrev);
    float posPrev = prevSample.total - isoLevel;
    float negPrev = prevSample.negative - isoLevel;

    vec4 accumulated = vec4(0.0);
    int hits = 0;

    for (int i = 0; i < MAX_MARCH_STEPS && hits < MAX_RAY_HITS; i++) {
      float tCurr = tPrev + stepSize;
      if (tCurr > tFar) {
        break;
      }
      FieldSample currSample = sampleField(ro + rd * tCurr);
      float posCurr = currSample.total - isoLevel;
      float negCurr = currSample.negative - isoLevel;

      bool found = false;
      int component = 0;
      float hitT = 0.0;

      if (posPrev < 0.0 && posCurr >= 0.0) {
        float denom = posPrev - posCurr;
        float frac = denom != 0.0 ? posPrev / denom : 0.5;
        frac = clamp(frac, 0.0, 1.0);
        hitT = mix(tPrev, tCurr, frac);
        component = 0;
        found = true;
      } else if (negPrev < 0.0 && negCurr >= 0.0) {
        float denom = negPrev - negCurr;
        float frac = denom != 0.0 ? negPrev / denom : 0.5;
        frac = clamp(frac, 0.0, 1.0);
        hitT = mix(tPrev, tCurr, frac);
        component = 1;
        found = true;
      }

      if (found) {
        vec3 hitPos = ro + rd * hitT;
        vec4 shaded = shadeSurface(ro, hitPos, component);
        float remain = 1.0 - accumulated.a;
        accumulated.rgb += shaded.rgb * shaded.a * remain;
        accumulated.a += shaded.a * remain;
        hits += 1;
        if (accumulated.a > 0.98) break;
        float exitStep = stepSize * 0.5;
        tPrev = hitT + exitStep;
        if (tPrev > tFar) break;
        FieldSample afterSample = sampleField(ro + rd * tPrev);
        posPrev = afterSample.total - isoLevel;
        negPrev = afterSample.negative - isoLevel;
        continue;
      }

      tPrev = tCurr;
      posPrev = posCurr;
      negPrev = negCurr;
    }

    if (accumulated.a <= 0.0) {
      discard;
    }
    gl_FragColor = accumulated;
  }
`;

const SLICE_VERTEX_SHADER = `#version 300 es
in vec2 position;
out vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const SLICE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

#define MAX_SLICE_BALLS ${SLICE_SHADER_BALL_LIMIT}
#define MAX_SLICE_SAMPLES ${SLICE_SHADER_MAX_SAMPLES}

uniform vec2 uCanvasSize;
uniform vec2 uOffset;
uniform float uZoom;
uniform vec2 uAxisRange;
uniform float uIso;
uniform int uSamples;
uniform int uBallCount;
uniform vec4 uBallData[MAX_SLICE_BALLS]; // x,y,z,rSigned
uniform int uViewMode; // 0=xy,1=xz,2=yz
uniform vec3 uColorPositive;
uniform vec3 uColorNegative;

in vec2 vUv;
out vec4 fragColor;

struct FieldSample {
  float total;
  float negative;
};

FieldSample sampleField(vec3 p) {
  FieldSample f;
  f.total = 0.0;
  f.negative = 0.0;
  for (int i = 0; i < MAX_SLICE_BALLS; i++) {
    if (i >= uBallCount) break;
    vec4 ball = uBallData[i];
    if (ball.w == 0.0) continue;
    vec3 diff = p - ball.xyz;
    float dist = length(diff);
    dist = max(dist, 0.0001);
    float contrib = abs(ball.w) / dist;
    if (ball.w < 0.0) {
      f.negative += contrib;
      f.total -= contrib;
    } else {
      f.total += contrib;
    }
  }
  return f;
}

vec2 screenToWorld(vec2 fragCoord) {
  float x = (fragCoord.x - 0.5 * uCanvasSize.x) / uZoom - uOffset.x;
  float y = (0.5 * uCanvasSize.y - fragCoord.y) / uZoom - uOffset.y;
  return vec2(x, y);
}

void main() {
  vec2 fragCoord = vec2(vUv.x * uCanvasSize.x, vUv.y * uCanvasSize.y);
  vec2 plane = screenToWorld(fragCoord);

  bool exceedsPositive = false;
  bool exceedsNegative = false;

  for (int si = 0; si < MAX_SLICE_SAMPLES; si++) {
    if (si >= uSamples) break;
    float t = (uSamples == 1) ? 0.5 : float(si) / float(uSamples - 1);
    float axisValue = mix(uAxisRange.x, uAxisRange.y, t);
    vec3 p;
    if (uViewMode == 0) { // xy
      p = vec3(plane.x, plane.y, axisValue);
    } else if (uViewMode == 1) { // xz
      p = vec3(plane.x, axisValue, plane.y);
    } else { // yz
      p = vec3(axisValue, plane.y, plane.x);
    }

    FieldSample sample = sampleField(p);
    if (sample.total >= uIso) {
      exceedsPositive = true;
    }
    if (sample.negative >= uIso) {
      exceedsNegative = true;
    }
    if (exceedsPositive && exceedsNegative) break;
  }

  if (!exceedsPositive && !exceedsNegative) {
    fragColor = vec4(0.0);
    return;
  }

  float alpha = 200.0 / 255.0;
  vec3 color;
  if (exceedsPositive && exceedsNegative) {
    color = (uColorPositive + uColorNegative) * 0.5;
  } else if (exceedsPositive) {
    color = uColorPositive;
  } else {
    color = uColorNegative;
  }
  fragColor = vec4(color, alpha);
}
`;

export function createRenderer({ xyCanvas, xzCanvas, yzCanvas, previewCanvas, thresholdInput, resolutionInput }) {
  const xyCtx = xyCanvas.getContext('2d');
  const xzCtx = xzCanvas.getContext('2d');
  const yzCtx = yzCanvas.getContext('2d');

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

  const sliceRenderer = createSliceRenderer();

  const previewViewport = createThreePreview(previewCanvas);
  function createSliceRenderer() {
    const glCanvases = { xy: null, xz: null, yz: null };
    const glContexts = { xy: null, xz: null, yz: null };
    const glResources = { xy: null, xz: null, yz: null };
    let supported = false;

    function initContext(view) {
      if (glContexts[view]) return glContexts[view];
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
      glCanvases[view] = canvas;
      glContexts[view] = gl;
      if (!gl) return null;
      const program = createProgram(gl, SLICE_VERTEX_SHADER, SLICE_FRAGMENT_SHADER);
      if (!program) return gl;
      supported = true;
      const attribBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, attribBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        -1, 1,
        1, -1,
        1, 1
      ]), gl.STATIC_DRAW);
      const uniforms = {
        position: gl.getAttribLocation(program, 'position'),
        canvasSize: gl.getUniformLocation(program, 'uCanvasSize'),
        offset: gl.getUniformLocation(program, 'uOffset'),
        zoom: gl.getUniformLocation(program, 'uZoom'),
        axisRange: gl.getUniformLocation(program, 'uAxisRange'),
        iso: gl.getUniformLocation(program, 'uIso'),
        ballCount: gl.getUniformLocation(program, 'uBallCount'),
        ballData: gl.getUniformLocation(program, 'uBallData'),
        samples: gl.getUniformLocation(program, 'uSamples'),
        viewMode: gl.getUniformLocation(program, 'uViewMode'),
        colorPositive: gl.getUniformLocation(program, 'uColorPositive'),
        colorNegative: gl.getUniformLocation(program, 'uColorNegative')
      };
      glResources[view] = { program, attribBuf, uniforms };
      return gl;
    }

    function createProgram(gl, vsSource, fsSource) {
      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, vsSource);
      gl.compileShader(vs);
      if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
        console.warn(gl.getShaderInfoLog(vs));
      }
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, fsSource);
      gl.compileShader(fs);
      if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
        console.warn(gl.getShaderInfoLog(fs));
      }
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn(gl.getProgramInfoLog(prog));
      }
      return prog;
    }

    function renderSlice(view, options) {
      const gl = initContext(view);
      const resources = glResources[view];
      if (!gl || !resources || !resources.program || gl.isContextLost()) {
        supported = false;
        return null;
      }
      const canvas = glCanvases[view];
      const {
        width,
        height,
        resolution,
        offsetX,
        offsetY,
        zoom,
        axisRange,
        iso,
        samples,
        balls
      } = options;

      canvas.width = Math.max(1, resolution);
      canvas.height = Math.max(1, resolution);
      gl.viewport(0, 0, canvas.width, canvas.height);

      const { program, attribBuf, uniforms } = resources;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, attribBuf);
      gl.enableVertexAttribArray(uniforms.position);
      gl.vertexAttribPointer(uniforms.position, 2, gl.FLOAT, false, 0, 0);

      gl.uniform2f(uniforms.canvasSize, width, height);
      gl.uniform2f(uniforms.offset, offsetX, offsetY);
      gl.uniform1f(uniforms.zoom, zoom);
      gl.uniform2f(uniforms.axisRange, axisRange.min, axisRange.max);
      gl.uniform1f(uniforms.iso, iso);
      gl.uniform1i(uniforms.samples, Math.min(samples, SLICE_SHADER_MAX_SAMPLES));
      gl.uniform1i(uniforms.viewMode, view === 'xy' ? 0 : view === 'xz' ? 1 : 2);

      const count = Math.min(balls.length, SLICE_SHADER_BALL_LIMIT);
      const ballData = new Float32Array(SLICE_SHADER_BALL_LIMIT * 4);
      for (let i = 0; i < count; i++) {
        const b = balls[i];
        const radius = Math.max(0.001, Number(b.r) || 0);
        ballData[i * 4 + 0] = Number(b.x) || 0;
        ballData[i * 4 + 1] = Number(b.y) || 0;
        ballData[i * 4 + 2] = Number(b.z) || 0;
        ballData[i * 4 + 3] = b.negative ? -radius : radius;
      }
      gl.uniform1i(uniforms.ballCount, count);
      gl.uniform4fv(uniforms.ballData, ballData);
      gl.uniform3f(uniforms.colorPositive, 70 / 255, 130 / 255, 180 / 255);
      gl.uniform3f(uniforms.colorNegative, 230 / 255, 110 / 255, 30 / 255);

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return canvas;
    }

    return {
      renderSlice,
      isSupported: () => supported
    };
  }


  function createThreePreview(container) {
    if (!container) return null;

    const toolbar = container.querySelector('.three-preview__toolbar');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0xffffff, 1);
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
      colorPositive: { value: new THREE.Color(0x5a93d6) },
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
    const tempDirection = new THREE.Vector3();
    let lastCenter = new THREE.Vector3();
    let lastExtent = 150;
    let currentView = 'iso';
    let initialized = false;
    const viewPresets = {
      iso: {
        dir: new THREE.Vector3(0.75, 0.75, -0.75),
        up: new THREE.Vector3(0, -1, 0)
      },
      front: {
        dir: new THREE.Vector3(0, 0, -1),
        up: new THREE.Vector3(0, -1, 0)
      },
      side: {
        dir: new THREE.Vector3(0, -1, 0),
        up: new THREE.Vector3(-1, 0, 0)
      },
      bottom: {
        dir: new THREE.Vector3(0, -1, 0),
        up: new THREE.Vector3(0, 0, 1)
      }
    };

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

    function setQuality(factor) {
      const safeFactor = Number.isFinite(factor) ? factor : 1;
      const clamped = Math.max(0.5, Math.min(1, safeFactor));
      const steps = Math.round(48 + (96 - 48) * clamped);
      raymarchUniforms.marchSteps.value = steps;
    }

    function syncCameraUniforms() {
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      raymarchUniforms.viewMatrixInverse.value.copy(camera.matrixWorld);
      raymarchUniforms.projectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      const lightDirWorld = new THREE.Vector3(-0.6, 0.8, 0.4)
        .normalize()
        .applyQuaternion(camera.quaternion);
      raymarchUniforms.lightDir.value.copy(lightDirWorld).normalize();
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
      const resolvedView = viewPresets[view] ? view : 'iso';
      const preset = viewPresets[resolvedView];
      const distance = Math.max(120, lastExtent * 2.2);
      const center = lastCenter;
      tempDirection.copy(preset.dir).normalize().multiplyScalar(distance);
      camera.up.copy(preset.up);
      controls.object.up.copy(preset.up);
      camera.position.set(center.x + tempDirection.x, center.y + tempDirection.y, center.z + tempDirection.z);
      currentView = resolvedView;
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
      setQuality(typeof fast === 'number' ? fast : qualityFactor());

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
    qualityScale: 1,
    fullQualityTimer: null
  };

  const perfMonitor = {
    lastFrameTime: performance.now(),
    smoothedDelta: 16.7
  };

  function qualityFactor() {
    return Math.max(0.5, Math.min(1, interactionState.qualityScale || 1));
  }

  function currentResolution(canvas) {
    const userBase = Math.max(10, parseInt(resolutionInput.value, 10) || 120);
    const base = Math.max(userBase, Math.max(canvas?.width || 0, canvas?.height || 0) * 0.75);
    const capped = Math.min(640, base);
    const scale = qualityFactor();
    return Math.max(10, Math.round(capped * scale));
  }

  function currentSamples(maxSamples, minSamples) {
    const scale = qualityFactor();
    const hi = Math.max(1, maxSamples);
    const lo = Math.max(1, Math.min(minSamples, hi));
    const value = lo + (hi - lo) * scale;
    return Math.max(1, Math.round(value));
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
      interactionState.qualityScale = Math.min(1, interactionState.qualityScale + 0.1);
      flushPendingRender();
      renderInternal({ deferFullRedraw: true });
    }, 120);
  }

  function beginFastRender() {
    clearFullQualityTimer();
    // quality now adapts based on measured frame time; no forced drop here
  }

  function endFastRender({ immediate = false } = {}) {
    if (immediate) {
      clearFullQualityTimer();
      flushPendingRender();
      renderInternal({ deferFullRedraw: true });
    } else {
      scheduleFullQualityRedraw();
    }
  }

  function drawIsosurface(ctx, canvas, view) {
    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) return;

    const iso = parseFloat(thresholdInput.value) || 1;
    const resolution = currentResolution(canvas);
    const missingAxis = view === 'xy' ? 'z' : view === 'xz' ? 'y' : 'x';
    const samples = currentSamples(6, 2);
    const viewStateEntry = viewState[view];
    const axisRange = axisBounds[missingAxis];
    const slice = sliceRenderer.isSupported()
      ? sliceRenderer.renderSlice(view, {
          width,
          height,
          resolution,
          offsetX: viewStateEntry.offsetX,
          offsetY: viewStateEntry.offsetY,
          zoom: viewStateEntry.zoom,
          axisRange,
          iso,
          samples,
          balls: editorState.balls
        })
      : null;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    if (slice) {
      ctx.drawImage(slice, 0, 0, slice.width, slice.height, 0, 0, width, height);
    } else {
      drawIsosurfaceCpu(ctx, view, iso, resolution, samples, axisRange, width, height);
    }
    ctx.restore();
  }

  function drawIsosurfaceCpu(ctx, view, iso, resolution, samples, axisRange, width, height) {
    const stepX = width / resolution;
    const stepY = height / resolution;
    const imgData = ctx.createImageData(resolution, resolution);
    const data = imgData.data;
    for (let iy = 0; iy < resolution; iy++) {
      const sampleY = iy * stepY + stepY / 2;
      for (let ix = 0; ix < resolution; ix++) {
        const sampleX = ix * stepX + stepX / 2;
        let coords;
        if (view === 'xy') coords = screenToWorldXY(sampleX, sampleY);
        else if (view === 'xz') coords = screenToWorldXZ(sampleX, sampleY);
        else coords = screenToWorldYZ(sampleX, sampleY);

        let exceedsPositive = false;
        let exceedsNegative = false;
        for (let si = 0; si < samples; si++) {
          const t = samples === 1 ? 0.5 : si / (samples - 1);
          const axisValue = axisRange.min + t * (axisRange.max - axisRange.min);
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
          let total = 0;
          let neg = 0;
          for (let bi = 0; bi < editorState.balls.length; bi++) {
            const ball = editorState.balls[bi];
            const dx = wx - ball.x;
            const dy = wy - ball.y;
            const dz = wz - ball.z;
            const dist = Math.hypot(dx, dy, dz) || 1e-6;
            const contrib = ball.r / dist;
            if (ball.negative) {
              neg += Math.abs(contrib);
              total -= Math.abs(contrib);
            } else {
              total += Math.abs(contrib);
            }
          }
          if (total >= iso) exceedsPositive = true;
          if (neg >= iso) exceedsNegative = true;
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
    const temp = document.createElement('canvas');
    temp.width = resolution;
    temp.height = resolution;
    temp.getContext('2d')?.putImageData(imgData, 0, 0);
    ctx.drawImage(temp, 0, 0, resolution, resolution, 0, 0, width, height);
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

  function expandBounds(bounds, pad = 80) {
    if (!bounds) {
      return {
        x: { min: -100 - pad, max: 100 + pad },
        y: { min: -100 - pad, max: 100 + pad },
        z: { min: -100 - pad, max: 100 + pad }
      };
    }
    return {
      x: { min: bounds.x.min - pad, max: bounds.x.max + pad },
      y: { min: bounds.y.min - pad, max: bounds.y.max + pad },
      z: { min: bounds.z.min - pad, max: bounds.z.max + pad }
    };
  }

  function drawPreview3D() {
    if (!previewViewport) return;
    const extent = getSceneExtent();
    const center = getSceneCenter();
    const iso = parseFloat(thresholdInput.value) || 1;
    const bounds = expandBounds(axisBounds, 80);
    previewViewport.updateScene({
      balls: editorState.balls,
      center,
      extent,
      bounds,
      iso,
      fast: qualityFactor()
    });
  }

  function drawXY() {
    drawIsosurface(xyCtx, xyCanvas, 'xy');

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
    drawIsosurface(xzCtx, xzCanvas, 'xz');

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
    drawIsosurface(yzCtx, yzCanvas, 'yz');

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
    axisBounds = computeAxisBounds();
    drawXY();
    drawXZ();
    drawYZ();
    drawPreview3D();

    trackPerf();
  }

  let pendingRender = null;
  let pendingRenderOptions = null;

  function trackPerf() {
    const now = performance.now();
    const delta = now - perfMonitor.lastFrameTime;
    perfMonitor.lastFrameTime = now;
    if (!Number.isFinite(delta) || delta <= 0) return;
    const alpha = 0.12;
    perfMonitor.smoothedDelta = perfMonitor.smoothedDelta * (1 - alpha) + delta * alpha;
    const target = 16.67;
    const proposedScale = Math.max(0.5, Math.min(1, target / Math.max(8, perfMonitor.smoothedDelta)));
    const blend = 0.18;
    interactionState.qualityScale = interactionState.qualityScale * (1 - blend) + proposedScale * blend;
  }

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
