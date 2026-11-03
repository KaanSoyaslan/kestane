// Draws the signs players describe to each other. Names stay out of the UI on
// purpose: finding the words is the game.
(function (root) {
  'use strict';

  const DOOR_COLORS = ['#ff5d5d', '#4db2ff', '#ffd84d', '#f5f5f5'];

  function symbolPath(ctx, index, x, y, s) {
    const r = s / 2;
    ctx.beginPath();
    switch (index) {
      case 0: // square
        ctx.rect(x - r * 0.82, y - r * 0.82, r * 1.64, r * 1.64);
        break;
      case 1: // triangle
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y + r * 0.8);
        ctx.lineTo(x - r, y + r * 0.8);
        ctx.closePath();
        break;
      case 2: // circle
        ctx.arc(x, y, r * 0.92, 0, Math.PI * 2);
        break;
      case 3: // star
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const d = i % 2 === 0 ? r : r * 0.42;
          ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
        }
        ctx.closePath();
        break;
      case 4: { // plus
        const t = r * 0.34;
        ctx.rect(x - t, y - r * 0.92, t * 2, r * 1.84);
        ctx.rect(x - r * 0.92, y - t, r * 1.84, t * 2);
        break;
      }
      case 5: // diamond
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r * 0.72, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r * 0.72, y);
        ctx.closePath();
        break;
      case 6: // crescent
        ctx.arc(x, y, r, 0.924, Math.PI * 2 - 0.924);
        ctx.arc(x + r * 0.55, y, r * 0.8, -1.505, 1.505, true);
        ctx.closePath();
        break;
      default: // heart
        ctx.moveTo(x, y + r * 0.9);
        ctx.bezierCurveTo(x - r * 1.5, y - r * 0.1, x - r * 0.7, y - r * 1.2, x, y - r * 0.35);
        ctx.bezierCurveTo(x + r * 0.7, y - r * 1.2, x + r * 1.5, y - r * 0.1, x, y + r * 0.9);
        ctx.closePath();
    }
  }

  function drawLabel(ctx, label, x, y, size, color) {
    ctx.save();
    if (label.kind === 'number') {
      ctx.fillStyle = color || '#ffffff';
      ctx.font = `800 ${size * 1.1}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(label.value), x, y + size * 0.05);
    } else {
      ctx.fillStyle = label.kind === 'door' ? DOOR_COLORS[label.color] : (color || '#ffffff');
      const index = label.kind === 'door' ? label.symbol : label.value;
      symbolPath(ctx, index, x, y, size);
      ctx.fill(index === 4 ? 'nonzero' : 'evenodd');
    }
    ctx.restore();
  }

  root.Glyphs = { drawLabel, DOOR_COLORS };
})(this);
