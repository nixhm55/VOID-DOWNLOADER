'use client';

import { useEffect, useRef } from 'react';

import './StarBorder.css';

const THEMES = {
  dark: {
    surface: '#0c0c0f',
    text: '#fafafa',
    track: 'rgba(255, 255, 255, 0.1)',
    light: '#ffffff'
  },
  light: {
    surface: '#ffffff',
    text: '#18181b',
    track: 'rgba(24, 24, 27, 0.12)',
    light: '#18181b'
  }
};

const HOVERS = ['lap', 'brighten', 'reveal', 'none'];
const BLEED = 48;
const LAP = 0.9;
const TAU = Math.PI * 2;
const WHITE = [255, 255, 255];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const wrap = (value, total) => ((value % total) + total) % total;
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (2 - 2 * t) ** 3 / 2);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (rgb, alpha) =>
  `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${clamp(alpha, 0, 1).toFixed(3)})`;

let colorContext = null;

const toRgb = color => {
  colorContext = colorContext ?? document.createElement('canvas').getContext('2d');
  if (!colorContext) return WHITE;
  colorContext.fillStyle = '#000000';
  colorContext.fillStyle = color;
  const value = String(colorContext.fillStyle);
  if (value.startsWith('#')) {
    const hex = parseInt(value.slice(1, 7), 16);
    return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  }
  const parts = value.match(/[\d.]+/g)?.map(Number) ?? WHITE;
  return [parts[0], parts[1], parts[2]];
};

const outline = (width, height, radius) => {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const arc = (Math.PI * r) / 2;
  const across = Math.max(0, width - 2 * r);
  const down = Math.max(0, height - 2 * r);
  const segments = [
    { length: across, x: r, y: 0, dx: 1, dy: 0, angle: null },
    { length: arc, x: width - r, y: r, dx: 0, dy: 0, angle: -Math.PI / 2 },
    { length: down, x: width, y: r, dx: 0, dy: 1, angle: null },
    { length: arc, x: width - r, y: height - r, dx: 0, dy: 0, angle: 0 },
    { length: across, x: width - r, y: height, dx: -1, dy: 0, angle: null },
    { length: arc, x: r, y: height - r, dx: 0, dy: 0, angle: Math.PI / 2 },
    { length: down, x: 0, y: height - r, dx: 0, dy: -1, angle: null },
    { length: arc, x: r, y: r, dx: 0, dy: 0, angle: Math.PI }
  ];
  return {
    r,
    segments,
    total: Math.max(
      1,
      segments.reduce((sum, segment) => sum + segment.length, 0)
    )
  };
};

const pointAt = (shape, distance, point) => {
  let s = wrap(distance, shape.total);
  for (const segment of shape.segments) {
    if (segment.length > 0 && s <= segment.length) {
      if (segment.angle === null) {
        point.x = segment.x + segment.dx * s;
        point.y = segment.y + segment.dy * s;
        point.nx = segment.dy;
        point.ny = -segment.dx;
      } else {
        const angle = segment.angle + s / shape.r;
        point.nx = Math.cos(angle);
        point.ny = Math.sin(angle);
        point.x = segment.x + point.nx * shape.r;
        point.y = segment.y + point.ny * shape.r;
      }
      return point;
    }
    s -= segment.length;
  }
  return point;
};

const project = (shape, px, py) => {
  let best = Infinity;
  let found = 0;
  let offset = 0;
  shape.segments.forEach(segment => {
    if (segment.length > 0) {
      let s = 0;
      let x = 0;
      let y = 0;
      if (segment.angle === null) {
        s = clamp((px - segment.x) * segment.dx + (py - segment.y) * segment.dy, 0, segment.length);
        x = segment.x + segment.dx * s;
        y = segment.y + segment.dy * s;
      } else {
        let angle = wrap(Math.atan2(py - segment.y, px - segment.x) - segment.angle, TAU);
        if (angle > Math.PI / 2) angle = angle > Math.PI * 1.25 ? 0 : Math.PI / 2;
        s = angle * shape.r;
        x = segment.x + Math.cos(segment.angle + angle) * shape.r;
        y = segment.y + Math.sin(segment.angle + angle) * shape.r;
      }
      const distance = (px - x) ** 2 + (py - y) ** 2;
      if (distance < best) {
        best = distance;
        found = offset + s;
      }
    }
    offset += segment.length;
  });
  return found;
};

