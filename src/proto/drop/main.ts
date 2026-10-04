// Cat Drop (starter): a squishy cat falls down a shaft. Replaced by the full
// prototype; kept tiny so the page, the build and the kit can be checked.
import '@fontsource/baloo-2/latin-700.css';
import '@fontsource/baloo-2/latin-800.css';
import '@fontsource/nunito/latin-700.css';
import '../proto.css';
import { AudioEngine } from '../../audio/audio';
import { capsule } from '../../physics/shapes';
import { SoftBody } from '../../physics/softbody';
import { World } from '../../physics/world';
import { CatPainter, Lerp, Loop, bindPointer, makeStage, unlockAudioOnGesture } from '../kit';

const W = 380;
const world = new World();
const painter = new CatPainter();
const lerp = new Lerp();
const audio = new AudioEngine();
unlockAudioOnGesture(audio);

// a shaft with a few shelves
world.addStatic(capsule(10, -200, 10, 4000, 10, { material: 'wood' }));
world.addStatic(capsule(370, -200, 370, 4000, 10, { material: 'wood' }));
for (let k = 0; k < 12; k++) {
  const y = 300 + k * 280;
  if (k % 2) world.addStatic(capsule(10, y, 230, y + 30, 8, { material: 'wood' }));
  else world.addStatic(capsule(150, y + 30, 370, y, 8, { material: 'wood' }));
}
const cat = world.addBody(new SoftBody('tabby', 190, 80));

const stage = makeStage(document.getElementById('game') as HTMLCanvasElement);
let camY = 0;
bindPointer(stage.canvas, {
  up(_x, _y, info) {
    if (info.tap) {
      cat.kick(0, -420);
      audio.boop(1);
    }
  },
});

new Loop(
  () => {
    lerp.remember([cat]);
    world.step();
  },
  (alpha, dt) => {
    const { ctx } = stage;
    stage.screen();
    ctx.fillStyle = '#efe0c8';
    ctx.fillRect(0, 0, stage.w, stage.h);
    const s = stage.w / W;
    cat.computeCentroid();
    camY += (cat.cy - stage.h / s / 3 - camY) * Math.min(1, dt * 6);
    stage.world(s, 0, -camY * s);
    ctx.fillStyle = '#b48a5e';
    for (const st of world.statics) {
      ctx.beginPath();
      ctx.moveTo(st.xs[0], st.ys[0]);
      for (let i = 1; i < st.n; i++) ctx.lineTo(st.xs[i], st.ys[i]);
      ctx.closePath();
      ctx.lineWidth = st.radius * 2;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#b48a5e';
      ctx.stroke();
      ctx.fill();
    }
    painter.tick(dt);
    lerp.begin([cat], alpha);
    painter.draw(ctx, cat, { expression: cat.airborneFrames > 6 ? 'wide' : 'open' });
    lerp.end();
  },
).start();

(window as unknown as { __drop: unknown }).__drop = { world, cat };
