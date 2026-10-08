// Run: node utils/light.test.js
import { light, pageLight, parseBlocked } from './light.js';

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
console.log('light.js checks done');
