import test from 'node:test';
import assert from 'node:assert/strict';
import { nextFocus, gamepadActions } from '../scripts/controller-core.mjs';

const boxes = [{x:10,y:10},{x:110,y:10},{x:10,y:110},{x:110,y:110}];
test('directional focus follows a four-pane TV grid and stops at its edge', () => {
  assert.equal(nextFocus(boxes,0,'right'),1);
  assert.equal(nextFocus(boxes,1,'down'),3);
  assert.equal(nextFocus(boxes,3,'left'),2);
  assert.equal(nextFocus(boxes,0,'up'),0);
  assert.equal(nextFocus(boxes,-1,'down'),0);
  assert.equal(nextFocus([],0,'down'),-1);
});
const pad = (index, axes = [0,0]) => ({buttons:Array.from({length:16},(_,i)=>({pressed:i===index})),axes});
test('a held A button does not repeatedly activate a control', () => {
  const first = gamepadActions(pad(0),{},0);
  assert.deepEqual(first.actions,['accept']);
  assert.deepEqual(gamepadActions(pad(0),first.state,1000).actions,[]);
  const release = gamepadActions(pad(-1),first.state,1100);
  assert.deepEqual(gamepadActions(pad(0),release.state,1200).actions,['accept']);
});
test('D-pad hold repeats after a delay; stick drift stays quiet', () => {
  const first = gamepadActions(pad(15),{},0);
  assert.deepEqual(first.actions,['right']);
  assert.deepEqual(gamepadActions(pad(15),first.state,300).actions,[]);
  assert.deepEqual(gamepadActions(pad(15),first.state,421).actions,['right']);
  assert.deepEqual(gamepadActions(pad(-1,[.2,-.3]),{},0).actions,[]);
  assert.deepEqual(gamepadActions(pad(-1,[0,-.8]),{},0).actions,['up']);
});
