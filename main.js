import { editorState, addBall, removeSelectedBall, setSelectedIndex, getSelectedBall } from './state.js';
import { createRenderer } from './rendering.js';
import { renderBallList } from './ballList.js';
import { buildScadCode, parseScadCode } from './scad.js';

const xyCanvas = document.getElementById('xyCanvas');
const xzCanvas = document.getElementById('xzCanvas');
const yzCanvas = document.getElementById('yzCanvas');
const previewCanvas = document.getElementById('preview3D');
const ballList = document.getElementById('ballList');
const addBtn = document.getElementById('addBtn');
const removeBtn = document.getElementById('removeBtn');
const thresholdInput = document.getElementById('threshold');
const resolutionInput = document.getElementById('res');
const scadTextarea = document.getElementById('scadcode');
const importBtn = document.getElementById('importBtn');

const renderer = createRenderer({
  xyCanvas,
  xzCanvas,
  yzCanvas,
  previewCanvas,
  thresholdInput,
  resolutionInput
});

const dragState = {
  active: false,
  view: null,
  offset: { dx: 0, dy: 0, dz: 0 }
};

const cameraPanState = {
  active: false,
  lastX: 0,
  lastY: 0
};

const previewDragState = {
  active: false,
  lastX: 0,
  lastY: 0
};

function updateBallList() {
  renderBallList({
    container: ballList,
    balls: editorState.balls,
    selectedIndex: editorState.selectedIndex,
    onSelect: handleBallSelect,
    onRadiusChange: handleRadiusChange,
    onNameChange: handleNameChange,
    removeButton: removeBtn
  });
}

function updateScad() {
  const threshold = parseFloat(thresholdInput.value) || 1;
  scadTextarea.value = buildScadCode(editorState.balls, threshold);
}

function importFromScadText(scadText) {
  const parsed = parseScadCode(scadText);
  if (!parsed || !parsed.balls.length) return false;

  const importedBalls = parsed.balls.map((ball, index) => ({
    x: Number(ball.x) || 0,
    y: Number(ball.y) || 0,
    z: Number(ball.z) || 0,
    r: Math.max(1, Number(ball.r) || renderer.getDefaultRadius()),
    name: ball.name && ball.name.trim() ? ball.name.trim() : `Ball ${index + 1}`
  }));

  editorState.balls = importedBalls;
  editorState.selectedIndex = importedBalls.length ? 0 : -1;

  if (Number.isFinite(parsed.threshold)) {
    thresholdInput.value = parsed.threshold;
  }

  updateBallList();
  renderer.drawAll();
  updateScad();
  return true;
}

function addNewBall(x, y, z, r) {
  addBall({ x, y, z, r }, renderer.getDefaultRadius());
  updateBallList();
  updateScad();
  renderer.drawAll();
}

function handleBallSelect(index) {
  setSelectedIndex(index);
  updateBallList();
  renderer.drawAll();
}

function handleRadiusChange(index, radius) {
  editorState.balls[index].r = radius;
  renderer.drawAll();
  updateScad();
}

function handleNameChange(index, name) {
  const ball = editorState.balls[index];
  if (!ball) return;
  ball.name = name;
  updateScad();
}

function handleRemoval() {
  removeSelectedBall();
  updateBallList();
  updateScad();
  renderer.drawAll();
}

function pointerPosition(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    px: event.clientX - rect.left,
    py: event.clientY - rect.top
  };
}

function handlePointerDown(view, canvas, event) {
  const { px, py } = pointerPosition(canvas, event);
  const hitIndex = renderer.hitTest(view, px, py);
  setSelectedIndex(hitIndex);
  updateBallList();
  renderer.drawAll();

  if (hitIndex < 0) {
    dragState.active = false;
    if (editorState.selectedIndex < 0) {
      startCameraPan(event);
    }
    return;
  }

  dragState.active = true;
  dragState.view = view;

  const ball = editorState.balls[hitIndex];
  if (view === 'xy') {
    const { x, y } = renderer.screenToWorldXY(px, py);
    dragState.offset.dx = ball.x - x;
    dragState.offset.dy = ball.y - y;
    dragState.offset.dz = 0;
  } else if (view === 'xz') {
    const { x, z } = renderer.screenToWorldXZ(px, py);
    dragState.offset.dx = ball.x - x;
    dragState.offset.dy = 0;
    dragState.offset.dz = ball.z - z;
  } else {
    const { y, z } = renderer.screenToWorldYZ(px, py);
    dragState.offset.dx = 0;
    dragState.offset.dy = ball.y - y;
    dragState.offset.dz = ball.z - z;
  }
}

