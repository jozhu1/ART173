const sketch = (p) => {
  const storageKey = 'rabbit-mask-placement';
  let restingPoses = [];
  let crouchingPoses = [];
  let leapingPoses = [];
  let earPoses = [];
  let poseFacing = [];
  const regions = ['ear', 'head', 'front', 'lower', 'body', 'tail'];
  const landingStep = 8;
  const morphPixels = 144;
  const morphExtent = 2.1;
  const eyePoint = { x: 460, y: 145 };
  const eyeRadius = { x: 25, y: 14 };
  const pupilRadius = { x: 9, y: 10 };
  const redInk = [225, 24, 42];
  const redGlow = [255, 88, 108];
  const trailFrames = 34;
  const inkColors = [[0, 240, 255], [255, 0, 235], [255, 225, 0]];
  const overlayOpacity = 0.88;
  const micQuiet = 0.006;
  const micLoud = 0.05;
  const quietRabbits = 4;

  let maskImg;
  let spriteSheet;
  let loadError = '';
  let ready = false;
  let renderErrorShown = false;
  let poses = [];
  let colorPoses = [];
  let redPoses = [];
  let splatters = [];
  let rabbits = [];
  let redRabbit = null;
  let nextRedSpawn = 0;
  let nextInkSpawn = 0;
  let audioContext = null;
  let dropBuffer = null;
  let hopBuffer = null;
  let samplesRequested = false;
  let lastHopSoundAt = -Infinity;
  let activeHopSounds = 0;
  let micAnalyser = null;
  let micSamples = null;
  let micStream = null;
  let micStarting = false;
  let soundLevel = 0;
  let landingAreas;
  let regionBag = [];
  let calibrationMode = false;
  let maskX = 0;
  let maskY = 0;
  let maskScale = 1;
  const maxRabbits = 94;

  p.setup = () => {
    p.pixelDensity(1);
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.noStroke();
    p.loadImage('arabbit.png', image => {
      maskImg = image;
      p.loadImage('rabbit-sprites.jpeg', sheet => {
        spriteSheet = sheet;
        finishLoading();
      }, () => {
        p.loadImage('_ (15).jpeg', sheet => {
          spriteSheet = sheet;
          finishLoading();
        }, () => {
          loadError = 'Could not load rabbit-sprites.jpeg or _ (15).jpeg';
        });
      });
    }, () => {
      loadError = 'Could not load arabbit.png';
    });
  };

  function finishLoading() {
    try {
      initializeSketch();
      ready = true;
    } catch (error) {
      console.error('Could not set up rabbit sketch:', error);
      loadError = `Setup error: ${error.message}`;
    }
  }

  function initializeSketch() {
    maskImg.loadPixels();
    spriteSheet.loadPixels();
    buildLandingAreas();

    const spriteRects = findSpriteRects();
    poses = spriteRects.map(([sx, sy, sw, sh], poseIndex) => {
      const pose = p.createImage(sw, sh);
      pose.loadPixels();

      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const source = 4 * ((sy + y) * spriteSheet.width + sx + x);
          const target = 4 * (y * sw + x);
          const green = spriteSheet.pixels[source + 1];
          const alpha = p.constrain((green - 28) * 4, 0, 255);
          pose.pixels[target] = 0;
          pose.pixels[target + 1] = 0;
          pose.pixels[target + 2] = 0;
          pose.pixels[target + 3] = alpha;
        }
      }

      roughenPose(pose, poseIndex);
      return pose;
    });

    redPoses = poses.map(pose => colorizePose(pose, () => redInk));
    colorPoses = inkColors.map((color) =>
      poses.map(pose => colorizePose(pose, () => color))
    );

    const indices = poses.map((_, index) => index);
    const aspect = index => poses[index].width / poses[index].height;
    leapingPoses = indices.filter(index => aspect(index) > 1.17);
    restingPoses = indices.filter(index => aspect(index) <= 1.17);
    crouchingPoses = restingPoses.filter(index => aspect(index) > 1.10);
    earPoses = restingPoses.filter(index => aspect(index) < 0.9);
    poseFacing = spriteRects.map(([sx, sy, sw, sh]) => {
      let topX = 0;
      let count = 0;
      for (let y = sy; y < sy + sh * 0.23; y++) {
        for (let x = sx; x < sx + sw; x++) {
          if (isSpritePixel(x, y)) {
            topX += x - sx;
            count++;
          }
        }
      }
      return count && topX / count < sw / 2 ? -1 : 1;
    });

    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved) {
        maskX = Number(saved.x) || 0;
        maskY = Number(saved.y) || 0;
        maskScale = Number(saved.scale) || 1;
      }
    } catch (error) {
      maskX = 0;
      maskY = 0;
      maskScale = 1;
    }

    for (const age of [95, 40, 0, -18]) spawnSplatter(age);
    nextRedSpawn = p.frameCount + Math.floor(p.random(120, 260));
  }

  function isSpritePixel(x, y) {
    return spriteSheet.pixels[4 * (y * spriteSheet.width + x) + 1] > 105;
  }

  function findSpriteRects() {
    const rects = [];
    const rowHeight = Math.ceil(spriteSheet.height / 4);

    for (let top = 0; top < spriteSheet.height; top += rowHeight) {
      const bottom = Math.min(top + rowHeight, spriteSheet.height);
      let start = -1;

      for (let x = 0; x <= spriteSheet.width; x++) {
        let count = 0;
        if (x < spriteSheet.width) {
          for (let y = top; y < bottom; y++) {
            if (isSpritePixel(x, y)) count++;
          }
        }

        if (count > 2 && start < 0) start = x;
        if (count <= 2 && start >= 0) {
          if (x - start > 3) {
            let firstY = bottom;
            let lastY = top;
            for (let y = top; y < bottom; y++) {
              for (let px = start; px < x; px++) {
                if (isSpritePixel(px, y)) {
                  firstY = Math.min(firstY, y);
                  lastY = Math.max(lastY, y);
                }
              }
            }
            const left = Math.max(0, start - 3);
            const right = Math.min(spriteSheet.width, x + 3);
            const upper = Math.max(top, firstY - 3);
            const lower = Math.min(bottom, lastY + 4);
            rects.push([left, upper, right - left, lower - upper]);
          }
          start = -1;
        }
      }
    }

    return rects;
  }

  function roughenPose(pose, poseIndex) {
    const original = new Uint8ClampedArray(pose.pixels);
    const sample = (x, y) => {
      if (x < 0 || y < 0 || x >= pose.width || y >= pose.height) return 0;
      return original[4 * (y * pose.width + x) + 3];
    };

    for (let y = 0; y < pose.height; y++) {
      for (let x = 0; x < pose.width; x++) {
        const dx = Math.round((p.noise(x * 0.18, y * 0.18, poseIndex * 7) - 0.5) * 5);
        const dy = Math.round((p.noise(x * 0.18 + 80, y * 0.18, poseIndex * 7) - 0.5) * 5);
        const sx = x + dx;
        const sy = y + dy;
        let alpha = (
          4 * sample(sx, sy) + sample(sx - 1, sy) + sample(sx + 1, sy) +
          sample(sx, sy - 1) + sample(sx, sy + 1)
        ) / 8;

        if (alpha > 245 && p.noise(x * 0.43 + poseIndex * 11, y * 0.43) > 0.61 && p.random() < 0.08) {
          alpha *= p.random(0.62, 0.78);
        }
        if (alpha > 245 && p.random() < 0.008) alpha *= p.random(0.45, 0.7);
        pose.pixels[4 * (y * pose.width + x) + 3] = alpha;
      }
    }
    pose.updatePixels();
  }

  function colorizePose(pose, colorAt) {
    const colored = p.createImage(pose.width, pose.height);
    colored.loadPixels();
    for (let y = 0; y < pose.height; y++) {
      for (let x = 0; x < pose.width; x++) {
        const pixel = 4 * (y * pose.width + x);
        const color = colorAt(x / Math.max(1, pose.width - 1),
                              y / Math.max(1, pose.height - 1));
        for (let channel = 0; channel < 3; channel++) {
          colored.pixels[pixel + channel] = color[channel];
        }
        colored.pixels[pixel + 3] = pose.pixels[pixel + 3];
      }
    }
    colored.updatePixels();
    return colored;
  }

  function maskRect() {
    const fit = Math.min(p.width / maskImg.width, p.height / maskImg.height);
    const w = maskImg.width * fit * maskScale;
    const h = maskImg.height * fit * maskScale;
    return { x: (p.width - w) / 2 + maskX, y: (p.height - h) / 2 + maskY, w, h };
  }

  function maskAlphaAt(x, y) {
    const ix = Math.round(x), iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= maskImg.width || iy >= maskImg.height) return 0;
    return maskImg.pixels[4 * (iy * maskImg.width + ix) + 3];
  }

  function restPoseAt(x, y) {
    return p.random(x > 245 && x < 400 && y < 110 ? earPoses : restingPoses);
  }

  function buildLandingAreas() {
    landingAreas = Object.fromEntries(regions.map(name => [name, []]));
    for (let y = landingStep / 2; y < maskImg.height; y += landingStep) {
      for (let x = landingStep / 2; x < maskImg.width; x += landingStep) {
        if (maskAlphaAt(x, y) < 180) continue;
        const point = { x, y };
        if (x > 245 && x < 385 && y < 104) landingAreas.ear.push(point);
        if (x > 392 && y < 220) landingAreas.head.push(point);
        if (x > 390 && y >= 210) landingAreas.front.push(point);
        if (y > 285 && x > 170 && x < 425) landingAreas.lower.push(point);
        if (x > 225 && x < 390 && y > 168 && y < 300) landingAreas.body.push(point);
        if (x < 225 && y > 135 && y < 315) landingAreas.tail.push(point);
      }
    }
  }

  function nextSpawnRegion() {
    if (!regionBag.length) {
      regionBag = regions.map((_, index) => index);
      for (let i = regionBag.length - 1; i > 0; i--) {
        const j = Math.floor(p.random(i + 1));
        [regionBag[i], regionBag[j]] = [regionBag[j], regionBag[i]];
      }
    }
    return regionBag.pop();
  }

  function spawnSplatter(age = 0) {
    const target = Math.round(p.lerp(quietRabbits, maxRabbits, soundLevel));
    if (rabbits.length + splatters.length >= target) return;
    const regionIndex = nextSpawnRegion();
    const point = p.random(landingAreas[regions[regionIndex]]);
    if (!point) return;
    const splatter = makeSplatter(
      point, p.random(18, 27), p.random([-1, 1]),
      restPoseAt(point.x, point.y), age
    );
    splatters.push(splatter);
    playDropSound(false, splatter.paletteIndex);
  }

  function makeSplatter(point, size, direction, restPose, age = 0, red = false) {
    const edge = Array.from({ length: 48 }, () =>
      p.random(0.57, 0.8) + (p.random() < 0.13 ? p.random(0.3, 0.92) : 0)
    );
    const flecks = Array.from({ length: 14 }, () => ({
      angle: p.random(p.TWO_PI),
      distance: p.random(0.8, 1.85),
      radius: p.random(0.022, 0.085)
    }));
    const splatter = {
      x: point.x,
      y: point.y,
      size,
      direction,
      restPose,
      age,
      edge,
      flecks,
      red,
      paletteIndex: Math.floor(p.random(inkColors.length))
    };
    buildMorph(splatter);
    return splatter;
  }

  function distanceTo(mask, value) {
    const n = morphPixels;
    const distance = new Float32Array(n * n);
    const diagonal = Math.SQRT2;

    for (let i = 0; i < distance.length; i++) {
      distance[i] = mask[i] === value ? 0 : 10000;
    }

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        if (x) distance[i] = Math.min(distance[i], distance[i - 1] + 1);
        if (y) distance[i] = Math.min(distance[i], distance[i - n] + 1);
        if (x && y) distance[i] = Math.min(distance[i], distance[i - n - 1] + diagonal);
        if (x < n - 1 && y) distance[i] = Math.min(distance[i], distance[i - n + 1] + diagonal);
      }
    }

    for (let y = n - 1; y >= 0; y--) {
      for (let x = n - 1; x >= 0; x--) {
        const i = y * n + x;
        if (x < n - 1) distance[i] = Math.min(distance[i], distance[i + 1] + 1);
        if (y < n - 1) distance[i] = Math.min(distance[i], distance[i + n] + 1);
        if (x < n - 1 && y < n - 1) distance[i] = Math.min(distance[i], distance[i + n + 1] + diagonal);
        if (x && y < n - 1) distance[i] = Math.min(distance[i], distance[i + n - 1] + diagonal);
      }
    }

    return distance;
  }

  function signedDistance(alpha) {
    const mask = Uint8Array.from(alpha, value => value >= 128 ? 1 : 0);
    const inside = distanceTo(mask, 1);
    const outside = distanceTo(mask, 0);
    for (let i = 0; i < inside.length; i++) inside[i] -= outside[i];
    return inside;
  }

  function buildMorph(splatter) {
    const n = morphPixels;
    const graphics = p.createGraphics(n, n);
    graphics.pixelDensity(1);
    graphics.noStroke();
    const units = n / (splatter.size * morphExtent * 2);
    const radius = splatter.size * 0.94;

    graphics.clear();
    graphics.push();
    graphics.translate(n / 2, n / 2);
    graphics.scale(units);
    if (splatter.red) graphics.fill(...redInk);
    else graphics.fill(0);
    graphics.beginShape();
    for (let i = 0; i < splatter.edge.length; i++) {
      const angle = p.TWO_PI * i / splatter.edge.length;
      const distance = radius * splatter.edge[i];
      graphics.vertex(Math.cos(angle) * distance, Math.sin(angle) * distance * 0.82);
    }
    graphics.endShape(p.CLOSE);
    for (const fleck of splatter.flecks) {
      const distance = radius * fleck.distance;
      graphics.circle(Math.cos(fleck.angle) * distance,
                      Math.sin(fleck.angle) * distance * 0.82,
                      radius * fleck.radius * 2);
    }
    graphics.pop();
    graphics.loadPixels();

    splatter.image = p.createImage(n, n);
    splatter.image.loadPixels();
    const inkAlpha = new Uint8Array(n * n);
    for (let i = 0; i < inkAlpha.length; i++) {
      inkAlpha[i] = graphics.pixels[i * 4 + 3];
      if (splatter.red) {
        splatter.image.pixels[i * 4] = redInk[0];
        splatter.image.pixels[i * 4 + 1] = redInk[1];
        splatter.image.pixels[i * 4 + 2] = redInk[2];
      } else {
        const color = inkColors[splatter.paletteIndex];
        for (let channel = 0; channel < 3; channel++) {
          splatter.image.pixels[i * 4 + channel] = color[channel];
        }
      }
      splatter.image.pixels[i * 4 + 3] = inkAlpha[i];
    }
    splatter.image.updatePixels();

    graphics.clear();
    graphics.push();
    graphics.translate(n / 2, n / 2);
    graphics.scale(units * splatter.direction * poseFacing[splatter.restPose], units);
    const pose = splatter.red ? redPoses[splatter.restPose] : poses[splatter.restPose];
    const height = splatter.size * 2.4;
    const width = height * pose.width / pose.height;
    graphics.image(pose, -width / 2, -height / 2, width, height);
    graphics.pop();
    graphics.loadPixels();

    splatter.rabbitAlpha = new Uint8Array(n * n);
    for (let i = 0; i < splatter.rabbitAlpha.length; i++) {
      splatter.rabbitAlpha[i] = graphics.pixels[i * 4 + 3];
    }
    splatter.inkDistance = signedDistance(inkAlpha);
    splatter.rabbitDistance = signedDistance(splatter.rabbitAlpha);
    graphics.remove();
  }

  function updateMorph(splatter, amount) {
    const pixels = splatter.image.pixels;
    for (let i = 0; i < splatter.inkDistance.length; i++) {
      const distance = p.lerp(splatter.inkDistance[i], splatter.rabbitDistance[i], amount);
      const targetAlpha = splatter.rabbitAlpha[i];
      let alpha = p.constrain(Math.round((0.5 - distance) * 255), 0, 255);
      if (amount > 0.55 && targetAlpha > 150 && targetAlpha < 255) {
        const grain = (amount - 0.55) / 0.45;
        alpha = Math.min(alpha, 255 - (255 - targetAlpha) * grain);
      }
      pixels[i * 4 + 3] = amount >= 0.995 ? targetAlpha : alpha;
    }
    splatter.image.updatePixels();
  }

  function drawSplatter(splatter, rect, expansion) {
    const scale = rect.w / maskImg.width;
    const side = splatter.size * morphExtent * 2 * scale;
    p.push();
    p.translate(rect.x + splatter.x * scale, rect.y + splatter.y * scale);
    p.scale(expansion);
    const ctx = p.drawingContext;
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = overlayOpacity;
    ctx.filter = `blur(${Math.max(0.4, 0.7 * scale)}px)`;
    ctx.shadowColor = splatter.red ? 'rgba(255, 88, 108, 0.95)' :
      `rgba(${inkColors[splatter.paletteIndex].join(',')}, 0.95)`;
    ctx.shadowBlur = Math.max(18, 28 * scale);
    p.image(splatter.image, -side / 2, -side / 2, side, side);
    p.pop();
  }

  function drawSoftPose({ pose, poseIndex, x, y, size, direction, rect, glow,
                          opacity = 1, trailing = false, rotation = 0 }) {
    const scale = rect.w / maskImg.width;
    const h = size * 2.4 * scale;
    const w = h * pose.width / pose.height;
    p.push();
    p.translate(rect.x + x * scale, rect.y + y * scale);
    p.rotate(rotation);
    p.scale(direction * poseFacing[poseIndex], 1);
    const ctx = p.drawingContext;
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = opacity * overlayOpacity;
    ctx.filter = trailing ? `blur(${Math.max(1.5, 2.5 * scale)}px)` : 'none';
    ctx.shadowColor = `rgba(${glow.join(',')}, 0.95)`;
    ctx.shadowBlur = Math.max(18, (trailing ? 22 : 30) * scale);
    p.image(pose, -w / 2, -h / 2, w, h);
    p.pop();
  }

  function drawRabbit(rabbit, rect, sample, opacity = 1, trailing = false) {
    const { x, y, poseIndex, jump = 0, sway = 0, tilt = 0 } = sample;
    drawSoftPose({
      pose: colorPoses[rabbit.paletteIndex][poseIndex], poseIndex, x, y,
      size: rabbit.size, direction: rabbit.direction, rect,
      glow: inkColors[rabbit.paletteIndex],
      opacity, trailing,
      rotation: p.constrain(tilt, -0.65, 0.65) * jump + sway
    });
  }

  function spawnRedRabbit() {
    const starts = [
      ...landingAreas.body,
      ...landingAreas.lower,
      ...landingAreas.tail
    ].filter(point => point.x < 420 && point.y > 135);
    const start = p.random(starts);
    if (!start) return;

    const sidePoses = restingPoses.filter(index =>
      poses[index].width / poses[index].height > 0.93
    );
    const size = p.random(20, 25);
    const poseIndex = p.random(sidePoses);
    redRabbit = {
      x: start.x,
      y: start.y,
      displayY: start.y,
      startX: start.x,
      startY: start.y,
      size,
      poseIndex,
      hopPoses: Array.from({ length: 4 }, () => p.random(leapingPoses)),
      direction: 1,
      stage: 'splatter',
      stageFrame: 0,
      approachFrames: Math.floor(p.random(210, 280)),
      leaveFrames: Math.floor(p.random(240, 310)),
      exitY: p.random(210, 280),
      seed: p.random(10000),
      morphAmount: -1,
      lookX: 0,
      lookY: 0,
      lookTargetX: 0,
      lookTargetY: 0,
      nextLook: 1,
      trail: [],
      splatter: makeSplatter(start, size, 1, poseIndex, 0, true)
    };
    playDropSound(true);
    buildRedMorph(redRabbit);
  }

  function buildRedMorph(rabbit) {
    const n = morphPixels;
    const graphics = p.createGraphics(n, n);
    graphics.pixelDensity(1);
    graphics.noStroke();
    const units = n / (rabbit.size * morphExtent * 2);
    const pose = redPoses[rabbit.poseIndex];
    const height = rabbit.size * 2.4;
    const width = height * pose.width / pose.height;

    graphics.clear();
    graphics.push();
    graphics.translate(n / 2, n / 2);
    graphics.scale(units * poseFacing[rabbit.poseIndex], units);
    graphics.image(pose, -width / 2, -height / 2, width, height);
    graphics.pop();
    graphics.loadPixels();
    const rabbitAlpha = new Uint8Array(n * n);
    for (let i = 0; i < rabbitAlpha.length; i++) {
      rabbitAlpha[i] = graphics.pixels[i * 4 + 3];
    }

    graphics.clear();
    graphics.push();
    graphics.translate(n / 2, n / 2);
    graphics.scale(units);
    graphics.fill(redInk[0], redInk[1], redInk[2]);
    graphics.beginShape();
    for (let i = 0; i < 48; i++) {
      const angle = p.TWO_PI * i / 48;
      const unevenness = 0.83 + 0.27 * p.noise(
        rabbit.seed * 0.01 + Math.cos(angle) * 3.4,
        50 + Math.sin(angle) * 3.4
      );
      graphics.vertex(
        Math.cos(angle) * eyeRadius.x * unevenness,
        Math.sin(angle) * eyeRadius.y * unevenness
      );
    }
    graphics.endShape(p.CLOSE);
    for (let i = 0; i < 12; i++) {
      const angle = p.random(p.TWO_PI);
      const radius = p.random(13, 21);
      graphics.circle(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius * eyeRadius.y / eyeRadius.x,
        p.random(0.7, 2.2)
      );
    }
    graphics.pop();
    graphics.loadPixels();
    const eyeAlpha = new Uint8Array(n * n);
    for (let i = 0; i < eyeAlpha.length; i++) {
      const x = i % n;
      const y = Math.floor(i / n);
      const grain = p.noise(
        x * 0.2 + rabbit.seed * 0.01,
        y * 0.2 + 200
      );
      const blotch = grain > 0.57 ? p.map(grain, 0.57, 0.82, 1, 0.38, true) : 1;
      eyeAlpha[i] = graphics.pixels[i * 4 + 3] * blotch;
    }

    rabbit.rabbitAlpha = rabbitAlpha;
    rabbit.eyeAlpha = eyeAlpha;
    rabbit.rabbitDistance = signedDistance(rabbitAlpha);
    rabbit.eyeDistance = signedDistance(eyeAlpha);
    rabbit.morphImage = p.createImage(n, n);
    rabbit.morphImage.loadPixels();
    for (let i = 0; i < n * n; i++) {
      const pixel = i * 4;
      rabbit.morphImage.pixels[pixel] = redInk[0];
      rabbit.morphImage.pixels[pixel + 1] = redInk[1];
      rabbit.morphImage.pixels[pixel + 2] = redInk[2];
      rabbit.morphImage.pixels[pixel + 3] = rabbitAlpha[i];
    }
    rabbit.morphImage.updatePixels();
    graphics.remove();
  }

  function updateRedMorph(rabbit, amount) {
    if (rabbit.morphAmount === amount) return;
    rabbit.morphAmount = amount;
    const pixels = rabbit.morphImage.pixels;
    for (let i = 0; i < rabbit.rabbitDistance.length; i++) {
      const distance = p.lerp(rabbit.rabbitDistance[i], rabbit.eyeDistance[i], amount);
      let alpha = p.constrain(Math.round((0.5 - distance) * 255), 0, 255);
      if (amount < 0.45 && rabbit.rabbitAlpha[i] > 150 && rabbit.rabbitAlpha[i] < 255) {
        alpha = Math.min(alpha, 255 - (255 - rabbit.rabbitAlpha[i]) * (1 - amount / 0.45));
      }
      if (amount <= 0.005) alpha = rabbit.rabbitAlpha[i];
      else if (amount >= 0.995) alpha = rabbit.eyeAlpha[i];
      else if (amount > 0.55) {
        const grain = (amount - 0.55) / 0.45;
        alpha = Math.min(alpha, 255 - (255 - rabbit.eyeAlpha[i]) * grain);
      }

      pixels[i * 4 + 3] = alpha;
    }
    rabbit.morphImage.updatePixels();
  }

  function drawRedPose(rabbit, rect, sample, opacity = 1, trailing = false) {
    drawSoftPose({
      pose: redPoses[sample.poseIndex],
      poseIndex: sample.poseIndex,
      x: sample.x, y: sample.y - sample.lift,
      size: rabbit.size, direction: sample.direction, rect,
      glow: redGlow, opacity, trailing
    });
  }

  function drawRedMorph(rabbit, rect, amount, direction = 1) {
    updateRedMorph(rabbit, amount);
    const scale = rect.w / maskImg.width;
    const side = rabbit.size * morphExtent * 2 * scale;
    p.push();
    p.translate(rect.x + eyePoint.x * scale, rect.y + eyePoint.y * scale);
    p.scale(direction, 1);
    const ctx = p.drawingContext;
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = overlayOpacity;
    ctx.shadowColor = `rgba(${redGlow.join(',')}, 0.95)`;
    ctx.shadowBlur = Math.max(18, 30 * scale);
    p.image(rabbit.morphImage, -side / 2, -side / 2, side, side);
    ctx.shadowBlur = 0;
    if (amount > 0.88) {
      const pupil = p.constrain((amount - 0.88) / 0.12, 0, 1);
      p.noStroke();
      p.fill(18, 0, 8);
      p.beginShape();
      for (let i = 0; i < 24; i++) {
        const angle = p.TWO_PI * i / 24;
        const rough = 0.78 + 0.35 * p.noise(rabbit.seed + Math.cos(angle) * 4,
                                             Math.sin(angle) * 4);
        p.vertex((rabbit.lookX + Math.cos(angle) * pupilRadius.x * rough * pupil) * scale,
                 (rabbit.lookY + Math.sin(angle) * pupilRadius.y * rough * pupil) * scale);
      }
      p.endShape(p.CLOSE);
    }
    p.pop();
  }

  function drawTrail(rabbit, strength, drawSample) {
    rabbit.trail = rabbit.trail.filter(sample => p.frameCount - sample.frame < trailFrames);
    for (const sample of rabbit.trail) {
      const age = p.frameCount - sample.frame;
      if (age < 4) continue;
      const fade = 1 - age / trailFrames;
      drawSample(sample, strength * fade * fade);
    }
  }

  function rememberTrail(rabbit, sample) {
    if (!rabbit.trail.length ||
        p.frameCount - rabbit.trail[rabbit.trail.length - 1].frame >= 4) {
      rabbit.trail.push({ ...sample, frame: p.frameCount });
    }
  }

  function drawRedTrail(rabbit, rect) {
    drawTrail(rabbit, 0.23, (sample, opacity) =>
      drawRedPose(rabbit, rect, sample, opacity, true));
  }

  function drawRedRabbit(rect) {
    const rabbit = redRabbit;
    rabbit.stageFrame++;

    if (rabbit.stage === 'splatter') {
      const splatter = rabbit.splatter;
      splatter.age++;
      const spread = p.constrain(splatter.age / 18, 0, 1);
      const morph = p.constrain((splatter.age - 48) / 130, 0, 1);
      const smoothMorph = morph * morph * (3 - 2 * morph);
      const expansion = 0.15 + 0.85 * (1 - Math.pow(1 - spread, 3));
      if (morph > 0) updateMorph(splatter, smoothMorph);
      drawSplatter(splatter, rect, expansion);
      if (morph >= 1) {
        rabbit.splatter = null;
        rabbit.stage = 'approach';
        rabbit.stageFrame = 0;
      }
      return;
    }

    if (rabbit.stage === 'approach' || rabbit.stage === 'leave') {
      const leaving = rabbit.stage === 'leave';
      const duration = leaving ? rabbit.leaveFrames : rabbit.approachFrames;
      const t = Math.min(1, rabbit.stageFrame / duration);
      const hops = leaving ? 4 : 3;
      const phase = t * hops;
      const hopIndex = Math.min(hops - 1, Math.floor(phase));
      const hopKey = `${rabbit.stage}-${hopIndex}`;
      if (rabbit.lastHopSoundKey !== hopKey) {
        rabbit.lastHopSoundKey = hopKey;
        playHopSound();
      }
      const lift = Math.sin(Math.PI * (phase % 1)) * rabbit.size * 1.05;
      rabbit.direction = leaving ? -1 : 1;
      rabbit.x = leaving ? p.lerp(eyePoint.x, -90, t) :
                           p.lerp(rabbit.startX, eyePoint.x, t);
      const baseY = leaving ? p.lerp(eyePoint.y, rabbit.exitY, t) :
                              p.lerp(rabbit.startY, eyePoint.y, t);
      rabbit.y = baseY + (p.noise(rabbit.seed, t * 2) - 0.5) *
                          12 * Math.sin(Math.PI * t);
      const poseIndex = lift > rabbit.size * 0.22 ?
        rabbit.hopPoses[Math.min(hops - 1, Math.floor(phase))] : rabbit.poseIndex;
      drawRedTrail(rabbit, rect);
      const sample = { x: rabbit.x, y: rabbit.y, lift,
                       direction: rabbit.direction, poseIndex };
      rabbit.displayY = rabbit.y - lift;
      rememberTrail(rabbit, sample);
      drawRedPose(rabbit, rect, sample);

      if (t >= 1) {
        if (leaving) {
          redRabbit = null;
          nextRedSpawn = p.frameCount + Math.floor(p.random(450, 800));
        } else {
          rabbit.stage = 'toEye';
          rabbit.stageFrame = 0;
        }
      }
      return;
    }

    if (rabbit.stage === 'toEye' || rabbit.stage === 'fromEye') {
      const t = Math.min(1, rabbit.stageFrame / 60);
      const eased = t * t * (3 - 2 * t);
      const returning = rabbit.stage === 'fromEye';
      drawRedTrail(rabbit, rect);
      drawRedMorph(rabbit, rect, returning ? 1 - eased : eased, returning ? -1 : 1);
      if (t >= 1) {
        rabbit.stage = returning ? 'leave' : 'eye';
        rabbit.stageFrame = 0;
      }
      return;
    }

    if (rabbit.stageFrame >= rabbit.nextLook) {
      rabbit.lookTargetX = p.random(-5, 5);
      rabbit.lookTargetY = p.random(-2.5, 2.5);
      rabbit.nextLook = rabbit.stageFrame + Math.floor(p.random(18, 38));
    }
    rabbit.lookX = p.lerp(rabbit.lookX, rabbit.lookTargetX, 0.12);
    rabbit.lookY = p.lerp(rabbit.lookY, rabbit.lookTargetY, 0.12);
    drawRedMorph(rabbit, rect, 1);
    if (rabbit.stageFrame >= 112) {
      rabbit.stage = 'fromEye';
      rabbit.stageFrame = 0;
    }
  }

  function startHop(rabbit) {
    rabbit.hopProgress = 0;
    rabbit.crouchPose = p.random(crouchingPoses);
    rabbit.takeoffPose = p.random(leapingPoses);
    rabbit.airPose = p.random(leapingPoses);
    rabbit.landingPose = p.random(crouchingPoses);
    rabbit.velocity.x = rabbit.direction * rabbit.currentSpeed;
    rabbit.velocity.y += p.random(-0.12, 0.12);
    playHopSound();
  }

  function drawRabbitTrail(rabbit, rect) {
    drawTrail(rabbit, 0.28, (sample, opacity) =>
      drawRabbit(rabbit, rect, sample, opacity, true));
  }

  function drawMovingRabbit(rabbit, rect) {
    if (rabbit.restFrames > 0) {
      rabbit.restFrames--;
      rabbit.displayY = rabbit.y;
      drawRabbitTrail(rabbit, rect);
      drawRabbit(rabbit, rect, { x: rabbit.x, y: rabbit.y, poseIndex: rabbit.restPose });
      if (rabbit.restFrames === 0) startHop(rabbit);
      return;
    }

    rabbit.hopProgress = Math.min(1, rabbit.hopProgress + rabbit.hopRate);
    const t = rabbit.hopProgress;
    const jump = Math.sin(Math.PI * t);

    if (t > 0.12 && t < 0.9) {
      const flow = p.noise(
        rabbit.seed + rabbit.x * 0.006,
        rabbit.seed + 100 + rabbit.y * 0.006,
        p.frameCount * 0.003
      );
      const speedNoise = p.noise(rabbit.seed + 500, p.frameCount * 0.006,
                                 rabbit.y * 0.004);
      const targetSpeed = rabbit.baseSpeed * p.map(speedNoise, 0, 1, 0.55, 1.55);
      rabbit.currentSpeed = p.lerp(rabbit.currentSpeed, targetSpeed, 0.045);
      rabbit.acceleration.y += ((flow - 0.5) * 0.11 + rabbit.turnBias) / rabbit.mass;
      rabbit.velocity.y = p.constrain((rabbit.velocity.y + rabbit.acceleration.y) * 0.94,
                                       -0.85, 0.85);
      rabbit.velocity.x = rabbit.direction * rabbit.currentSpeed;
      rabbit.acceleration.mult(0);

      const stride = 0.65 + 0.55 * jump;
      rabbit.x += rabbit.velocity.x * stride;
      rabbit.y += rabbit.velocity.y * stride;
    }

    const poseIndex = t < 0.15 ? rabbit.crouchPose :
      t < 0.47 ? rabbit.takeoffPose :
      t < 0.82 ? rabbit.airPose :
      t < 0.94 ? rabbit.landingPose : rabbit.restPose;
    const sway = (p.noise(rabbit.seed + 700, p.frameCount * 0.012) - 0.5) *
                 0.18 * jump;
    const y = rabbit.y - jump * rabbit.size * 1.05;
    rabbit.displayY = y;
    const tilt = Math.atan2(rabbit.velocity.y, Math.abs(rabbit.velocity.x));
    drawRabbitTrail(rabbit, rect);
    const sample = { x: rabbit.x, y, poseIndex, jump, sway, tilt };
    rememberTrail(rabbit, sample);
    drawRabbit(rabbit, rect, sample);

    if (t >= 1) {
      rabbit.restPose = restPoseAt(rabbit.x, rabbit.y);
      rabbit.restFrames = Math.floor(p.random(45, 95));
      rabbit.velocity.y *= 0.8;
    }
  }

  function outsideView(rabbit, rect) {
    const scale = rect.w / maskImg.width;
    const x = rect.x + rabbit.x * scale;
    const y = rect.y + rabbit.y * scale;
    const margin = rabbit.size * 2.5 * scale;
    return x < -margin || x > p.width + margin ||
           y < -margin || y > p.height + margin;
  }

  async function enableAudio() {
    try {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioContext.state !== 'running') await audioContext.resume();
      if (!samplesRequested) {
        samplesRequested = true;
        Promise.all([loadSample('drop.mp3'), loadSample('hop.mp3')])
          .then(([drop, hop]) => {
            dropBuffer = drop;
            hopBuffer = hop;
          });
      }
    } catch (error) {
      console.error('Could not start audio:', error);
    }
  }

  async function loadSample(filename) {
    try {
      const response = await fetch(filename);
      if (!response.ok) return null;
      return await audioContext.decodeAudioData(await response.arrayBuffer());
    } catch (error) {
      console.warn(`Could not load ${filename}:`, error);
      return null;
    }
  }

  function playSample(buffer, volume, rate = 1, hop = false) {
    if (!buffer || !audioContext || audioContext.state !== 'running') return false;
    try {
      const source = audioContext.createBufferSource();
      const gain = audioContext.createGain();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(audioContext.destination);
      if (hop) {
        activeHopSounds++;
        source.onended = () => { activeHopSounds--; };
      }
      source.start();
      return true;
    } catch (error) {
      if (hop) activeHopSounds = Math.max(0, activeHopSounds - 1);
      console.warn('Could not play sample:', error);
      return false;
    }
  }

  function playHopSound() {
    if (!audioContext || audioContext.state !== 'running') return;
    const now = p.millis();
    if (now - lastHopSoundAt < 120 || activeHopSounds >= 3) return;
    lastHopSoundAt = now;
    if (!playSample(hopBuffer, 0.16, p.random(0.92, 1.08), true)) {
      playTone(audioContext.currentTime, 330, 190, 0.08, 0.025);
    }
  }

  function playTone(start, fromHz, toHz, duration, volume, type = 'sine') {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(fromHz, start);
    oscillator.frequency.exponentialRampToValueAtTime(toHz, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.01);
  }

  function playDropSound(red = false, paletteIndex = 0) {
    if (!audioContext || audioContext.state !== 'running') return;
    const now = audioContext.currentTime;
    if (red) {
      playTone(now, 300, 85, 0.48, 0.12, 'triangle');
      playTone(now + 0.09, 170, 65, 0.4, 0.04);
    } else {
      if (playSample(dropBuffer, 0.3, [0.92, 1, 1.08, 1.16][paletteIndex])) return;
      const pitch = [620, 700, 770, 840][paletteIndex];
      playTone(now, pitch * 1.4, pitch * 0.78, 0.17, 0.08);
      playTone(now + 0.055, pitch * 0.9, pitch * 0.6, 0.13, 0.035);
    }
  }

  async function enableMicrophone() {
    if (micAnalyser || micStarting) return;
    micStarting = true;
    try {
      await enableAudio();
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const input = audioContext.createMediaStreamSource(micStream);
      micAnalyser = audioContext.createAnalyser();
      micAnalyser.fftSize = 1024;
      micSamples = new Float32Array(micAnalyser.fftSize);
      input.connect(micAnalyser);
      console.log('Microphone enabled');
    } catch (error) {
      console.error('Could not start microphone:', error);
      if (micStream) micStream.getTracks().forEach(track => track.stop());
      micStream = null;
    } finally {
      micStarting = false;
    }
  }

  function updateSound() {
    if (!micAnalyser) return;
    micAnalyser.getFloatTimeDomainData(micSamples);
    let energy = 0;
    for (const sample of micSamples) energy += sample * sample;
    const rms = Math.sqrt(energy / micSamples.length);
    const target = p.map(rms, micQuiet, micLoud, 0, 1, true);
    soundLevel = p.lerp(soundLevel, target, target > soundLevel ? 0.22 : 0.045);
  }

  p.draw = () => {
    if (!ready) {
      p.background(0);
      p.fill(255);
      p.textSize(18);
      p.text(loadError || 'Loading rabbit images...', 24, 40);
      return;
    }
    try {
    updateSound();
    const rect = maskRect();
    if (calibrationMode) {
      p.background(30, 255, 80);
    } else {
      p.background(255);

      if (p.frameCount >= nextInkSpawn) {
        spawnSplatter();
        nextInkSpawn = p.frameCount + Math.round(p.lerp(55, 6, soundLevel));
      }

      for (let i = splatters.length - 1; i >= 0; i--) {
        const splatter = splatters[i];
        splatter.age += 1 + soundLevel * 1.8;
        if (splatter.age < 0) continue;
        const spread = p.constrain(splatter.age / 18, 0, 1);
        const morph = p.constrain((splatter.age - 48) / 130, 0, 1);
        const smoothMorph = morph * morph * (3 - 2 * morph);

        if (morph >= 1) {
          const startingSpeed = p.random(0.9, 1.6);
          rabbits.push({
            x: splatter.x,
            y: splatter.y,
            displayY: splatter.y,
            size: splatter.size,
            direction: splatter.direction,
            velocity: p.createVector(splatter.direction * startingSpeed, p.random(-0.2, 0.2)),
            acceleration: p.createVector(0, 0),
            mass: p.random(0.8, 1.6),
            baseSpeed: startingSpeed,
            currentSpeed: startingSpeed,
            turnBias: p.random(-0.012, 0.012),
            outsideFrames: 0,
            seed: p.random(10000),
            hopProgress: 0,
            hopRate: p.random(0.01, 0.015),
            restFrames: Math.floor(p.random(12, 28)),
            restPose: splatter.restPose,
            paletteIndex: splatter.paletteIndex,
            trail: []
          });
          splatters.splice(i, 1);
          continue;
        }

        const expansion = 0.15 + 0.85 * (1 - Math.pow(1 - spread, 3));
        if (morph > 0) updateMorph(splatter, smoothMorph);
        drawSplatter(splatter, rect, expansion);
      }

      for (let i = rabbits.length - 1; i >= 0; i--) {
        const rabbit = rabbits[i];
        drawMovingRabbit(rabbit, rect);
        rabbit.outsideFrames = maskAlphaAt(rabbit.x, rabbit.y) < 10 ?
          rabbit.outsideFrames + 1 : 0;
        if (outsideView(rabbit, rect) || rabbit.outsideFrames > 120) {
          rabbits.splice(i, 1);
        }
      }

      if (!redRabbit && p.frameCount >= nextRedSpawn) spawnRedRabbit();
      if (redRabbit) drawRedRabbit(rect);
    }

    const ctx = p.drawingContext;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    p.image(maskImg, rect.x, rect.y, rect.w, rect.h);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, p.width, p.height);
    ctx.restore();
    } catch (error) {
      if (!renderErrorShown) console.error('Rabbit sketch stopped drawing:', error);
      renderErrorShown = true;
      p.background(0);
      p.fill(255);
      p.textSize(18);
      p.text(`Drawing error: ${error.message}`, 24, 40);
    }
  };

  function savePlacement() {
    localStorage.setItem(storageKey, JSON.stringify({ x: maskX, y: maskY, scale: maskScale }));
  }

  p.keyPressed = () => {
    enableAudio();
    const step = p.keyIsDown(p.SHIFT) ? 10 : 1;
    if (p.key === 'c' || p.key === 'C') calibrationMode = !calibrationMode;
    else if (p.key === 'f' || p.key === 'F') p.fullscreen(!p.fullscreen());
    else if (p.key === 'm' || p.key === 'M') enableMicrophone();
    else if (p.keyCode === p.LEFT_ARROW) maskX -= step;
    else if (p.keyCode === p.RIGHT_ARROW) maskX += step;
    else if (p.keyCode === p.UP_ARROW) maskY -= step;
    else if (p.keyCode === p.DOWN_ARROW) maskY += step;
    else if (p.key === '+' || p.key === '=') maskScale *= 1.01;
    else if (p.key === '-') maskScale /= 1.01;
    else return;
    savePlacement();
    return false;
  };

  p.mousePressed = () => {
    enableAudio();
  };

  p.touchStarted = () => {
    enableAudio();
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };
};

new p5(sketch);
