import { memo, useEffect, useRef } from 'react';

export interface VoiceSignalSnapshot {
  /** Real-time normalized microphone amplitude (0..1) */
  level: number;
  /** Sudden vocal transient / syllable attack (0..1) */
  onset: number;
  /** Low frequency vocal body (0..1) */
  low: number;
  /** Mid frequency vocal formants (0..1) */
  mid: number;
  /** High frequency sibilance / air (0..1) */
  high: number;
}

export interface SilverDustBackdropProps {
  active?: boolean;
  getVoiceSignal?: () => VoiceSignalSnapshot;
}

/**
 * High-Performance, Zero-Allocation 3D Silver Sand-Silk Veil
 * - Pre-warmed & paused when inactive so opening the Mic orb has 0ms initialization hitch.
 * - Uses a smooth radial bloom entrance envelope (0 -> 1) when activated so particles
 *   glide and expand outward in unison with the LiquidGlassOrb.
 */
export const SilverDustBackdrop = memo(function SilverDustBackdrop({
  active = true,
  getVoiceSignal,
}: SilverDustBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const getSignalRef = useRef(getVoiceSignal);
  getSignalRef.current = getVoiceSignal;
  const activeRef = useRef(active);
  activeRef.current = active;
  const wakeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (active) {
      wakeRef.current?.();
    }
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let width = 1;
    let height = 1;
    let imgData: ImageData | null = null;
    let buf32: Uint32Array | null = null;

    // 3 gossamer 3D silk lobes: 3 * 18 * 48 = 2,592 particles (ultra-fast typed array loop)
    const SHEETS = 3;
    const STRANDS = 18;
    const POINTS = 48;
    const totalParticles = SHEETS * STRANDS * POINTS;

    const sheetIdArr = new Uint8Array(totalParticles);
    const uArr = new Float32Array(totalParticles);
    const vArr = new Float32Array(totalParticles);
    const alphaArr = new Float32Array(totalParticles);
    const sizeModeArr = new Uint8Array(totalParticles);
    const scatterDirX = new Float32Array(totalParticles);
    const scatterDirY = new Float32Array(totalParticles);
    const scatterDirZ = new Float32Array(totalParticles);
    const scatterWeight = new Float32Array(totalParticles);

    const dispX = new Float32Array(totalParticles);
    const dispY = new Float32Array(totalParticles);
    const dispZ = new Float32Array(totalParticles);
    const velX = new Float32Array(totalParticles);
    const velY = new Float32Array(totalParticles);
    const velZ = new Float32Array(totalParticles);

    let seed = 0x5f3759df;
    const rand = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    };

    let idx = 0;
    for (let s = 0; s < SHEETS; s++) {
      for (let st = 0; st < STRANDS; st++) {
        const uBase = st / (STRANDS - 1);
        for (let p = 0; p < POINTS; p++) {
          const vBase = p / (POINTS - 1);
          sheetIdArr[idx] = s;
          uArr[idx] = Math.min(1, Math.max(0, uBase + (rand() - 0.5) * 0.032));
          vArr[idx] = Math.min(1, Math.max(0, vBase + (rand() - 0.5) * 0.024));

          const edgeFade = Math.sin(uBase * Math.PI) * Math.sin(vBase * Math.PI);
          alphaArr[idx] = (0.36 + rand() * 0.64) * (0.32 + 0.68 * edgeFade);

          const rSize = rand();
          sizeModeArr[idx] = rSize > 0.82 ? 2 : rSize > 0.36 ? 1 : 0;

          const theta = rand() * Math.PI * 2;
          const phi = Math.acos(2 * rand() - 1);
          scatterDirX[idx] = Math.sin(phi) * Math.cos(theta);
          scatterDirY[idx] = Math.sin(phi) * Math.sin(theta);
          scatterDirZ[idx] = Math.cos(phi);
          scatterWeight[idx] = 0.35 + rand() * 0.95;
          idx++;
        }
      }
    }

    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const nextW = Math.max(1, Math.round(rect.width * dpr));
      const nextH = Math.max(1, Math.round(rect.height * dpr));
      if (nextW === width && nextH === height && imgData) return;
      width = nextW;
      height = nextH;
      canvas.width = width;
      canvas.height = height;
      imgData = ctx.createImageData(width, height);
      buf32 = new Uint32Array(imgData.data.buffer);
    };

    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(canvas);

    let wanderX = 0;
    let wanderY = 0;
    let targetWanderX = (rand() - 0.5) * 0.14;
    let targetWanderY = (rand() - 0.5) * 0.12;

    let rotX = rand() * Math.PI * 2;
    let rotY = rand() * Math.PI * 2;
    let rotZ = rand() * Math.PI * 2;
    let velRotX = 0.0022;
    let velRotY = -0.0028;
    let velRotZ = 0.0018;
    let targetVelRotX = (rand() - 0.5) * 0.0055;
    let targetVelRotY = (rand() - 0.5) * 0.0062;
    let targetVelRotZ = (rand() - 0.5) * 0.0045;

    let morphA = rand() * 10;
    let morphB = rand() * 10;
    let morphC = rand() * 10;
    let nextRetarget = performance.now() + 2600;

    let smoothLevel = 0;
    let smoothSpread = 0;
    let smoothRipple = 0;
    let smoothSplash = 0;
    let prevRawLevel = 0;
    let entranceProgress = 0;
    let lastTime = performance.now();

    const draw = (now: number) => {
      raf = 0;
      if (!activeRef.current) return;

      const dt = Math.min(1.5, Math.max(0.4, (now - lastTime) / 16.667));
      lastTime = now;

      if (!imgData || !buf32) {
        measure();
        raf = window.requestAnimationFrame(draw);
        return;
      }

      // Smooth cubic ease-out entrance bloom (0 -> 1 over ~620ms)
      if (entranceProgress < 1) {
        entranceProgress = Math.min(1, entranceProgress + 0.026 * dt);
      }
      const easeOutEntrance = 1 - Math.pow(1 - entranceProgress, 3);

      if (now >= nextRetarget) {
        targetWanderX = (rand() - 0.5) * 0.14;
        targetWanderY = (rand() - 0.5) * 0.11;
        targetVelRotX = (rand() - 0.5) * 0.0052;
        targetVelRotY = (rand() - 0.5) * 0.0058;
        targetVelRotZ = (rand() - 0.5) * 0.0044;
        nextRetarget = now + 2400 + rand() * 2400;
      }

      const sig = getSignalRef.current?.() ?? {
        level: 0,
        onset: 0,
        low: 0,
        mid: 0,
        high: 0,
      };
      const rawLevel = Math.max(0, Math.min(1, sig.level));
      const delta = Math.max(0, rawLevel - prevRawLevel);
      prevRawLevel = rawLevel;
      const onset = Math.min(1, Math.max(sig.onset, delta * 1.6));

      // Ultra-smooth low-pass filtering so transitions are liquid-silky
      smoothLevel += (rawLevel - smoothLevel) * 0.065 * dt;
      const targetSpread = Math.min(0.42, smoothLevel * 0.32 + sig.low * 0.12);
      smoothSpread += (targetSpread - smoothSpread) * 0.06 * dt;

      const targetRipple = Math.min(0.3, smoothLevel * 0.2 + sig.mid * 0.14);
      smoothRipple += (targetRipple - smoothRipple) * 0.06 * dt;

      if (onset > 0.14 || rawLevel > 0.3) {
        smoothSplash = Math.min(0.48, smoothSplash + (onset * 0.18 + rawLevel * 0.07) * dt);
      }
      smoothSplash *= Math.pow(0.93, dt);

      const springK = 0.052;
      const damping = Math.pow(0.89, dt);
      const kick = smoothSplash * 0.005 * dt;

      for (let i = 0; i < totalParticles; i++) {
        if (kick > 0.0001) {
          const k = kick * scatterWeight[i];
          velX[i] += scatterDirX[i] * k;
          velY[i] += scatterDirY[i] * k;
          velZ[i] += scatterDirZ[i] * k;
        }
        velX[i] = (velX[i] - dispX[i] * springK * dt) * damping;
        velY[i] = (velY[i] - dispY[i] * springK * dt) * damping;
        velZ[i] = (velZ[i] - dispZ[i] * springK * dt) * damping;
        dispX[i] += velX[i] * dt;
        dispY[i] += velY[i] * dt;
        dispZ[i] += velZ[i] * dt;
      }

      const pace = 0.92 + smoothLevel * 0.24;
      wanderX += (targetWanderX - wanderX) * 0.007 * dt;
      wanderY += (targetWanderY - wanderY) * 0.007 * dt;
      velRotX += (targetVelRotX - velRotX) * 0.011 * dt;
      velRotY += (targetVelRotY - velRotY) * 0.011 * dt;
      velRotZ += (targetVelRotZ - velRotZ) * 0.011 * dt;

      rotX += velRotX * dt * pace;
      rotY += velRotY * dt * pace;
      rotZ += velRotZ * dt * pace;

      morphA += 0.0048 * dt * pace;
      morphB += 0.0041 * dt * pace;
      morphC += 0.0035 * dt * pace;

      const cxRot = Math.cos(rotX), sxRot = Math.sin(rotX);
      const cyRot = Math.cos(rotY), syRot = Math.sin(rotY);
      const czRot = Math.cos(rotZ), szRot = Math.sin(rotZ);

      const m00 = cyRot * czRot;
      const m01 = sxRot * syRot * czRot - cxRot * szRot;
      const m02 = cxRot * syRot * czRot + sxRot * szRot;
      const m10 = cyRot * szRot;
      const m11 = sxRot * syRot * szRot + cxRot * czRot;
      const m12 = cxRot * syRot * szRot - sxRot * czRot;
      const m20 = -syRot;
      const m21 = sxRot * cyRot;
      const m22 = cxRot * cyRot;

      buf32.fill(0);

      const centerX = width * (0.5 + wanderX);
      const centerY = height * (0.52 + wanderY + (1 - easeOutEntrance) * 0.04);
      const spreadScale = (0.64 + 0.36 * easeOutEntrance) * (1 + smoothSpread);
      const radiusX = width * 0.42 * spreadScale;
      const radiusY = height * 0.42 * spreadScale;
      const fov = 2.2;
      const wMax = width - 2;
      const hMax = height - 2;

      for (let i = 0; i < totalParticles; i++) {
        const sh = sheetIdArr[i];
        const u = uArr[i];
        const v = vArr[i];

        const shPhase = sh * 2.094395;
        const uc = (u - 0.5) * 2.1;
        const vc = (v - 0.5) * 2.1;

        const w1 = u * 4.4 + v * 2.2 + morphA + shPhase;
        const w2 = v * 4.8 - u * 2.6 + morphB - shPhase * 0.7;
        const w3 = (u - v) * 5.6 + morphC + shPhase * 1.2;

        const softRipple =
          smoothRipple > 0.005
            ? Math.sin(u * 10 + v * 8 - morphA * 2.4) * smoothRipple
            : 0;

        const px = uc + Math.sin(w2) * 0.34 + Math.cos(w3) * 0.18 + dispX[i];
        const py =
          vc * 0.68 +
          Math.cos(w1) * 0.36 +
          Math.sin(w3) * 0.22 +
          softRipple +
          dispY[i];
        const pz =
          Math.sin(w1) * 0.46 +
          Math.cos(w2 * 0.85) * 0.32 +
          softRipple * 0.6 +
          dispZ[i];

        const rx = m00 * px + m01 * py + m02 * pz;
        const ry = m10 * px + m11 * py + m12 * pz;
        const rz = m20 * px + m21 * py + m22 * pz;

        const depth = fov + rz;
        if (depth <= 0.25) continue;
        const invDepth = 1.45 / depth;

        const sx = (centerX + rx * radiusX * invDepth) | 0;
        const sy = (centerY + ry * radiusY * invDepth) | 0;

        if (sx < 1 || sx >= wMax || sy < 1 || sy >= hMax) continue;

        const depthLight = Math.min(1.25, Math.max(0.28, (1.55 - rz * 0.55) * 0.82));
        const aFloat = alphaArr[i] * depthLight * easeOutEntrance * (0.72 + smoothLevel * 0.28);
        const a = Math.min(255, (aFloat * 235) | 0);
        if (a < 8) continue;

        const lum = Math.min(255, ((195 + 60 * depthLight) * (a / 255)) | 0);
        const b = Math.min(255, (lum * 1.04) | 0);
        const g = Math.min(255, (lum * 0.99) | 0);
        const r = Math.min(255, (lum * 0.96) | 0);
        const color32 = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

        const pIdx = sy * width + sx;
        buf32[pIdx] = color32;

        const sMode = sizeModeArr[i];
        if (sMode >= 1) {
          const halfA = (a * 0.55) | 0;
          const halfLum = (lum * 0.55) | 0;
          const subColor = ((halfA << 24) | (halfLum << 16) | (halfLum << 8) | halfLum) >>> 0;
          buf32[pIdx + 1] = subColor;
          buf32[pIdx + width] = subColor;
          if (sMode === 2) {
            buf32[pIdx - 1] = subColor;
            buf32[pIdx - width] = subColor;
          }
        }
      }

      ctx.putImageData(imgData, 0, 0);
      raf = window.requestAnimationFrame(draw);
    };

    wakeRef.current = () => {
      measure();
      entranceProgress = 0;
      lastTime = performance.now();
      if (!raf && activeRef.current) {
        raf = window.requestAnimationFrame(draw);
      }
    };

    if (activeRef.current) {
      raf = window.requestAnimationFrame(draw);
    }

    return () => {
      wakeRef.current = null;
      if (raf) window.cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, []);

  return (
    <div className="palette-silver-dust-layer" aria-hidden="true">
      <canvas ref={canvasRef} className="palette-silver-dust-canvas" />
    </div>
  );
});

export default SilverDustBackdrop;
