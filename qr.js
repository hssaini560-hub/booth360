// Minimal offline QR code generator (byte mode, error correction M, versions 1-10).
// Usage: QR.draw(canvas, "http://...", sizePx)
var QR = (function () {
  var ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  var NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  var ALIGN = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { var n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
    return r;
  }
  function dataCodewords(ver) { return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver]; }

  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z & 0xFF;
  }
  function rsDivisor(deg) {
    var r = []; for (var i = 0; i < deg; i++) r.push(0); r[deg - 1] = 1;
    var root = 1;
    for (i = 0; i < deg; i++) {
      for (var j = 0; j < deg; j++) { r[j] = gfMul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; }
      root = gfMul(root, 2);
    }
    return r;
  }
  function rsRemainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift(); r.push(0);
      for (var i = 0; i < div.length; i++) r[i] ^= gfMul(div[i], f);
    });
    return r;
  }

  function utf8(s) {
    var out = [], e = unescape(encodeURIComponent(s));
    for (var i = 0; i < e.length; i++) out.push(e.charCodeAt(i));
    return out;
  }

  function encode(text) {
    var bytes = utf8(text), ver;
    for (ver = 1; ver <= 10; ver++) {
      var ccBits = ver < 10 ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
    }
    if (ver > 10) throw new Error("Texte trop long pour le QR");
    var cap = dataCodewords(ver) * 8, bits = [];
    function put(v, n) { for (var i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); }
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) { var b = 0; for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; data.push(b); }

    // error correction + interleave
    var nb = NUM_BLOCKS[ver], ecl = ECC_PER_BLOCK[ver], raw = Math.floor(rawModules(ver) / 8);
    var nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = rsDivisor(ecl), blocks = [];
    for (i = 0, k = 0; i < nb; i++) {
      var dat = data.slice(k, k + shortLen - ecl + (i < nShort ? 0 : 1)); k += dat.length;
      var ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var cw = [];
    for (i = 0; i < blocks[0].length; i++)
      for (var j = 0; j < nb; j++)
        if (i != shortLen - ecl || j >= nShort) cw.push(blocks[j][i]);

    // matrix
    var size = ver * 4 + 17, mod = [], fn = [];
    for (i = 0; i < size; i++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function setF(x, y, d) { mod[y][x] = d; fn[y][x] = true; }
    for (i = 0; i < size; i++) { setF(6, i, i % 2 == 0); setF(i, 6, i % 2 == 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (p) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var x = p[0] + dx, y = p[1] + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d != 2 && d != 4);
      }
    });
    var al = ALIGN[ver], na = al.length;
    for (i = 0; i < na; i++) for (j = 0; j < na; j++) {
      if ((i == 0 && j == 0) || (i == 0 && j == na - 1) || (i == na - 1 && j == 0)) continue;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++)
        setF(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) != 1);
    }
    function drawFormat(mask) {
      var d = (0 << 3) | mask, r = d; // ECC level M = 00
      for (var i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      var bitsF = ((d << 10) | r) ^ 0x5412;
      function g(i) { return ((bitsF >>> i) & 1) != 0; }
      for (i = 0; i <= 5; i++) setF(8, i, g(i));
      setF(8, 7, g(6)); setF(8, 8, g(7)); setF(7, 8, g(8));
      for (i = 9; i < 15; i++) setF(14 - i, 8, g(i));
      for (i = 0; i < 8; i++) setF(size - 1 - i, 8, g(i));
      for (i = 8; i < 15; i++) setF(8, size - 15 + i, g(i));
      setF(8, size - 8, true);
    }
    drawFormat(0);
    if (ver >= 7) {
      var r = ver;
      for (i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      var vb = (ver << 12) | r;
      for (i = 0; i < 18; i++) {
        var bit = ((vb >>> i) & 1) != 0, a = size - 11 + i % 3, c = Math.floor(i / 3);
        setF(a, c, bit); setF(c, a, bit);
      }
    }
    // data placement
    var bi = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right == 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (j = 0; j < 2; j++) {
        var x = right - j, up = ((right + 1) & 2) == 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && bi < cw.length * 8) { mod[y][x] = ((cw[bi >>> 3] >>> (7 - (bi & 7))) & 1) != 0; bi++; }
      }
    }
    function maskFn(m, x, y) {
      switch (m) {
        case 0: return (x + y) % 2 == 0; case 1: return y % 2 == 0; case 2: return x % 3 == 0;
        case 3: return (x + y) % 3 == 0; case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 == 0;
        case 5: return x * y % 2 + x * y % 3 == 0; case 6: return (x * y % 2 + x * y % 3) % 2 == 0;
        default: return ((x + y) % 2 + x * y % 3) % 2 == 0;
      }
    }
    function applyMask(m) {
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (!fn[y][x] && maskFn(m, x, y)) mod[y][x] = !mod[y][x];
    }
    function penalty() {
      var p = 0, dark = 0, x, y;
      for (y = 0; y < size; y++) {
        var run = 1, runY = 1;
        for (x = 0; x < size; x++) {
          if (mod[y][x]) dark++;
          if (x > 0) {
            if (mod[y][x] == mod[y][x - 1]) { run++; if (run == 5) p += 3; else if (run > 5) p++; } else run = 1;
            if (mod[x][y] == mod[x - 1][y]) { runY++; if (runY == 5) p += 3; else if (runY > 5) p++; } else runY = 1;
          }
          if (x < size - 1 && y < size - 1) {
            var c = mod[y][x];
            if (c == mod[y][x + 1] && c == mod[y + 1][x] && c == mod[y + 1][x + 1]) p += 3;
          }
        }
      }
      p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
      return p;
    }
    var best = 0, bestP = Infinity;
    for (var m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      var pen = penalty();
      if (pen < bestP) { bestP = pen; best = m; }
      applyMask(m);
    }
    applyMask(best); drawFormat(best);
    return mod;
  }

  function draw(canvas, text, px) {
    var m = encode(text), n = m.length, q = 4, scale = Math.max(1, Math.floor(px / (n + 2 * q)));
    var dim = scale * (n + 2 * q);
    canvas.width = dim; canvas.height = dim;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = "#000";
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++)
      if (m[y][x]) ctx.fillRect((x + q) * scale, (y + q) * scale, scale, scale);
  }
  return { encode: encode, draw: draw };
})();
