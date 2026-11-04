import { createElement, useEffect, useRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';

/**
 * Sequential top-to-bottom IntersectionObserver reveal system for Deep Glass.
 * Sorts every entering batch strictly by visual top-to-bottom, left-to-right order
 * so items always cascade 1st -> 2nd -> 3rd -> 4th -> 5th one-by-one with smooth
 * blur and unhurried easing, never jumping out of order in the middle.
 */
type WatcherItem = {
  index: number;
  show: (waveOrder: number) => void;
};

const watchers = new WeakMap<Element, WatcherItem>();
let observer: IntersectionObserver | null = null;

function getObserver() {
  if (observer || typeof IntersectionObserver === 'undefined') return observer;
  observer = new IntersectionObserver(
    entries => {
      const visible = entries.filter(entry => entry.isIntersecting);
      if (!visible.length) return;

      // Sort strictly top-to-bottom, then left-to-right, then by logical index
      visible.sort((a, b) => {
        const dy = a.boundingClientRect.top - b.boundingClientRect.top;
        if (Math.abs(dy) > 8) return dy;
        const dx = a.boundingClientRect.left - b.boundingClientRect.left;
        if (Math.abs(dx) > 8) return dx;
        const wa = watchers.get(a.target)?.index ?? 0;
        const wb = watchers.get(b.target)?.index ?? 0;
        return wa - wb;
      });

      visible.forEach((entry, waveOrder) => {
        const item = watchers.get(entry.target);
        watchers.delete(entry.target);
        observer?.unobserve(entry.target);
        item?.show(waveOrder);
      });
    },
    { rootMargin: '0px 0px -2% 0px', threshold: 0.04 },
  );
  return observer;
}

export type RevealDir = 'left' | 'right' | 'up' | 'depth' | 'row';
type RevealTag = 'div' | 'section' | 'li' | 'article' | 'header' | 'p' | 'tr';

export interface RevealProps extends HTMLAttributes<HTMLElement> {
  as?: RevealTag;
  dir?: RevealDir;
  index?: number;
  children?: ReactNode;
}

export function Reveal({ as = 'div', dir = 'up', index = 0, className, style, children, ...rest }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const initialStagger = Math.min(Math.max(0, index), 14);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = getObserver();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!obs || reduce) {
      el.setAttribute('data-in', '');
      el.setAttribute('data-done', '');
      return;
    }

    const show = (waveOrder: number) => {
      // Preserve strict 1 -> 2 -> 3 -> 4 -> 5 one-by-one order within each visible wave
      const step = Math.min(waveOrder, 14);
      el.style.setProperty('--dg-i', String(step));
      el.setAttribute('data-in', '');
      window.setTimeout(() => el.setAttribute('data-done', ''), 1250 + step * 75);
    };

    watchers.set(el, { index, show });
    obs.observe(el);

    return () => {
      watchers.delete(el);
      obs.unobserve(el);
    };
  }, [index]);

  return createElement(
    as,
    {
      ref,
      className,
      'data-dg-r': dir,
      style: { ...style, '--dg-i': initialStagger } as CSSProperties,
      ...rest,
    },
    children,
  );
}

// Alias for DgReveal to ensure compatibility across imports
export const DgReveal = Reveal;

/**
 * Drives smooth parallax scroll transitions by writing scrollTop directly
 * to a CSS custom variable on the target element once per frame via requestAnimationFrame.
 */
export function useScrollVar(
  scroller: { current: HTMLElement | null },
  target: { current: HTMLElement | null },
  deps: unknown[],
) {
  useEffect(() => {
    const sc = scroller.current;
    const tg = target.current;
    if (!sc || !tg || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    const tick = () => {
      frame = 0;
      tg.style.setProperty('--dg-sy', String(Math.min(900, Math.round(sc.scrollTop))));
    };

    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(tick);
    };

    tick();
    sc.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      sc.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
