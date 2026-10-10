// The order to write a stream's pieces in when its sound pieces are interleaved between the video ones:
// [['v', 0], ['a', 0], ['v', 1], ...]. Sound keeps pace with the video; any left over come last.
export function order(videoCount, soundCount) {
  const ops = [];
  let a = 0;
  for (let i = 0; i < videoCount; i++) {
    ops.push(['v', i]);
    const due = Math.ceil(((i + 1) * soundCount) / videoCount);
    for (; a < due; a++) ops.push(['a', a]);
  }
  return ops;
}
