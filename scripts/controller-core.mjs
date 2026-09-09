export function nextFocus(items, current, direction) {
  if (!items.length) return -1;
  if (current < 0 || current >= items.length) return 0;
  const origin = items[current];
  const vector = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[direction];
  if (!vector) return current;
  let best = current;
  let bestScore = Infinity;
  items.forEach((item, index) => {
    if (index === current) return;
    const dx = item.x - origin.x, dy = item.y - origin.y;
    const forward = dx * vector[0] + dy * vector[1];
    if (forward < 2) return;
    const side = Math.abs(dx * vector[1] - dy * vector[0]);
    const score = forward + side * 3;
    if (score < bestScore) { best = index; bestScore = score; }
  });
  return best;
}

export function gamepadActions(pad, previous = {}, now = 0) {
  const pressed = index => Boolean(pad.buttons[index]?.pressed);
  const directions = {
    up: pressed(12) || (pad.axes[1] ?? 0) < -0.65,
    down: pressed(13) || (pad.axes[1] ?? 0) > 0.65,
    left: pressed(14) || (pad.axes[0] ?? 0) < -0.65,
    right: pressed(15) || (pad.axes[0] ?? 0) > 0.65,
  };
  const buttons = { accept: pressed(0), back: pressed(1), audio: pressed(2), layout: pressed(3), director: pressed(4), multiview: pressed(5), demo: pressed(9) };
  const state = { held: {}, nextRepeat: {} }, actions = [];
  for (const [name, held] of Object.entries({ ...directions, ...buttons })) {
    const wasHeld = previous.held?.[name];
    state.held[name] = held;
    const due = previous.nextRepeat?.[name] ?? 0;
    if (held && (!wasHeld || (name in directions && now >= due))) {
      actions.push(name);
      state.nextRepeat[name] = now + (wasHeld ? 180 : 420);
    } else state.nextRepeat[name] = due;
  }
  return { actions, state };
}
