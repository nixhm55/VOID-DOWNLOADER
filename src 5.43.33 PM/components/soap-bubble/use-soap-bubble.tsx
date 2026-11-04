/*!
ReactDrops Component License 1.0

Copyright (c) 2026 ReactDrops

1. Scope and definitions

This license applies to ReactDrops software and associated documentation that
expressly carry this license or are distributed under a LICENSE file containing
it (the "Software"). "Licensor" means the copyright holder granting rights in
the Software, and only to the extent that holder has authority to grant them.
"You" means the individual or entity exercising these rights.

An "End Product" is a website, application, service, or other finished project
whose primary purpose is something other than providing reusable components,
source code, templates, or development assets to others.

2. Permitted uses

Subject to this license, Licensor grants You a worldwide, non-exclusive,
royalty-free license to use, copy, modify, and incorporate the Software into
unlimited personal, internal, and commercial End Products. You may charge for
End Products, subscriptions, development services, and work for clients.

You may distribute the Software as an integrated part of an End Product,
including in browser-delivered JavaScript. You may provide End Product source
code to a client, and share the Software with employees and contractors who
need it to develop or maintain End Products. Those recipients may use the
Software for those purposes subject to this license. This permission does not
authorize them to redistribute the Software as a reusable development asset.

3. Restricted redistribution

Unless You obtain separate written permission from Licensor, You may not sell,
sublicense, publish, share, or otherwise redistribute the Software, or a
substantial portion of it, whether unchanged or modified:

(a) as a standalone component, component library, UI kit, source-code bundle,
    registry, or other collection of reusable development assets;
(b) as part of a theme, template, starter project, or similar product offered
    to multiple recipients for reuse in their own projects; or
(c) through a builder or generation service that offers the Software as
    reusable blocks or source-code exports for others' projects.

These restrictions apply to paid and free redistribution. Renaming, restyling,
repackaging, translating, or modifying the Software does not remove them.
Building separate finished websites or applications for multiple clients is
permitted; offering a reusable template or kit containing the Software is not.

Public source-code hosting by Licensor is not permission to republish the
Software under another license. This license does not override any separate
rights granted directly by Licensor or applicable code-hosting terms.

4. Notices and ownership

Retain this license and applicable copyright and third-party notices in source
copies of the Software and permitted source distributions. No visible credit
or ReactDrops logo is required in an End Product's user interface.

Licensor retains ownership of its Software. You retain rights in Your own
contributions, subject to the license for any incorporated Software. No rights
to trademarks, trade names, or logos are granted by this license.

5. Third-party materials and separate grants

Dependencies, fonts, images, videos, and other third-party materials remain
subject to their respective licenses. Separately identified third-party code
is licensed under its stated terms, and these restrictions do not limit rights
granted by its copyright holders. Retain all required third-party notices.
Demo media are not licensed by this document; obtain Your own permission or
replace them with media You are entitled to use.

This license does not revoke rights granted under other valid licenses. It does
not assert ownership of third-party work or grant rights Licensor lacks.

6. Termination

The permissions granted here continue unless terminated for a material breach.
If You fail to cure a material breach within 30 days after receiving written
notice from Licensor, Your permissions terminate. On termination, cease uses
and distributions requiring this license. Rights under independently granted
licenses and rights that applicable law does not allow to be restricted remain
unaffected. Sections 3 through 7 survive termination.

7. Disclaimer

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. TO THE MAXIMUM EXTENT
PERMITTED BY APPLICABLE LAW, LICENSOR AND CONTRIBUTORS SHALL NOT BE LIABLE FOR
ANY CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER IN CONTRACT, TORT, OR OTHERWISE,
ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR ITS USE.

This license does not limit rights or exceptions that applicable law makes
non-waivable. No other permissions are granted by implication.
*/

'use client';

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  createSoapBubbleRenderer,
  normalizeSoapBubble,
  type SoapBubbleLayer,
  type SoapBubbleRenderer,
  type SoapBubbleSettings,
  type SoapBubbleTuning,
} from './soap-bubble-renderer';

export type SoapBubbleBackdropProp = RefObject<HTMLElement | null> | HTMLElement | null;

export type SoapBubbleMaterialProps = Partial<SoapBubbleSettings> & {
  /**
   * Element behind the bubbles. Its pixels are seen through the film and
   * mirrored in the rims. Without it the live page shows through undistorted.
   */
  backdrop?: SoapBubbleBackdropProp;
};