function handlePointerMove(event) {
  if (handleCameraPanMove(event)) return;
  if (!dragState.active || editorState.selectedIndex < 0) return;
  const ball = editorState.balls[editorState.selectedIndex];

  if (dragState.view === 'xy') {
    const { px, py } = pointerPosition(xyCanvas, event);
    const { x, y } = renderer.screenToWorldXY(px, py);
    ball.x = x + dragState.offset.dx;
    ball.y = y + dragState.offset.dy;
  } else if (dragState.view === 'xz') {
    const { px, py } = pointerPosition(xzCanvas, event);
    const { x, z } = renderer.screenToWorldXZ(px, py);
    ball.x = x + dragState.offset.dx;
    ball.z = z + dragState.offset.dz;
  } else if (dragState.view === 'yz') {
    const { px, py } = pointerPosition(yzCanvas, event);
    const { y, z } = renderer.screenToWorldYZ(px, py);
    ball.y = y + dragState.offset.dy;
    ball.z = z + dragState.offset.dz;
  }

  renderer.drawAll();
  updateScad();
}

function stopDragging() {
  dragState.active = false;
  dragState.view = null;
}

function startCameraPan(event) {
  cameraPanState.active = true;
  cameraPanState.lastX = event.clientX;
  cameraPanState.lastY = event.clientY;
  event.preventDefault();
}

function handleCameraPanMove(event) {
  if (!cameraPanState.active) return false;
  const dx = event.clientX - cameraPanState.lastX;
  const dy = event.clientY - cameraPanState.lastY;
  cameraPanState.lastX = event.clientX;
  cameraPanState.lastY = event.clientY;
  renderer.panViews(dx, dy);
  return true;
}

function stopCameraPan() {
  cameraPanState.active = false;
}

function handlePreviewPointerDown(event) {
  if (!previewCanvas) return;
  previewDragState.active = true;
  previewDragState.lastX = event.clientX;
  previewDragState.lastY = event.clientY;
  event.preventDefault();
}

function handlePreviewPointerMove(event) {
  if (!previewDragState.active) return;
  const dx = event.clientX - previewDragState.lastX;
  const dy = event.clientY - previewDragState.lastY;
  previewDragState.lastX = event.clientX;
  previewDragState.lastY = event.clientY;
  renderer.adjustPreviewRotation(dx, dy);
}

function stopPreviewDrag() {
  previewDragState.active = false;
}

function handleWheel(event) {
  if (editorState.selectedIndex < 0) {
    event.preventDefault();
    renderer.zoomViews(event.deltaY);
    return;
  }
  event.preventDefault();
  const ball = getSelectedBall();
  if (!ball) return;
  const delta = event.deltaY;
  const factor = 1 + (delta > 0 ? -0.05 : 0.05);
  ball.r = Math.max(5, ball.r * factor);
  updateBallList();
  renderer.drawAll();
  updateScad();
}

function init() {
  renderer.resizeCanvases();
  const defaultRadius = renderer.getDefaultRadius();
  addNewBall(-60, 0, 0, defaultRadius);
  addNewBall(60, 0, 0, defaultRadius);
}

addBtn.addEventListener('click', () => addNewBall());
removeBtn.addEventListener('click', handleRemoval);
window.addEventListener('keydown', event => {
  if (event.key === 'Delete' && editorState.selectedIndex >= 0) {
    handleRemoval();
  }
});

thresholdInput.addEventListener('input', () => {
  renderer.drawAll();
  updateScad();
});

resolutionInput.addEventListener('input', () => {
  renderer.drawAll();
});

if (importBtn) {
  importBtn.addEventListener('click', () => {
    if (!importFromScadText(scadTextarea.value)) {
      window.alert('Unable to import from the provided SCAD code. Please ensure it was generated by this editor.');
    }
  });
}

xyCanvas.addEventListener('mousedown', event => handlePointerDown('xy', xyCanvas, event));
xzCanvas.addEventListener('mousedown', event => handlePointerDown('xz', xzCanvas, event));
yzCanvas.addEventListener('mousedown', event => handlePointerDown('yz', yzCanvas, event));
if (previewCanvas) {
  previewCanvas.addEventListener('mousedown', handlePreviewPointerDown);
}

window.addEventListener('mousemove', event => {
  handlePointerMove(event);
  handlePreviewPointerMove(event);
});
window.addEventListener('mouseup', () => {
  stopDragging();
  stopCameraPan();
  stopPreviewDrag();
});

xyCanvas.addEventListener('wheel', handleWheel, { passive: false });
xzCanvas.addEventListener('wheel', handleWheel, { passive: false });
yzCanvas.addEventListener('wheel', handleWheel, { passive: false });

window.addEventListener('resize', () => renderer.resizeCanvases());
window.addEventListener('load', init);

window.addEventListener('dragover', event => {
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  event.preventDefault();
});

window.addEventListener('drop', event => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target?.result;
    if (typeof text !== 'string') return;
    if (!importFromScadText(text)) {
      window.alert('Unable to import from the dropped file.');
    }
  };
  reader.readAsText(file);
});
