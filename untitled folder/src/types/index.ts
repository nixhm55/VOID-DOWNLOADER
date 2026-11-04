import type { ReactNode } from 'react';

/**
 * Common strict props type for components that accept children and className.
 */
export interface BaseComponentProps {
  readonly className?: string;
  readonly children?: ReactNode;
}
