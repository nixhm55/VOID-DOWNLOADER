import type { CSSProperties, HTMLAttributes } from 'react';

export interface GridScanProps extends HTMLAttributes<HTMLDivElement> {
  linesColor?: string;
  scanColor?: string;
  cells?: number;
  lineThickness?: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  depth?: number;
  depthFade?: number;
  parallax?: number;
  points?: boolean;
  reflection?: number;
  shading?: number;
  scanDirection?: 'forward' | 'backward' | 'pingpong';
  scanDuration?: number;
  scanDelay?: number;
  scanWidth?: number;
  trail?: number;
  glow?: number;
  autoScan?: boolean;
  interactive?: boolean;
  clickEffect?: 'ping' | 'scan' | 'none';
  enableWebcam?: boolean;
  showPreview?: boolean;
  modelsPath?: string;
  enableGyro?: boolean;
  intro?: boolean;
  lightMode?: boolean;
  dpr?: number;
  className?: string;
  style?: CSSProperties;
}

export declare const GridScan: (props: GridScanProps) => JSX.Element;
export default GridScan;
