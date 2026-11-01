// =============================================================================
// journey.js — the five beats of the story and the progress bar at the top.
//
// Each beat file registers itself with Twill.journey.register({...}):
//   id      short name, e.g. 'signup'
//   label   text in the progress bar
//   render  function(stageElement) that draws the beat
// Clicking a beat in the progress bar jumps straight to it.
// =============================================================================

window.Twill = window.Twill || {};

Twill.journey = (function () {
  const beats = [];
  const done = new Set();
  let current = null;
  const stage = document.getElementById('stage');
  const stepsEl = document.getElementById('journey-steps');

  function register(beat) {
    beats.push(beat);
  }

  function drawProgress() {
    stepsEl.innerHTML = beats
      .map((b, i) => {
        const cls = b.id === current ? 'current' : done.has(b.id) ? 'done' : '';
        return `<li class="${cls}"><button type="button" data-beat="${b.id}"><span class="num">${done.has(b.id) && b.id !== current ? '✓' : i + 1}</span>${b.label}</button></li>`;
      })
      .join('');
  }

  function go(id) {
    const beat = beats.find((b) => b.id === id);
    if (!beat) return;
    current = id;
    drawProgress();
    Twill.panel.divider(`Beat ${beats.indexOf(beat) + 1} · ${beat.label}`);
    stage.scrollTop = 0;
    beat.render(stage);
  }

  // Called by a beat when Leo finishes it.
  function complete(id) {
    done.add(id);
    drawProgress();
  }

  function reset() {
    done.clear();
    go(beats[0].id);
  }

  stepsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-beat]');
    if (btn) go(btn.dataset.beat);
  });

  return { register, go, complete, reset, get beats() { return beats; }, get current() { return current; } };
})();
