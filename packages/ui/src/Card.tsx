import React from 'react';
export const Card: React.FC<React.PropsWithChildren<{ className?: string }>> = ({
  className,
  children,
}) => <div className={['card', className].filter(Boolean).join(' ')}>{children}</div>;
