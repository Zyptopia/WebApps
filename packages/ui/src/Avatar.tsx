import React from 'react';
export const AvatarBox: React.FC<React.PropsWithChildren<{ size?: number }>> = ({
  size = 48,
  children,
}) => (
  <div style={{ width: size, height: size }} className="avatar">
    {children}
  </div>
);
