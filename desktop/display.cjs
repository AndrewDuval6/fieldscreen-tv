function windowBounds(display, fullscreen) {
  const area = fullscreen ? display.bounds : display.workArea;
  const width = fullscreen ? area.width : Math.min(1600, Math.floor(area.width * .92));
  const height = fullscreen ? area.height : Math.min(900, Math.floor(area.height * .92));
  return { x: area.x + Math.floor((area.width - width) / 2), y: area.y + Math.floor((area.height - height) / 2), width, height };
}

function displayState(display) {
  return { internal: display.internal === true, width: display.bounds.width, height: display.bounds.height, scaleFactor: display.scaleFactor };
}

module.exports = { windowBounds, displayState };
