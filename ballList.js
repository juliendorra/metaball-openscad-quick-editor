export function renderBallList({
  container,
  balls,
  selectedIndex,
  onSelect,
  onRadiusChange,
  removeButton
}) {
  container.innerHTML = '';

  balls.forEach((ball, index) => {
    const entry = document.createElement('div');
    entry.className = 'ball-entry';
    if (index === selectedIndex) {
      entry.style.background = '#e0f0ff';
    }

    const label = document.createElement('span');
    label.textContent = `Ball ${index + 1}`;
    entry.appendChild(label);

    const radiusInput = document.createElement('input');
    radiusInput.type = 'number';
    radiusInput.min = '1';
    radiusInput.step = '1';
    radiusInput.value = Math.round(ball.r);
    radiusInput.title = 'Radius';
    radiusInput.addEventListener('input', event => {
      const value = parseFloat(event.target.value);
      if (!Number.isFinite(value) || value <= 0) return;
      onRadiusChange?.(index, value);
    });
    entry.appendChild(radiusInput);

    entry.addEventListener('click', () => {
      onSelect?.(index);
    });

    container.appendChild(entry);
  });

  if (removeButton) {
    removeButton.disabled = selectedIndex < 0;
  }
}
