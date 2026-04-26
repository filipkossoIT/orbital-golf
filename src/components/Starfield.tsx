'use client';

import { useEffect, useRef } from 'react';
import { mulberry32 } from '@/lib/rng';

/**
 * Static starfield background. Re-rendered on resize.
 * Uses a fixed seed so it looks the same between sessions.
 */
export default function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const rng = mulberry32(0xc0ffee);

      // Nebula blobs
      for (let i = 0; i < 5; i++) {
        const cx = rng() * w;
        const cy = rng() * h;
        const rad = 180 * dpr + rng() * 300 * dpr;
        const hue = 220 + Math.floor(rng() * 80);
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        grd.addColorStop(0, `hsla(${hue}, 80%, 55%, 0.18)`);
        grd.addColorStop(1, 'hsla(240, 60%, 30%, 0)');
        ctx.fillStyle = grd;
        ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      }

      // Stars
      const count = Math.floor((w * h) / (8000 * dpr));
      for (let i = 0; i < count; i++) {
        const x = rng() * w;
        const y = rng() * h;
        const r = (rng() * rng() * 1.8 + 0.3) * dpr;
        ctx.fillStyle = `rgba(255, 255, 255, ${0.3 + rng() * 0.6})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none"
      aria-hidden
    />
  );
}
