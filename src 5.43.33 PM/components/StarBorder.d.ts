import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from 'react';

export interface StarBorderProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  color?: string;
  trailColor?: string;
  duration?: number;
  direction?: 'clockwise' | 'counterclockwise';
  stars?: number;
  trailLength?: number;
  thickness?: number;
  radius?: number;
  glow?: number;
  sparkle?: boolean;
  active?: boolean;
  hover?: 'lap' | 'brighten' | 'reveal' | 'none';
  clickPulse?: boolean;
  theme?: 'dark' | 'light';
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  [key: string]: any;
}

declare const StarBorder: (props: StarBorderProps) => JSX.Element;
export default StarBorder;
