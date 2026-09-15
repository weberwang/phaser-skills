import assert from "node:assert/strict";
import { access, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { decodePngRgba, encodePngRgba } from "../../phaser4-game-asset-integration/scripts/effect_image_raster.mjs";
import { evaluateTransitions, FrameAnimationError, FRAME_ANIMATION_EXIT_CODES, naturalCompare, packCharacterFrames, runFrameAnimationCli } from "./frame-animation.mjs";

/** 创建透明 RGBA 测试画布，夹具只存在于系统临时目录。 */
function transparentImage(width, height) {
  return { width, height, pixels: Buffer.alloc(width * height * 4) };
}

/** 在夹具中绘制不透明矩形，模拟人物 Alpha 前景。 */
function fillRect(image, x, y, width, height, color = [230, 80, 70, 255]) {
  for (let yy = y; yy < y + height; yy += 1) for (let xx = x; xx < x + width; xx += 1) {
    const offset = (yy * image.width + xx) * 4;
    image.pixels[offset] = color[0];
    image.pixels[offset + 1] = color[1];
    image.pixels[offset + 2] = color[2];
    image.pixels[offset + 3] = color[3];
  }
}

/** 在临时目录写入一个合法 PNG 帧。 */
async function writeFrame(directory, name, image) {
  const file = join(directory, name);
  await writeFile(file, encodePngRgba(image.width, image.height, image.pixels));
  return file;
}

/** 构造同一人物在不同源画布位置中的帧，专门覆盖锚点归一化。 */
async function writeOffsetFrames(directory, names = ["frame10.png", "frame2.png", "frame1.png"]) {
  const images = [
    [8, 8, 2, 2],
    [12, 10, 5, 4],
    [9, 9, 1, 1],
  ];
  for (let index = 0; index < names.length; index += 1) {
    const [width, height, x, y] = images[index];
    const image = transparentImage(width, height);
    fillRect(image, x, y, 3, 4);
    await writeFrame(directory, names[index], image);
  }
}

/** 创建收集 CLI 标准输出和错误的最小替身。 */
function outputCollector() {
  const logs = [];
  const errors = [];
  return { logs, errors, log: (value) => logs.push(value), error: (value) => errors.push(value) };
}

test("不同源画布偏移会被底部中心锚点消除，并生成自然序水平 sheet 与 Phaser 合同", async () => {
  const root = await mkdtemp(join(tmpdir(), "character-frame-alignment-"));
  try {
    const input = join(root, "input");
    const output = join(root, "out", "hero-idle.png");
    const reportFile = join(root, "evidence", "hero-idle.json");
    await mkdir(input);
    await writeOffsetFrames(input);
    const result = await packCharacterFrames({ inputDir: input, outputSheet: output, outputReport: reportFile, animationKey: "hero-idle", textureKey: "hero-texture", frameRate: 12, padding: 1, loop: true });
    assert.equal(result.exitCode, FRAME_ANIMATION_EXIT_CODES.success);
    assert.equal(result.status, "PASS");
    assert.deepEqual(result.input.order, ["frame1.png", "frame2.png", "frame10.png"]);
    assert.deepEqual(result.cell.target_anchor, { x: 2, y: 4 });
    assert.deepEqual(result.cell, { width: 5, height: 6, padding: 1, target_anchor: { x: 2, y: 4 }, extents: { left: 1, right: 1, top: 3, bottom: 0 }, layout: "horizontal" });
    assert.equal(result.frames.every((frame) => frame.anchor_drift === 0), true);
    assert.equal(result.frames.every((frame) => frame.normalized_anchor.x === 2 && frame.normalized_anchor.y === 4), true);
    assert.equal(result.quality.summary.min_alpha_iou, 1);
    assert.equal(result.quality.thresholds.minFrameRate, 8);
    assert.equal(result.phaser.preload.frameConfig.frameWidth, 5);
    assert.equal(result.phaser.preload.frameConfig.frameHeight, 6);
    assert.equal(result.phaser.preload.frameConfig.endFrame, 2);
    assert.equal(result.phaser.anims.repeat, -1);
    assert.deepEqual(result.phaser.sprite_origin.target_anchor, result.cell.target_anchor);
    assert.equal(result.phaser.sprite_origin.x, 2 / 5);
    assert.equal(result.phaser.sprite_origin.y, 4 / 6);
    assert.equal(result.phaser.snippets.setOrigin, "sprite.setOrigin(0.4, 0.6666666666666666);");
    assert.match(result.phaser.snippets.preload, /load\.spritesheet/);
    assert.match(result.phaser.snippets.anims, /generateFrameNumbers/);
    const packed = decodePngRgba(await readFile(output));
    assert.equal(packed.width, 15);
    assert.equal(packed.height, 6);
    // 逐 cell 还原像素，防止仅凭尺寸误把按块写入当成水平 spritesheet。
    const expectedCell = transparentImage(5, 6);
    fillRect(expectedCell, 1, 1, 3, 4);
    for (let frameIndex = 0; frameIndex < 3; frameIndex += 1) for (let y = 0; y < 6; y += 1) for (let x = 0; x < 5; x += 1) {
      const packedOffset = (y * packed.width + frameIndex * 5 + x) * 4;
      const expectedOffset = (y * 5 + x) * 4;
      assert.deepEqual([...packed.pixels.subarray(packedOffset, packedOffset + 4)], [...expectedCell.pixels.subarray(expectedOffset, expectedOffset + 4)], `frame ${frameIndex} cell pixel ${x},${y}`);
    }
    assert.match(result.artifacts.sheet.sha256, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(JSON.parse(await readFile(reportFile, "utf8")).quality, result.quality);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ground-contact 只使用底部接触带，单侧伸手不会横移稳定躯干", async () => {
  const root = await mkdtemp(join(tmpdir(), "character-frame-ground-contact-"));
  try {
    const input = join(root, "input");
    await mkdir(input);
    const leftReach = transparentImage(12, 12);
    const rightReach = transparentImage(12, 12);
    fillRect(leftReach, 4, 3, 3, 8);
    fillRect(rightReach, 4, 3, 3, 8);
    // 手臂远离底部接触带，轮廓 bbox 中心会变化，但脚底中位 x 保持在 5。
    fillRect(leftReach, 0, 3, 2, 3);
    fillRect(rightReach, 8, 3, 2, 3);
    await writeFrame(input, "frame1.png", leftReach);
    await writeFrame(input, "frame2.png", rightReach);
    const result = await packCharacterFrames({ inputDir: input, outputSheet: join(root, "hero.png"), outputReport: join(root, "hero.json"), animationKey: "hero", textureKey: "hero", contactBandRatio: 0.2, noLoop: true });
    assert.equal(result.status, "PASS");
    assert.equal(result.anchor.mode, "ground-contact");
    assert.equal(result.anchor.contact_band_ratio, 0.2);
    assert.deepEqual(result.frames.map((frame) => frame.anchor.x), [5, 5]);
    assert.deepEqual(result.frames.map((frame) => frame.offset.x), [0, 0]);
    assert.notEqual(result.frames[0].bbox_anchor.x, result.frames[1].bbox_anchor.x);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fixed-canvas 要求同尺寸并保留 jump 的源画布位移轨迹", async () => {
  const root = await mkdtemp(join(tmpdir(), "character-frame-fixed-canvas-"));
  try {
    const input = join(root, "input");
    await mkdir(input);
    const grounded = transparentImage(12, 12);
    const airborne = transparentImage(12, 12);
    fillRect(grounded, 4, 7, 3, 4);
    fillRect(airborne, 4, 2, 3, 4);
    await writeFrame(input, "frame1.png", grounded);
    await writeFrame(input, "frame2.png", airborne);
    const result = await packCharacterFrames({ inputDir: input, outputSheet: join(root, "jump.png"), outputReport: join(root, "jump.json"), animationKey: "hero-jump", textureKey: "hero", anchorMode: "fixed-canvas", minAlphaIoU: 0, noLoop: true });
    assert.equal(result.status, "PASS");
    assert.equal(result.anchor.mode, "fixed-canvas");
    assert.deepEqual(result.cell, { width: 12, height: 12, padding: 0, target_anchor: { x: 5, y: 11 }, extents: { left: 5, right: 6, top: 11, bottom: 0 }, layout: "horizontal" });
    assert.deepEqual(result.frames.map((frame) => frame.offset), [{ x: 0, y: 0 }, { x: 0, y: 0 }]);
    assert.deepEqual(result.frames.map((frame) => frame.normalized_bbox.y), [7, 2]);
    const packed = decodePngRgba(await readFile(join(root, "jump.png")));
    assert.equal(packed.pixels[(7 * packed.width + 4) * 4 + 3], 255);
    assert.equal(packed.pixels[(2 * packed.width + 12 + 4) * 4 + 3], 255);
    assert.equal(packed.pixels[(2 * packed.width + 4) * 4 + 3], 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit anchor-file 对齐逐帧语义根，且缺帧立即拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "character-frame-explicit-anchor-"));
  try {
    const input = join(root, "input");
    await mkdir(input);
    const first = transparentImage(10, 12);
    const second = transparentImage(10, 12);
    fillRect(first, 3, 7, 3, 4);
    fillRect(second, 3, 2, 3, 4);
    await writeFrame(input, "frame1.png", first);
    await writeFrame(input, "frame2.png", second);
    const anchorFile = join(root, "anchors.json");
    // 锚点位于主体内部，cell 必须同时保留锚点下方的主体像素。
    await writeFile(anchorFile, JSON.stringify({ "frame1.png": { x: 4, y: 8 }, "frame2.png": { x: 4, y: 3 } }));
    const result = await packCharacterFrames({ inputDir: input, outputSheet: join(root, "explicit.png"), outputReport: join(root, "explicit.json"), animationKey: "hero", textureKey: "hero", anchorFile, anchorMode: "explicit", noLoop: true });
    assert.equal(result.status, "PASS");
    assert.equal(result.anchor.mode, "explicit");
    assert.equal(result.anchor.anchor_file, anchorFile);
    assert.deepEqual(result.frames.map((frame) => frame.anchor), [{ x: 4, y: 8 }, { x: 4, y: 3 }]);
    assert.equal(result.cell.height, 4);
    assert.equal(result.cell.extents.bottom, 2);
    assert.equal(result.frames.every((frame) => frame.normalized_bbox.height === 4), true);
    const explicitSheet = decodePngRgba(await readFile(join(root, "explicit.png")));
    assert.equal(explicitSheet.pixels[(3 * explicitSheet.width + 2) * 4 + 3], 255);
    assert.equal(result.frames.every((frame) => frame.normalized_anchor.x === result.cell.target_anchor.x && frame.normalized_anchor.y === result.cell.target_anchor.y), true);
    await writeFile(anchorFile, JSON.stringify({ "frame1.png": { x: 4, y: 8 } }));
    await assert.rejects(() => packCharacterFrames({ inputDir: input, outputSheet: join(root, "missing.png"), outputReport: join(root, "missing.json"), anchorFile, anchorMode: "explicit", noLoop: true }), /缺少帧 frame2\.png/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("自然序比较不会把 frame10 提前到 frame2", () => {
  assert(naturalCompare("frame2.png", "frame10.png") < 0);
  assert(naturalCompare("frame01.png", "frame1.png") > 0);
});

test("循环转场会按环形速度直接计算质心加速度", () => {
  const mask = new Uint8Array([1]);
  const frames = [0, 1, 3].map((x, index) => ({
    name: `frame${index}.png`,
    mask,
    stats: { centroid: { x, y: 0 }, visible: 1 },
  }));
  const result = evaluateTransitions(frames, {
    loop: true,
    thresholds: { minAlphaIoU: 0, maxForegroundAreaChange: 1, maxCentroidStep: 10, maxCentroidAcceleration: 10 },
  });
  // 速度依次为 +1、+2、-3；闭环加速度应为 1、5、4，而不是忽略尾首接缝。
  assert.deepEqual(result.transitions.map((transition) => transition.centroid_acceleration), [4, 1, 5]);
  assert.equal(result.failures.length, 0);
});

test("形状突变和循环尾首接缝会在候选输出后被质量门定位", async () => {
  const root = await mkdtemp(join(tmpdir(), "character-frame-seam-"));
  try {
    const input = join(root, "input");
    const output = join(root, "hero.png");
    const reportFile = join(root, "hero.json");
    await mkdir(input);
    const first = transparentImage(9, 9);
    const second = transparentImage(9, 9);
    const third = transparentImage(9, 9);
    fillRect(first, 3, 2, 3, 5);
    fillRect(second, 3, 2, 3, 5);
    fillRect(third, 1, 5, 7, 1);
    await writeFrame(input, "frame1.png", first);
    await writeFrame(input, "frame2.png", second);
    await writeFrame(input, "frame3.png", third);
    const result = await packCharacterFrames({ inputDir: input, outputSheet: output, outputReport: reportFile, animationKey: "hero", textureKey: "hero", minAlphaIoU: 0.9, loop: true });
    assert.equal(result.exitCode, FRAME_ANIMATION_EXIT_CODES.qualityFailure);
    assert.equal(result.status, "FAIL");
    assert.equal(result.quality.failures.some((failure) => failure.loop_seam === true), true);
    assert.equal(result.transitions.some((transition) => transition.loop_seam === true), true);
    await access(output);
    await access(reportFile);
    assert.equal(JSON.parse(await readFile(reportFile, "utf8")).status, "FAIL");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("空帧、覆盖输入和默认覆盖输出都会被非法输入门拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "character-frame-safety-"));
  try {
    const input = join(root, "input");
    await mkdir(input);
    const valid = transparentImage(4, 4);
    fillRect(valid, 1, 1, 2, 2);
    const inputFrame = await writeFrame(input, "frame1.png", valid);
    await writeFrame(input, "frame2.png", transparentImage(4, 4));
    await assert.rejects(() => packCharacterFrames({ inputDir: input, outputSheet: join(root, "sheet.png"), outputReport: join(root, "report.json") }), (error) => error instanceof FrameAnimationError && /空 Alpha/.test(error.message));

    const secondInput = join(root, "second-input");
    await mkdir(secondInput);
    await writeFrame(secondInput, "frame1.png", valid);
    await writeFrame(secondInput, "frame2.png", valid);
    await assert.rejects(() => packCharacterFrames({ inputDir: secondInput, outputSheet: join(secondInput, "frame1.png"), outputReport: join(root, "safe.json") }), /不得覆盖输入/);

    const existingSheet = join(root, "existing.png");
    const existingReport = join(root, "existing.json");
    await writeFile(existingSheet, Buffer.from("keep"));
    await assert.rejects(() => packCharacterFrames({ inputDir: secondInput, outputSheet: existingSheet, outputReport: existingReport }), /默认拒绝覆盖/);
    assert.equal(await readFile(existingSheet, "utf8"), "keep");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("symlink 或 hardlink 输出别名永远不能覆盖输入（平台不支持时跳过）", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "character-frame-alias-protection-"));
  try {
    const input = join(root, "input");
    await mkdir(input);
    const image = transparentImage(4, 4);
    fillRect(image, 1, 1, 2, 2);
    const source = await writeFrame(input, "frame1.png", image);
    await writeFrame(input, "frame2.png", image);
    let hardlinkCreated = false;
    try {
      await link(source, join(root, "hardlink.png"));
      hardlinkCreated = true;
    } catch (error) {
      if (!(["EPERM", "EACCES", "EXDEV", "ENOSYS"].includes(error?.code))) throw error;
    }
    let symlinkCreated = false;
    try {
      await symlink(source, join(root, "symlink.png"), "file");
      symlinkCreated = true;
    } catch (error) {
      if (!(["EPERM", "EACCES", "ENOSYS"].includes(error?.code))) throw error;
    }
    if (!hardlinkCreated && !symlinkCreated) {
      t.skip("当前平台或权限不支持创建 hardlink/symlink");
      return;
    }
    if (hardlinkCreated) await assert.rejects(() => packCharacterFrames({ inputDir: input, outputSheet: join(root, "hardlink.png"), outputReport: join(root, "hardlink.json"), force: true }), /别名/);
    if (symlinkCreated) await assert.rejects(() => packCharacterFrames({ inputDir: input, outputSheet: join(root, "symlink.png"), outputReport: join(root, "symlink.json"), force: true }), /别名/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI 对质量失败返回独立退出码并保留失败报告", async () => {
  const root = await mkdtemp(join(tmpdir(), "character-frame-cli-"));
  try {
    const input = join(root, "input");
    await mkdir(input);
    const first = transparentImage(6, 6);
    const second = transparentImage(6, 6);
    fillRect(first, 1, 1, 3, 3);
    fillRect(second, 1, 4, 3, 1);
    await writeFrame(input, "frame1.png", first);
    await writeFrame(input, "frame2.png", second);
    const output = join(root, "cli.png");
    const report = join(root, "cli.json");
    const collector = outputCollector();
    const code = await runFrameAnimationCli(["--input-dir", input, "--output-sheet", output, "--output-report", report, "--animation-key", "hero", "--texture-key", "hero", "--no-loop", "--min-alpha-iou", "1"], collector);
    assert.equal(code, FRAME_ANIMATION_EXIT_CODES.qualityFailure);
    assert.equal(collector.errors.length, 0);
    assert.equal(JSON.parse(collector.logs[0]).exitCode, FRAME_ANIMATION_EXIT_CODES.qualityFailure);
    await access(output);
    await access(report);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
