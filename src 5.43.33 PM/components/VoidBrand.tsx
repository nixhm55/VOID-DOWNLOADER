import type { JSX } from 'react';
import ShinyText, { type ShinyTextProps } from './ShinyText';

export interface VoidBrandProps extends ShinyTextProps {
  readonly text?: string;
}

/**
 * Independent standalone VOID brand header component.
 * Kept decoupled from DesktopUI and MobileUI so it can be mounted or omitted independently.
 */
export function VoidBrand({
  text = 'VOID',
  className = '',
  speed = 2.6,
  delay = 0.4,
  color = '#8a919e',
  shineColor = '#ffffff',
  direction = 'left',
  yoyo = false,
  pauseOnHover = false,
  disabled = false,
  ...rest
}: VoidBrandProps): JSX.Element {
  return (
    <div className={`void-center-brand-wrap ${className}`.trim()}>
      <div className="void-center-brand" aria-label={text}>
        <ShinyText
          text={text}
          speed={speed}
          delay={delay}
          color={color}
          shineColor={shineColor}
          direction={direction}
          yoyo={yoyo}
          pauseOnHover={pauseOnHover}
          disabled={disabled}
          {...rest}
        />
      </div>
    </div>
  );
}

export default VoidBrand;
