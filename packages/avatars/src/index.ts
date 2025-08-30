// Re-export the editor and helpers
export { AvatarEditor } from './AvatarEditor';
export { renderAvatar } from './renderAvatar';
export { rleEncode, rleDecode, bytesToBase64, base64ToBytes, base64Bytes } from './rle';
export { classic16 } from './palette';
export { getPresetIds } from './presets';

// IMPORTANT: re-export the SDK types so both packages agree 1:1
export type { Avatar, AvatarMeta } from '@sdk/game-sdk';
