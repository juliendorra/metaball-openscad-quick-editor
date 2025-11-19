import { editorState, addBall, removeSelectedBall, setSelectedIndex, getSelectedBall } from './state.js';
import { createRenderer } from './rendering.js';
import { renderBallList } from './ballList.js';
import { buildScadCode } from './scad.js';

const xyCanvas = document.getElementById('xyCanvas');
const xzCanvas = document.getElementById('xzCanvas');
const yzCanvas = document.getElementById('yzCanvas');
const ballList = document.getElementById('ballList');
const addBtn = document.getElementById('addBtn');
const removeBtn = document.getElementById('removeBtn');
const thresholdInput = document.getElementById('threshold');
const resolutionInput = document.getElementById('res');
const scadTextarea = document.getElementById('scadcode');

const renderer = createRenderer({
  xyCanvas,
  xzCanvas,
  yzCanvas,
  thresholdInput,
  resolutionInput
});

const dragState = {
  active: false,
  view: null,
  offset: { dx: 0, dy: 0, dz: 0 }
};

function updateBallList() {
  renderBallList({
    container: ballList,
    balls: editorState.balls,
    selectedIndex: editorState.selectedIndex,
    onSelect: handleBallSelect,
    onRadiusChange: handleRadiusChange,
    removeButton: removeBtn
  });
}

function updateScad() {
  const threshold = parseFloat(thresholdInput.value) || 1;
  scadTextarea.value = buildScadCode(editorState.balls, threshold);
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

function handleWheel(event) {
  if (editorState.selectedIndex < 0) return;
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

xyCanvas.addEventListener('mousedown', event => handlePointerDown('xy', xyCanvas, event));
xzCanvas.addEventListener('mousedown', event => handlePointerDown('xz', xzCanvas, event));
yzCanvas.addEventListener('mousedown', event => handlePointerDown('yz', yzCanvas, event));

window.addEventListener('mousemove', handlePointerMove);
window.addEventListener('mouseup', stopDragging);

xyCanvas.addEventListener('wheel', handleWheel, { passive: false });
xzCanvas.addEventListener('wheel', handleWheel, { passive: false });
yzCanvas.addEventListener('wheel', handleWheel, { passive: false });

window.addEventListener('resize', () => renderer.resizeCanvases());
window.addEventListener('load', init);
