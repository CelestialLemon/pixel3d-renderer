declare module 'virtual:baked-scenes' {
  const manifest: Record<string, { url: string; paletteSize: number; limits: Record<string, number> }>;
  export default manifest;
}
