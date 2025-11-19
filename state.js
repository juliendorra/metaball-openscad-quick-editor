export const editorState = {
  balls: [],
  selectedIndex: -1
};

export function setSelectedIndex(index) {
  editorState.selectedIndex = index;
  return editorState.selectedIndex;
}

export function getSelectedBall() {
  const { balls, selectedIndex } = editorState;
  return selectedIndex >= 0 ? balls[selectedIndex] : null;
}

export function addBall(params = {}, defaultRadius = 50) {
  const radius = typeof params.r === 'number' ? params.r : defaultRadius;
  const index = editorState.balls.length;
  const ball = {
    x: typeof params.x === 'number' ? params.x : -radius,
    y: typeof params.y === 'number' ? params.y : 0,
    z: typeof params.z === 'number' ? params.z : 0,
    r: Math.max(1, radius || defaultRadius),
    name: typeof params.name === 'string' ? params.name : `Ball ${index + 1}`
  };

  editorState.balls.push(ball);
  editorState.selectedIndex = editorState.balls.length - 1;
  return ball;
}

export function removeSelectedBall() {
  if (editorState.selectedIndex < 0) return null;
  const [removed] = editorState.balls.splice(editorState.selectedIndex, 1);
  editorState.selectedIndex = -1;
  return removed || null;
}
