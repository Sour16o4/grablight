// Run: node utils/light.test.js
import { light, matchImage, matchVideo, pageLight, parseBlocked } from './light.js';

const eq = (a, b) => console.assert(a === b, `expected ${b}, got ${a}`);
eq(light({ url: 'https://a.com/x.pdf', kind: 'file', status: 200, contentType: 'application/pdf' }).color, 'green');
eq(light({ url: 'https://a.com/x.pdf', kind: 'file', status: 404 }).color, 'red');
eq(light({ url: 'https://a.com/x', kind: 'file', status: 200, contentType: 'text/html' }).color, 'red');
eq(light({ url: 'https://a.com/x.pdf', kind: 'file', status: 0 }).color, 'yellow');
const hls = { url: 'https://a.com/v.m3u8', kind: 'manifest', ext: 'm3u8', status: 200, hlsChecked: true };
eq(light(hls).color, 'green');
eq(light({ ...hls, hlsChecked: undefined }).color, 'yellow');
eq(light({ ...hls, drm: true }).color, 'red');
eq(light({ ...hls, live: true }).color, 'red');
eq(light({ ...hls, ext: 'mpd' }).color, 'red');
eq(light({ url: 'https://a.com/v.mp4', kind: 'video', status: 200 }, 'https://www.netflix.com/watch').color, 'red');
eq(light({ url: 'https://i.ytimg.com/a.jpg', kind: 'image', status: 200 }, 'https://www.youtube.com/watch').color, 'green');
// sites the user blocks in settings
eq(parseBlocked(' https://www.Example.com/path, other.org\nthird.net ').join(), 'example.com,other.org,third.net');
const mine = parseBlocked('example.com');
eq(light({ url: 'https://cdn.example.com/v.mp4', kind: 'video', status: 200 }, 'https://a.test', mine).color, 'red');
eq(light({ url: 'https://x.test/v.mp4', kind: 'video', status: 200 }, 'https://notexample.com/', mine).color, 'green');
eq(light({ url: 'https://example.com/a.pdf', kind: 'file', status: 200, contentType: 'application/pdf' }, '', mine).color, 'green'); // only media is blocked
eq(pageLight([{ light: { color: 'red' } }, { light: { color: 'yellow' } }]), 'yellow');
// hovered video -> file
const vid = (url, color, kind = 'video', size = 1) => ({ url, kind, size, light: { color, reason: '' } });
const a = vid('https://a.com/a.mp4', 'green'), b = vid('https://a.com/b.mp4', 'red');
eq(matchVideo([a, b], 'https://a.com/b.mp4').light.color, 'red'); // exact match keeps its own light
eq(matchVideo([a, b], 'https://a.com/a.mp4#t=5').url, a.url);
eq(matchVideo([a, b], 'blob:x').light.color, 'yellow'); // two files, can't tell: not green
eq(matchVideo([a], 'blob:x').light.color, 'green'); // one candidate: certain
eq(matchVideo([b], 'blob:x').light.color, 'red');
eq(matchVideo([], 'blob:x'), null);
const im = { url: 'https://a.com/i.png', kind: 'image', light: { color: 'green', reason: '' } };
eq(matchImage([a, im], 'https://a.com/i.png'), im);
eq(matchImage([a, im], 'data:image/png;base64,xx'), null);
console.log('light.js checks done');
