export function nativeFrame(value) {
  const body = Buffer.from(JSON.stringify(value));
  if (body.length > 1000000) throw new Error('Message too large for the extension');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}
export function nativeDecoder(onMessage) {
  let buffer = Buffer.alloc(0);
  return chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const size = buffer.readUInt32LE(0);
      if (size > 16 * 1024 * 1024) throw new Error('Frame too large');
      if (buffer.length < size + 4) break;
      onMessage(JSON.parse(buffer.subarray(4, size + 4).toString()));
      buffer = buffer.subarray(size + 4);
    }
  };
}
