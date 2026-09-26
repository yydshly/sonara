// Preserve the original file separately. WAV rates can be read before decoding;
// other codecs use a 48 kHz editing copy rather than the previous 22.05 kHz copy.
export function editingSampleRate(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer), view = new DataView(arrayBuffer);
  const text = (at, length) => String.fromCharCode(...bytes.subarray(at, at + length));
  if (bytes.length >= 28 && text(0, 4) === 'RIFF' && text(8, 4) === 'WAVE') {
    for (let at = 12; at + 8 <= bytes.length;) {
      const size = view.getUint32(at + 4, true);
      if (text(at, 4) === 'fmt ' && size >= 16 && at + 24 <= bytes.length) {
        const rate = view.getUint32(at + 12, true);
        if (rate >= 8000 && rate <= 192000) return rate;
      }
      at += 8 + size + size % 2;
    }
  }
  return 48000;
}
