export function displayLayout(width, height, preference = 'auto', display = {}) {
  const ratio = width / height;
  // Gamescope can expose a virtual display without the built-in-panel flag.
  const compactPanel = width <= 1280 && ratio >= 1.45 && ratio <= 1.7;
  const mode = preference === 'deck' || preference === 'auto' && (compactPanel || display.internal && width <= 1280) ? 'deck' : 'tv';
  const fittedWidth = mode === 'deck' ? width : Math.min(width, height * 16 / 9);
  return { mode, width: fittedWidth, height: mode === 'deck' ? height : fittedWidth * 9 / 16 };
}