const materialKeys = [
  'radius',
  'bevel',
  'thickness',
  'iridescence',
  'drainage',
  'swirl',
  'filmScale',
  'oilOpacity',
  'oilCoverage',
  'oilEdge',
  'oilEdgeFade',
  'clearCenter',
  'tint',
  'soapColor',
  'soapPalette',
  'soapPaletteRed',
  'soapPaletteGold',
  'soapPaletteGreen',
  'soapPaletteCyan',
  'soapPaletteBlue',
  'soapPaletteViolet',
  'soapShadeColor',
  'soapHighlightColor',
  'reflectivity',
  'mirage',
  'seeThrough',
  'seeThroughBend',
  'opacity',
  'floorLight',
  'reach',
  'refraction',
  'glass',
  'dispersion',
  'environment',
  'tilt',
  'wobble',
  'speed',
  'paused',
  'windowLight',
  'keyLight',
  'windowStyle',
  'windowLength',
  'windowMargin',
  'windowBend',
  'windowSize',
  'windowWidth',
  'windowGradient',
  'topFade',
  'topTail',
  'topLength',
  'windowHead',
  'windowTail',
  'glintShape',
  'glintSize',
  'glintIntensity',
  'glintDistance',
  'glintHeight',
  'windowIntensity',
  'windowTwin',
  'windowTwinShape',
  'bottomShade',
  'bottomShadeColor',
  'seed',
  'maxDpr',
] as const;
const materialKeySet = new Set<string>([...materialKeys, 'backdrop']);

/** Splits material props from everything else a component receives. */
export function splitMaterial<T extends SoapBubbleMaterialProps>(props: T) {
  const material: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (materialKeySet.has(key)) {
      if (value !== undefined) material[key] = value;
    } else rest[key] = value;
  }
  return [
    material as SoapBubbleMaterialProps,
    rest as Omit<T, keyof SoapBubbleMaterialProps>,
  ] as const;
}

const MaterialContext = createContext<SoapBubbleMaterialProps>({});

/** Shares one material and backdrop with every soap bubble component inside. */
export function SoapBubbleMaterial({
  children,
  ...material
}: SoapBubbleMaterialProps & { children?: ReactNode }) {
  const outer = useContext(MaterialContext);
  const [own] = splitMaterial(material);
  return (
    <MaterialContext.Provider value={{ ...outer, ...own }}>{children}</MaterialContext.Provider>
  );
}

/**
 * Light or dark, from the nearest data-theme attribute (as sites with a theme
 * switch set it) or else the system preference.
 */
function useColorScheme(host: RefObject<HTMLElement | null>) {
  const [scheme, setScheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const read = () => {
      const theme = host.current?.closest('[data-theme]')?.getAttribute('data-theme');
      setScheme(theme === 'dark' || (theme !== 'light' && query.matches) ? 'dark' : 'light');
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      subtree: true,
      attributeFilter: ['data-theme'],
    });
    query.addEventListener('change', read);
    return () => {
      observer.disconnect();
      query.removeEventListener('change', read);
    };
  }, [host]);
  return scheme;
}

/**
 * Runs one soap bubble: host is the bubble's box, canvas where it is drawn.
 * Component defaults sit under the shared material, own props over it.
 */
