import React from 'react';
export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { className?: string }> =
  ({ className, ...props }) => (<button {...props} className={[className].filter(Boolean).join(' ')} />);
