// Simple script to generate extension icons as PNG using canvas
// Run with: node generate-icons.js (or we can use a data-URI SVG approach)

const fs = require('fs');

// Create SVG icon
function createSvgIcon(size) {
  const s = size;
  const p = s * 0.1; // padding
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a3a5f"/>
      <stop offset="100%" style="stop-color:#0f1923"/>
    </linearGradient>
  </defs>
  <rect width="${s}" height="${s}" rx="${s*0.15}" fill="url(#bg)"/>
  <!-- Book shape -->
  <rect x="${s*0.2}" y="${s*0.15}" width="${s*0.6}" height="${s*0.7}" rx="${s*0.03}" fill="#2a5a8a" stroke="#4a9aca" stroke-width="${s*0.02}"/>
  <!-- Page lines -->
  <line x1="${s*0.3}" y1="${s*0.3}" x2="${s*0.7}" y2="${s*0.3}" stroke="#7ecbf5" stroke-width="${s*0.02}" stroke-linecap="round"/>
  <line x1="${s*0.3}" y1="${s*0.42}" x2="${s*0.7}" y2="${s*0.42}" stroke="#5a9aba" stroke-width="${s*0.015}" stroke-linecap="round"/>
  <line x1="${s*0.3}" y1="${s*0.52}" x2="${s*0.6}" y2="${s*0.52}" stroke="#5a9aba" stroke-width="${s*0.015}" stroke-linecap="round"/>
  <!-- Camera icon -->
  <circle cx="${s*0.7}" cy="${s*0.7}" r="${s*0.15}" fill="#1a6b4a" stroke="#2a8b6a" stroke-width="${s*0.02}"/>
  <circle cx="${s*0.7}" cy="${s*0.7}" r="${s*0.07}" fill="#7ecbf5"/>
</svg>`;
}

// Write SVG files that Chrome can use, then we'll note the user should convert
[16, 48, 128].forEach(size => {
  const svg = createSvgIcon(size);
  fs.writeFileSync(`icons/icon${size}.svg`, svg);
  console.log(`Created icons/icon${size}.svg`);
});

console.log('\nSVG icons created. Converting to PNG...');