export function useSoapBubble({
  host,
  canvas,
  defaults,
  material,
  interactive = true,
  pointerTarget,
  adjust,
}: {
  host: RefObject<HTMLElement | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
  defaults?: Partial<SoapBubbleSettings>;
  material: SoapBubbleMaterialProps;
  interactive?: boolean;
  /** Element that receives pointer events; the host by default. */
  pointerTarget?: RefObject<HTMLElement | null>;
  /** Last word on the merged material, for parts that must stand out. */
  adjust?: (tuning: SoapBubbleTuning) => Partial<SoapBubbleTuning>;
}) {
  const shared = useContext(MaterialContext);
  const { backdrop: ownBackdrop, ...own } = material;
  const { backdrop: sharedBackdrop, ...sharedMaterial } = shared;
  const scheme = useColorScheme(host);
  const settings = { ...defaults, ...sharedMaterial, ...own };
  const merged = normalizeSoapBubble({
    ...settings,
    environment:
      settings.environment === 'auto'
        ? scheme === 'dark'
          ? 'studio'
          : 'soft'
        : settings.environment,
  });
  const tuning = adjust ? normalizeSoapBubble({ ...merged, ...adjust(merged) }) : merged;
  const backdrop = ownBackdrop !== undefined ? ownBackdrop : sharedBackdrop;
  const engine = useRef<SoapBubbleRenderer | null>(null);
  const [ready, setReady] = useState(false);
  const latest = useRef(tuning);
  latest.current = tuning;
  const key = JSON.stringify(tuning);
  useLayoutEffect(() => {
    host.current?.style.setProperty(
      '--soap-bubble-tint',
      tuning.tint.trim().toLowerCase() === 'auto' ? 'transparent' : tuning.tint,
    );
    for (const [key, value] of [
      ['soap-color', tuning.soapColor],
      ['soap-shade-color', tuning.soapShadeColor],
      ['soap-highlight-color', tuning.soapHighlightColor],
    ])
      host.current?.style.setProperty(
        `--soap-bubble-${key}`,
        value.trim().toLowerCase() === 'auto' ? 'transparent' : value,
      );
  }, [host, tuning.tint, tuning.soapColor, tuning.soapShadeColor, tuning.soapHighlightColor]);
  useLayoutEffect(() => {
    const colours = [
      tuning.soapPaletteRed,
      tuning.soapPaletteGold,
      tuning.soapPaletteGreen,
      tuning.soapPaletteCyan,
      tuning.soapPaletteBlue,
      tuning.soapPaletteViolet,
    ];
    const stops = [...colours, colours[0]].map(
      (colour) => `color-mix(in srgb, ${colour} ${tuning.oilOpacity * 60}%, transparent)`,
    );
    host.current?.style.setProperty(
      '--soap-bubble-custom-palette',
      tuning.soapPalette === 'custom'
        ? `conic-gradient(from 45deg, ${stops.join(', ')})`
        : 'linear-gradient(transparent, transparent)',
    );
  }, [
    host,
    tuning.soapPalette,
    tuning.oilOpacity,
    tuning.soapPaletteRed,
    tuning.soapPaletteGold,
    tuning.soapPaletteGreen,
    tuning.soapPaletteCyan,
    tuning.soapPaletteBlue,
    tuning.soapPaletteViolet,
  ]);
  // CSS motion (the press swell) follows the same jiggle as the film.
  useLayoutEffect(() => {
    host.current?.style.setProperty('--soap-bubble-wobble', String(tuning.wobble));
  }, [host, tuning.wobble]);

  useEffect(() => {
    if (!canvas.current || !host.current) return;
    let renderer: SoapBubbleRenderer | null = null;
    try {
      renderer = createSoapBubbleRenderer(canvas.current, host.current, latest.current, () =>
        setReady(true),
      );
    } catch {
      renderer = null;
    }
    engine.current = renderer;
    return () => {
      renderer?.dispose();
      engine.current = null;
    };
  }, [canvas, host]);
  useEffect(() => {
    const explicit = host.current?.closest('[data-theme]')?.getAttribute('data-theme');
    const light =
      explicit === 'light' ||
      (explicit !== 'dark' && !matchMedia('(prefers-color-scheme: dark)').matches);
    engine.current?.setLightTheme(light);
  }, [scheme, host]);
  useLayoutEffect(() => engine.current?.update(latest.current), [key]);
  const backdropElement = backdrop && 'current' in backdrop ? backdrop.current : (backdrop ?? null);
  useEffect(() => {
    engine.current?.setBackdrop(backdropElement);
  });

  useEffect(() => {
    if (!interactive) return;
    const element = (pointerTarget ?? host).current;
    const shape = host.current;
    if (!element || !shape) return;
    // Pointer position in bubble radii, y up, measured from the centre.
    const local = (event: PointerEvent) => {
      const rect = shape.getBoundingClientRect();
      const radius = Math.max(1, Math.min(shape.clientWidth, shape.clientHeight) / 2);
      return [
        (event.clientX - rect.left - rect.width / 2) / radius,
        -(event.clientY - rect.top - rect.height / 2) / radius,
      ] as const;
    };
    const disabled = () => (element as HTMLButtonElement).disabled === true;
    const onMove = (event: PointerEvent) => {
      const [x, y] = local(event);
      engine.current?.pointer(x, y, true);
    };
    const onLeave = (event: PointerEvent) => {
      const [x, y] = local(event);
      engine.current?.pointer(x, y, false);
      engine.current?.press(false);
    };
    const onDown = () => {
      if (!disabled()) engine.current?.press(true);
    };
    const onUp = () => engine.current?.press(false);
    // Typing in a field inside the bubble is not a press.
    const typing = (event: KeyboardEvent) =>
      (event.target as Element | null)?.matches?.('input, textarea, [contenteditable]') === true;
    const onKeyDown = (event: KeyboardEvent) => {
      if (typing(event)) return;
      if ((event.key === ' ' || event.key === 'Enter') && !event.repeat && !disabled())
        engine.current?.press(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (typing(event)) return;
      if (event.key === ' ' || event.key === 'Enter') engine.current?.press(false);
    };
    const onBlur = () => engine.current?.press(false);
    const listeners: [string, EventListener][] = [
      ['pointermove', onMove as EventListener],
      ['pointerenter', onMove as EventListener],
      ['pointerleave', onLeave as EventListener],
      ['pointercancel', onLeave as EventListener],
      ['pointerdown', onDown as EventListener],
      ['pointerup', onUp],
      ['keydown', onKeyDown as EventListener],
      ['keyup', onKeyUp as EventListener],
      ['blur', onBlur],
    ];
    listeners.forEach(([type, listener]) => element.addEventListener(type, listener));
    return () =>
      listeners.forEach(([type, listener]) => element.removeEventListener(type, listener));
  }, [interactive, host, pointerTarget]);

  return {
    ready,
    tuning,
    engine,
    setLayer: (layer: SoapBubbleLayer | null) => engine.current?.setLayer(layer),
  };
}
