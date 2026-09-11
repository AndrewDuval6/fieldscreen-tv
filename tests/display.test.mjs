import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { displayLayout } from '../scripts/display-core.mjs';
const { windowBounds } = createRequire(import.meta.url)('../desktop/display.cjs');

test('fullscreen launch uses the actual Deck display instead of a 1600px window', () => {
  const display = { bounds:{x:0,y:0,width:1280,height:800}, workArea:{x:0,y:0,width:1280,height:760} };
  assert.deepEqual(windowBounds(display,true),display.bounds);
  const windowed = windowBounds(display,false);
  assert(windowed.x >= 0 && windowed.y >= 0);
  assert(windowed.x + windowed.width <= 1280);
  assert(windowed.y + windowed.height <= 760);
});
test('external and scaled displays use logical bounds, including negative monitor positions', () => {
  const display = { bounds:{x:-1920,y:0,width:1920,height:1080}, scaleFactor:2 };
  assert.deepEqual(windowBounds(display,true),display.bounds);
});
test('auto changes between a virtual Deck panel and TV without cropping either', () => {
  assert.deepEqual(displayLayout(1280,800),{ mode:'deck',width:1280,height:800 });
  assert.deepEqual(displayLayout(1920,1080),{ mode:'tv',width:1920,height:1080 });
  assert.deepEqual(displayLayout(3840,2160),{ mode:'tv',width:3840,height:2160 });
  assert.deepEqual(displayLayout(1280,800),{ mode:'deck',width:1280,height:800 });
  assert.deepEqual(displayLayout(1280,800,'tv'),{ mode:'tv',width:1280,height:720 });
  assert.deepEqual(displayLayout(1280,720,'deck'),{ mode:'deck',width:1280,height:720 });
  for (const [width,height] of [[800,600],[960,540],[3440,1440],[1920,1080]]) {
    const fit = displayLayout(width,height);
    assert(fit.width <= width && fit.height <= height);
  }
});
