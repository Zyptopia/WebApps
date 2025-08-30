import React from 'react';
export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { className?: string }> =
  ({ className, ...props }) => (<input {...props} className={[className].filter(Boolean).join(' ')} />);