const StarBorder = ({
  as: Component = 'button',
  children,
  className = '',
  style,
  color = '#94a3b8',
  trailColor = '#94a3b8',
  duration = 9,
  thickness = 2,
  radius = 12,
  trailLength = 0.4,
  stars = 1,
  glow = 0.75,
  sparkle = false,
  active = true,
  direction = 'clockwise',
  hover = 'none',
  clickPulse = false,
  theme = 'dark',
  backgroundColor,
  textColor,
  borderColor,
  ...rest
}) => {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const wakeRef = useRef(null);
  const palette = THEMES[theme] ?? THEMES.dark;
  const light = color ?? palette.light;
  const settings = {
    light: theme === 'light',
    color: light,
    trailColor: trailColor ?? light,
    duration: Math.max(0.3, duration),
    thickness: Math.max(0.5, thickness),
    radius: Math.max(0, radius),
    trailLength: clamp(trailLength, 0, 1),
    stars: clamp(Math.round(stars), 1, 6),
    glow: clamp(glow, 0, 1),
    sparkle,
    active: active !== false,
    direction: direction === 'counterclockwise' ? -1 : 1,
    hover: HOVERS.includes(hover) ? hover : 'none',
    clickPulse
  };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!root || !canvas || !ctx) return undefined;

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const point = { x: 0, y: 0, nx: 0, ny: -1 };
    const state = {
      width: 0,
      height: 0,
      dpr: 1,
      phase: 0,
      velocity: 0,
      motion: 0,
      lap: -1,
      time: 0,
      reveal: settingsRef.current.active ? 1 : 0,
      boost: 0,
      flash: 0,
      emit: 0,
      hovered: false,
      focused: false,
      pointerX: 0,
      pointerY: 0,
      visible: true
    };
    const pulses = [];
    const dust = [];
    const colors = { key: '', head: WHITE, tail: WHITE };
    let raf = 0;
    let last = performance.now();
    let alive = true;

    const shapeFor = s =>
      outline(
        Math.max(1, state.width - s.thickness),
        Math.max(1, state.height - s.thickness),
        s.radius - s.thickness / 2
      );

    const stroke = (x1, y1, x2, y2, width, strokeStyle) => {
      ctx.lineWidth = width;
      ctx.strokeStyle = strokeStyle;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };

    const drawTrail = (s, shape, head, length, sign, intensity, tip = true) => {
      if (length < 0.5 || intensity <= 0) return;
      const steps = clamp(Math.ceil(length / 6), 10, 56);
      pointAt(shape, head, point);
      let px = point.x;
      let py = point.y;
      for (let i = 1; i <= steps; i++) {
        pointAt(shape, head - sign * length * (i / steps), point);
        const u = 1 - (i - 0.5) / steps;
        const fade = u * u * intensity;
        let tone = mix(colors.tail, colors.head, u);
        if (!s.light) tone = mix(tone, WHITE, u ** 4 * 0.82);
        ctx.lineCap = tip && i === 1 ? 'round' : 'butt';
        stroke(px, py, point.x, point.y, 2 + 6 * s.glow, rgba(tone, fade * (s.light ? 0.1 : 0.22) * s.glow));
        stroke(px, py, point.x, point.y, s.thickness, rgba(tone, fade));
        px = point.x;
        py = point.y;
      }
    };

    const drawHead = (s, x, y, intensity, twinkle) => {
      if (intensity <= 0) return;
      const tone = colors.head;
      const reach = (16 + 44 * s.glow) * (s.light ? 0.6 : 1);
      const bloom = ctx.createRadialGradient(x, y, 0, x, y, reach);
      const strength = (s.light ? 0.12 : 0.52) * s.glow * intensity;
      bloom.addColorStop(0, rgba(WHITE, Math.min(1, strength * 1.35)));
      bloom.addColorStop(0.18, rgba(mix(tone, WHITE, 0.55), strength * 0.72));
      bloom.addColorStop(0.48, rgba(tone, strength * 0.22));
      bloom.addColorStop(1, rgba(tone, 0));
      ctx.fillStyle = bloom;
      ctx.fillRect(x - reach, y - reach, reach * 2, reach * 2);

      // Luminous glowing pointer head at the leading tip of the line
      const coreRadius = (2.4 + s.thickness * 1.15) * (0.92 + 0.08 * twinkle);
      const core = ctx.createRadialGradient(x, y, 0, x, y, coreRadius * 2.6);
      core.addColorStop(0, rgba(WHITE, Math.min(1, intensity * 1.15)));
      core.addColorStop(0.32, rgba(mix(tone, WHITE, 0.75), Math.min(1, intensity * 0.92)));
      core.addColorStop(0.68, rgba(tone, intensity * 0.38));
      core.addColorStop(1, rgba(tone, 0));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(x, y, coreRadius * 2.6, 0, TAU);
      ctx.fill();

      // Crisp star-glint shine on the leading pointer tip
      const spike = (4.5 + 5 * s.glow + s.thickness * 1.4) * (0.88 + 0.12 * twinkle);
      const center = s.light ? tone : WHITE;
      const horizontal = ctx.createLinearGradient(x - spike, y, x + spike, y);
      horizontal.addColorStop(0, rgba(tone, 0));
      horizontal.addColorStop(0.5, rgba(center, Math.min(1, intensity * 0.92)));
      horizontal.addColorStop(1, rgba(tone, 0));
      stroke(x - spike, y, x + spike, y, s.light ? 0.85 : 1.15, horizontal);
      const vertical = ctx.createLinearGradient(x, y - spike, x, y + spike);
      vertical.addColorStop(0, rgba(tone, 0));
      vertical.addColorStop(0.5, rgba(center, Math.min(1, intensity * 0.92)));
      vertical.addColorStop(1, rgba(tone, 0));
      stroke(x, y - spike, x, y + spike, s.light ? 0.85 : 1.15, vertical);
    };

    const spawnDust = (x, y, nx, ny, speed) => {
      if (dust.length > 48) return;
      const push = 3 + Math.random() * 10;
      const drift = (Math.random() - 0.5) * 8;
      dust.push({
        x: x + nx * (Math.random() * 3 - 1),
        y: y + ny * (Math.random() * 3 - 1),
        vx: nx * push - ny * drift - speed * -ny * 0.04,
        vy: ny * push + nx * drift - speed * nx * 0.04,
        age: 0,
        life: 0.35 + Math.random() * 0.5,
        size: 0.45 + Math.random() * 0.7,
        seed: Math.random() * TAU
      });
    };

    const draw = (base, shape) => {
      const s = state.boost > 0.001 ? { ...base, glow: Math.min(1.5, base.glow + 0.4 * state.boost) } : base;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (state.width < 2 || state.height < 2 || state.reveal <= 0.001) return;
      const offset = (BLEED + s.thickness / 2) * state.dpr;
      ctx.setTransform(state.dpr, 0, 0, state.dpr, offset, offset);
      ctx.globalCompositeOperation = s.light ? 'source-over' : 'lighter';
      ctx.lineCap = 'butt';

      const total = shape.total;
      const spacing = total / s.stars;
      const fullSpeed = Math.abs(total / s.duration);
      const speed = Math.max(fullSpeed * 0.35, Math.abs(state.motion));
      const sign = (state.motion !== 0 ? state.motion : s.direction) >= 0 ? 1 : -1;
      const span = s.trailLength * s.duration;
      const length = Math.min(speed * span, spacing * 0.92, total * 0.6) * (0.35 + 0.65 * state.reveal);
      const intensity = state.reveal * (1 + 0.4 * state.boost + 0.6 * state.flash);

      const ring = state.flash * (s.light ? 0.18 : 0.32) + state.boost * state.reveal * (s.light ? 0.07 : 0.12);
      if (ring > 0.005) {
        ctx.lineWidth = s.thickness + 2 * s.glow;
        ctx.strokeStyle = rgba(colors.head, ring);
        ctx.beginPath();
        ctx.roundRect(
          0,
          0,
          Math.max(1, state.width - s.thickness),
          Math.max(1, state.height - s.thickness),
          Math.max(0, shape.r)
        );
        ctx.stroke();
      }

      for (let i = 0; i < s.stars; i++) {
        const head = state.phase + i * spacing;
        drawTrail(s, shape, head, length, sign, Math.min(1, intensity));
      }

      pulses.forEach(pulse => {
        const progress = pulse.age / 0.65;
        const fade = (1 - progress) ** 2;
        const travel = (total / 2) * (1 - (1 - Math.min(1, pulse.age / 0.5)) ** 2);
        const tail = Math.min(travel, total * 0.16);
        [1, -1].forEach(way => {
          const front = pulse.origin + way * travel;
          drawTrail(s, shape, front, tail, way, fade);
          pointAt(shape, front, point);
          drawHead(s, point.x, point.y, fade * 0.8, 0.8);
        });
      });

      for (let i = 0; i < s.stars; i++) {
        pointAt(shape, state.phase + i * spacing, point);
        const twinkle = 0.86 + 0.14 * Math.sin(state.time * 5.2 + i * 2.3) * Math.sin(state.time * 2.4 + i);
        drawHead(s, point.x, point.y, Math.min(1.3, intensity), twinkle);
      }

      dust.forEach(mote => {
        const left = 1 - mote.age / mote.life;
        const shimmer = 0.45 + 0.55 * Math.sin(state.time * 20 + mote.seed);
        const alpha = left * shimmer * state.reveal * (s.light ? 0.35 : 0.9);
        if (alpha <= 0.01) return;
        ctx.fillStyle = rgba(s.light ? colors.head : mix(colors.tail, WHITE, 0.6), alpha);
        ctx.beginPath();
        ctx.arc(mote.x, mote.y, mote.size * (0.6 + 0.4 * left), 0, TAU);
        ctx.fill();
      });
    };

    const measure = () => {
      const nextWidth = root.offsetWidth;
      const nextHeight = root.offsetHeight;
      const nextDpr = Math.min(window.devicePixelRatio || 1, 1.5);
      if (nextWidth === state.width && nextHeight === state.height && nextDpr === state.dpr) {
        wake();
        return;
      }
      const prevTotal = state.width > 0 && state.height > 0 ? shapeFor(settingsRef.current).total : 0;
      state.width = nextWidth;
      state.height = nextHeight;
      state.dpr = nextDpr;
      canvas.width = Math.max(1, Math.round((state.width + BLEED * 2) * state.dpr));
      canvas.height = Math.max(1, Math.round((state.height + BLEED * 2) * state.dpr));
      const nextShape = shapeFor(settingsRef.current);
      if (prevTotal > 0 && nextShape.total > 0) {
        state.phase = (state.phase / prevTotal) * nextShape.total;
      }
      const s = settingsRef.current;
      const key = `${s.color}|${s.trailColor}`;
      if (key !== colors.key) {
        colors.key = key;
        colors.head = toRgb(s.color);
        colors.tail = toRgb(s.trailColor);
      }
      const cruise = reduce ? 0 : (s.direction * nextShape.total) / s.duration;
      if (state.velocity === 0 && s.active) {
        state.velocity = cruise;
        state.motion = cruise;
      }
      draw(s, nextShape);
      wake();
    };

    const local = event => {
      const rect = root.getBoundingClientRect();
      const scaleX = rect.width ? state.width / rect.width : 1;
      const scaleY = rect.height ? state.height / rect.height : 1;
      return [(event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY];
    };

    const frame = now => {
      raf = 0;
      if (!alive) return;
      const s = settingsRef.current;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      state.time += dt;

      const key = `${s.color}|${s.trailColor}`;
      if (key !== colors.key) {
        colors.key = key;
        colors.head = toRgb(s.color);
        colors.tail = toRgb(s.trailColor);
      }

      const shape = shapeFor(s);
      const total = shape.total;
      const spacing = total / s.stars;
      const engaged = state.hovered || state.focused;
      const cruise = reduce ? 0 : (s.direction * total) / s.duration;

      const baseRevealTarget = s.hover === 'reveal' && !engaged ? 0 : 1;
      const revealTarget = s.active ? baseRevealTarget : 0;

      if (revealTarget > state.reveal) {
        // Smooth fade-in when search opens or resets
        state.reveal += (revealTarget - state.reveal) * (1 - Math.exp(-dt / 0.32));
        if (revealTarget - state.reveal < 0.004) state.reveal = revealTarget;
      } else if (revealTarget < state.reveal) {
        // Slow, gentle fade-out ("malle malle slowly slowly fade out") when song list appears
        const expStep = (state.reveal - revealTarget) * (1 - Math.exp(-dt / 0.95));
        const linearTail = dt * 0.14;
        state.reveal = Math.max(revealTarget, state.reveal - Math.max(expStep, linearTail));
      }

      if (s.hover === 'none') {
        state.boost = 0;
        state.lap = -1;
        const targetVel = s.active ? cruise : cruise * 0.18;
        state.velocity += (targetVel - state.velocity) * (1 - Math.exp(-dt / (s.active ? 0.25 : 1.1)));
        state.motion = state.velocity;
        state.phase = wrap(state.phase + state.velocity * dt, total);
      } else {
        const boostTarget = s.hover === 'brighten' && engaged && s.active ? 1 : 0;
        state.boost += (boostTarget - state.boost) * (1 - Math.exp(-dt / (boostTarget > state.boost ? 0.18 : 0.5)));
        state.flash *= Math.exp(-dt / 0.22);

        const targetVel = s.active ? cruise : 0;
        state.velocity += (targetVel - state.velocity) * (1 - Math.exp(-dt / 0.55));
        let extra = 0;
        if (state.lap >= 0) {
          const before = ease(Math.min(1, state.lap / LAP));
          state.lap += dt;
          extra = (ease(Math.min(1, state.lap / LAP)) - before) * total * s.direction;
          if (state.lap >= LAP) state.lap = -1;
        }
        state.motion = state.velocity + extra / dt;
        state.phase = wrap(state.phase + state.velocity * dt + extra, total);
      }

      const pace = Math.abs(state.motion) / Math.max(1, Math.abs(total / s.duration));
      if (s.sparkle && !reduce && state.reveal > 0.05) {
        state.emit += dt * (2 + 6 * Math.min(2, pace)) * s.stars;
        while (state.emit > 1) {
          state.emit -= 1;
          pointAt(shape, state.phase + Math.floor(Math.random() * s.stars) * spacing, point);
          spawnDust(point.x, point.y, point.nx, point.ny, state.motion);
        }
      }
      for (let i = dust.length - 1; i >= 0; i--) {
        const mote = dust[i];
        mote.age += dt;
        mote.x += mote.vx * dt;
        mote.y += mote.vy * dt;
        mote.vx *= Math.exp(-dt * 2.2);
        mote.vy *= Math.exp(-dt * 2.2);
        if (mote.age >= mote.life) dust.splice(i, 1);
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        pulses[i].age += dt;
        if (pulses[i].age >= 0.65) pulses.splice(i, 1);
      }

      draw(s, shape);

      const boostTarget = s.hover === 'brighten' && engaged && s.active ? 1 : 0;
      const settling =
        Math.abs(revealTarget - state.reveal) > 0.002 ||
        Math.abs(boostTarget - state.boost) > 0.002 ||
        state.flash > 0.01 ||
        pulses.length > 0 ||
        dust.length > 0;
      const moving = Math.abs(state.motion) > 0.05 || cruise !== 0 || state.lap >= 0;
      const showing = state.reveal > 0.002 || revealTarget > 0;
      if (state.visible && (settling || (moving && showing))) {
        raf = requestAnimationFrame(frame);
      }
    };

    const wake = () => {
      if (raf || !alive || !state.visible) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    wakeRef.current = wake;

    const onEnter = event => {
      const s = settingsRef.current;
      if (s.hover === 'none') return;
      [state.pointerX, state.pointerY] = local(event);
      state.hovered = true;
      if (s.hover === 'reveal' && state.reveal < 0.15) {
        state.phase = project(shapeFor(s), state.pointerX - s.thickness / 2, state.pointerY - s.thickness / 2);
        state.velocity = 0;
      }
      if (s.hover === 'lap' && state.lap < 0 && !reduce) state.lap = 0;
      wake();
    };
    const onLeave = () => {
      if (settingsRef.current.hover === 'none') return;
      state.hovered = false;
      wake();
    };
    const pulse = origin => {
      if (!settingsRef.current.clickPulse) return;
      pulses.push({ origin, age: 0 });
      if (pulses.length > 4) pulses.shift();
      state.flash = 1;
      wake();
    };
    const onDown = event => {
      if (!settingsRef.current.clickPulse) return;
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const s = settingsRef.current;
      const [x, y] = local(event);
      pulse(project(shapeFor(s), x - s.thickness / 2, y - s.thickness / 2));
    };
    const onClick = event => {
      if (!settingsRef.current.clickPulse) return;
      if (event.detail === 0) pulse(state.phase);
    };
    const onFocus = () => {
      if (settingsRef.current.hover === 'none') return;
      state.focused = root.matches(':focus-visible');
      if (state.focused && settingsRef.current.hover === 'lap' && state.lap < 0 && !reduce) state.lap = 0;
      wake();
    };
    const onBlur = () => {
      if (settingsRef.current.hover === 'none') return;
      state.focused = false;
      wake();
    };

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(root);
    const visibility = new IntersectionObserver(entries => {
      state.visible = entries.some(entry => entry.isIntersecting);
      if (state.visible) wake();
    });
    visibility.observe(root);
    root.addEventListener('pointerenter', onEnter);
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('click', onClick);
    root.addEventListener('focus', onFocus);
    root.addEventListener('blur', onBlur);
    measure();

    return () => {
      alive = false;
      wakeRef.current = null;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      visibility.disconnect();
      root.removeEventListener('pointerenter', onEnter);
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('click', onClick);
      root.removeEventListener('focus', onFocus);
      root.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    wakeRef.current?.();
  });

  return (
    <Component
      ref={rootRef}
      className={`star-border${className ? ` ${className}` : ''}`}
      style={{
        '--star-border-radius': `${settings.radius}px`,
        '--star-border-thickness': `${settings.thickness}px`,
        '--star-border-surface': backgroundColor ?? palette.surface,
        '--star-border-text': textColor ?? palette.text,
        '--star-border-track': borderColor ?? palette.track,
        ...style
      }}
      {...(Component === 'button' && rest.type === undefined ? { type: 'button' } : null)}
      {...rest}
    >
      <canvas ref={canvasRef} className="star-border__light" aria-hidden="true" />
      {children}
    </Component>
  );
};

export default StarBorder;
