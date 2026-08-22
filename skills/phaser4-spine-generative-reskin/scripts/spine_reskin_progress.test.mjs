import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { ALPHA_CONTRACT_THRESHOLDS, isProcessAlive, main, parseAtlas, shouldReclaimLock } from "./spine_reskin_progress.mjs";

/** 创建指定颜色的 RGBA PNG。 */
async function writeImage(path, width, height, fill = [0, 0, 0, 0], pixels = []) {
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) for (let channel = 0; channel < 4; channel += 1) data[index * 4 + channel] = fill[channel];
  for (const [x, y, color] of pixels) for (let channel = 0; channel < 4; channel += 1) data[(y * width + x) * 4 + channel] = color[channel];
  await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(path);
}

/** 读取 PNG 的尺寸和指定像素。 */
async function readImage(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, pixel(x, y) { return [...data.subarray((y * info.width + x) * 4, (y * info.width + x + 1) * 4)]; } };
}

/** 调用 mark 子命令。 */
async function mark(fixture, cell, status, image, error) {
  const args = ["mark", "--manifest", fixture.manifest, "--cell", cell, "--status", status];
  if (image) args.push("--image", image);
  if (error) args.push("--error", error);
  return main(args);
}

/** 调用 Cell 正式验证命令。 */
async function validate(fixture, cell, evidence) { const args = ["validate", "--manifest", fixture.manifest, "--cell", cell]; if (evidence) args.push("--evidence", evidence); return main(args); }

/** 建立包含两个旋转/裁剪 Cell 的隔离候选目录。 */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "spine-reskin-v2-"));
  await writeImage(join(root, "source.png"), 10, 8, [17, 29, 41, 255]);
  const atlas = join(root, "source.atlas");
  await writeFile(atlas, `source.png\nsize: 10, 8\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\npma: false\n\nhero\n  rotate: false\n  xy: 1, 1\n  size: 3, 2\n  orig: 5, 4\n  offset: 1, 1\n  index: -1\n\nrot\n  rotate: true\n  xy: 5, 1\n  size: 2, 3\n  orig: 3, 4\n  offset: 0, 0\n  index: -1\n`);
  const skeleton = join(root, "hero.json");
  await writeFile(skeleton, "{\"skeleton\":\"test\"}\n");
  const candidate = join(root, "candidate");
  const generated = join(candidate, "generated");
  const evidence = join(candidate, "evidence");
  const manifest = join(candidate, "progress.json");
  assert.equal(await main(["init", "--atlas", atlas, "--output", manifest, "--skeleton", skeleton]), 0);
  await mkdir(generated, { recursive: true });
  await mkdir(evidence, { recursive: true });
  const document = JSON.parse(await readFile(manifest, "utf8"));
  assert.equal(document.schema_version, 2);
  assert.equal(document.cells.length, 2);
  assert.equal(document.cells[0].mode, "constrained-redraw");
  return { root, atlas, skeleton, candidate, generated, evidence, manifest };
}

/** 写入未裁剪 hero 和旋转 Cell 生成图。 */
async function writeGenerated(fixtureValue) {
  const hero = join(fixtureValue.generated, "hero.png");
  const heroPixels = [];
  for (let y = 1; y < 3; y += 1) for (let x = 1; x < 4; x += 1) heroPixels.push([x, y, [200, 20 + y, 30 + x, 255]]);
  await writeImage(hero, 5, 4, [0, 0, 0, 0], heroPixels);
  const rotated = join(fixtureValue.generated, "rot.png");
  await writeImage(rotated, 3, 4, [0, 0, 0, 0], [[0, 2, [255, 0, 0, 255]], [1, 2, [0, 255, 0, 255]], [2, 2, [0, 0, 255, 255]], [0, 3, [255, 255, 0, 255]], [1, 3, [255, 0, 255, 255]], [2, 3, [0, 255, 255, 255]]]);
  return [hero, rotated];
}

/** 生成审阅文件，避免把生成图本身冒充为证据。 */
async function reviewFile(fixtureValue, name, content = "human review") {
  const path = join(fixtureValue.evidence, name);
  await writeFile(path, content);
  return path;
}

/** 让所有 Cell 通过正式验证。 */
async function validateAll(fixtureValue, images) {
  for (let index = 0; index < images.length; index += 1) assert.equal(await mark(fixtureValue, index === 0 ? "p0:hero" : "p0:rot", "generated", images[index]), 0);
  assert.equal(await validate(fixtureValue, "p0:hero", await reviewFile(fixtureValue, "hero-review.txt")), 0);
  assert.equal(await validate(fixtureValue, "p0:rot", await reviewFile(fixtureValue, "rot-review.txt")), 0);
}

test("v2 初始化要求 Skeleton、记录哈希并默认导出结构参考", async () => {
  const fixtureValue = await fixture();
  const document = JSON.parse(await readFile(fixtureValue.manifest, "utf8"));
  assert.equal(document.skeletons.length, 1);
  assert.ok(document.skeletons[0].sha256);
  assert.ok(document.cells.every((cell) => cell.source_reference && cell.source_reference_sha256));
  assert.equal(await main(["init", "--atlas", fixtureValue.atlas, "--output", join(fixtureValue.root, "missing.json")]), 2);
});

test("failed 不能直达 generated，且验证缺证据会失败", async () => {
  const fixtureValue = await fixture();
  const [hero] = await writeGenerated(fixtureValue);
  assert.equal(await mark(fixtureValue, "p0:hero", "failed", null, "生成器超时"), 0);
  assert.equal(await mark(fixtureValue, "p0:hero", "generated", hero), 2);
  assert.equal(await mark(fixtureValue, "p0:hero", "generating"), 0);
  assert.equal(await mark(fixtureValue, "p0:hero", "generated", hero), 0);
  assert.equal(await validate(fixtureValue, "p0:hero", null), 2);
  assert.equal(JSON.parse(await readFile(fixtureValue.manifest, "utf8")).cells[0].status, "failed");
});

test("并发 mark 不丢失 Cell 更新，三种模式可配置", async () => {
  const fixtureValue = await fixture();
  const [hero, rotated] = await writeGenerated(fixtureValue);
  await Promise.all([mark(fixtureValue, "p0:hero", "generating"), mark(fixtureValue, "p0:rot", "generating")]);
  await Promise.all([mark(fixtureValue, "p0:hero", "generated", hero), mark(fixtureValue, "p0:rot", "generated", rotated)]);
  assert.equal(await main(["configure", "--manifest", fixtureValue.manifest, "--cell", "p0:hero", "--mode", "palette-refresh"]), 0);
  assert.equal(await main(["set-mode", "--manifest", fixtureValue.manifest, "--cell", "p0:rot", "--mode", "mesh-safe"]), 0);
  const document = JSON.parse(await readFile(fixtureValue.manifest, "utf8"));
  assert.deepEqual(document.cells.map((cell) => cell.status), ["generated", "generated"]);
  assert.deepEqual(document.cells.map((cell) => cell.mode), ["palette-refresh", "mesh-safe"]);
});

test("alpha 结构合同按模式生效：palette 严格，constrained 允许受控变化", async () => {
  assert.equal(ALPHA_CONTRACT_THRESHOLDS.palette_refresh_max_mask_mismatch, 0);
  const makePartial = async (fixtureValue) => {
    const image = join(fixtureValue.generated, "partial.png");
    const pixels = [];
    for (let y = 1; y < 3; y += 1) for (let x = 1; x < 4; x += 1) if (!(x === 3 && y === 2)) pixels.push([x, y, [220, 90, 30, 255]]);
    await writeImage(image, 5, 4, [0, 0, 0, 0], pixels);
    return image;
  };
  const strict = await fixture();
  const strictImage = await makePartial(strict);
  await mark(strict, "p0:hero", "generated", strictImage);
  await main(["configure", "--manifest", strict.manifest, "--cell", "p0:hero", "--mode", "palette-refresh"]);
  assert.equal(await validate(strict, "p0:hero", await reviewFile(strict, "strict.txt")), 2);
  assert.equal(JSON.parse(await readFile(strict.manifest, "utf8")).cells[0].status, "failed");

  const constrained = await fixture();
  const constrainedImage = await makePartial(constrained);
  await mark(constrained, "p0:hero", "generated", constrainedImage);
  await main(["configure", "--manifest", constrained.manifest, "--cell", "p0:hero", "--mode", "constrained-redraw"]);
  assert.equal(await validate(constrained, "p0:hero", await reviewFile(constrained, "constrained.txt")), 0);
});

test("陈旧锁只回收已退出 PID，活锁不会被 mtime 误删", async () => {
  assert.equal(isProcessAlive(process.pid), true);
  assert.equal(shouldReclaimLock({ pid: process.pid }, 0), false);
  assert.equal(shouldReclaimLock({ pid: 2147483647 }, 0), true);
  const fixtureValue = await fixture();
  const lockPath = `${fixtureValue.manifest}.lock`;
  await writeFile(lockPath, JSON.stringify({ pid: 2147483647, token: "dead" }));
  await utimes(lockPath, new Date(0), new Date(0));
  assert.equal(await mark(fixtureValue, "p0:hero", "generating"), 0);
});

test("空白多 Page 重建保持裁剪、旋转、PNG 和 packed 未完成闭环", async () => {
  const fixtureValue = await fixture();
  const [hero, rotated] = await writeGenerated(fixtureValue);
  await validateAll(fixtureValue, [hero, rotated]);
  const output = join(fixtureValue.candidate, "atlas");
  assert.equal(await main(["pack", "--manifest", fixtureValue.manifest, "--output-dir", output]), 0);
  let document = JSON.parse(await readFile(fixtureValue.manifest, "utf8"));
  assert.deepEqual(document.cells.map((cell) => cell.status), ["packed", "packed"]);
  assert.equal(await main(["verify", "--manifest", fixtureValue.manifest]), 1);
  const image = await readImage(join(output, "source.png"));
  assert.deepEqual(image.pixel(0, 0), [0, 0, 0, 0]);
  assert.deepEqual(image.pixel(1, 1), [200, 21, 31, 255]);
  assert.deepEqual(image.pixel(5, 1), [255, 255, 0, 255]);
  assert.deepEqual(image.pixel(6, 3), [0, 0, 255, 255]);
  const runtime = await reviewFile(fixtureValue, "runtime.png", "phaser runtime screenshot");
  assert.equal(await main(["finalize", "--manifest", fixtureValue.manifest, "--evidence", runtime]), 0);
  document = JSON.parse(await readFile(fixtureValue.manifest, "utf8"));
  assert.ok(document.runtime_evidence[0].sha256);
  assert.deepEqual(document.cells.map((cell) => cell.status), ["completed", "completed"]);
  assert.equal(await main(["verify", "--manifest", fixtureValue.manifest]), 0);
});

test("多 Page Atlas 为每页生成独立 PNG 并保持 Page 顺序", async () => {
  const root = await mkdtemp(join(tmpdir(), "spine-reskin-pages-"));
  await writeImage(join(root, "page-a.png"), 6, 4, [10, 20, 30, 255]);
  await writeImage(join(root, "page-b.png"), 6, 4, [40, 50, 60, 255]);
  const skeleton = join(root, "skeleton.json");
  await writeFile(skeleton, "skeleton");
  const atlas = join(root, "multi.atlas");
  await writeFile(atlas, `page-a.png\nsize: 6, 4\nformat: RGBA8888\n\na\nxy: 0, 0\nsize: 2, 2\n\npage-b.png\nsize: 6, 4\nformat: RGBA8888\n\nb\nxy: 1, 1\nsize: 2, 2\n`);
  const candidate = join(root, "candidate");
  const manifest = join(candidate, "progress.json");
  await main(["init", "--atlas", atlas, "--output", manifest, "--skeleton", skeleton]);
  const generated = join(candidate, "generated");
  const evidence = join(candidate, "evidence");
  await mkdir(generated, { recursive: true });
  await mkdir(evidence, { recursive: true });
  const imageA = join(generated, "a.png");
  const imageB = join(generated, "b.png");
  await writeImage(imageA, 2, 2, [220, 10, 10, 255]);
  await writeImage(imageB, 2, 2, [10, 220, 10, 255]);
  const evidenceA = join(evidence, "a.txt");
  const evidenceB = join(evidence, "b.txt");
  await writeFile(evidenceA, "review a");
  await writeFile(evidenceB, "review b");
  await mark({ manifest }, "p0:a", "generated", imageA);
  await mark({ manifest }, "p1:b", "generated", imageB);
  await validate({ manifest }, "p0:a", evidenceA);
  await validate({ manifest }, "p1:b", evidenceB);
  const output = join(candidate, "atlas");
  assert.equal(await main(["pack", "--manifest", manifest, "--output-dir", output]), 0);
  assert.equal((await readImage(join(output, "page-a.png"))).width, 6);
  assert.equal((await readImage(join(output, "page-b.png"))).height, 4);
  const outputAtlas = await readFile(join(output, "multi.atlas"), "utf8");
  assert.ok(outputAtlas.indexOf("page-a.png") < outputAtlas.indexOf("page-b.png"));
});

test("路径祖先保护、源漂移和外部/旧纹理路径都被拒绝", async () => {
  const fixtureValue = await fixture();
  const [hero, rotated] = await writeGenerated(fixtureValue);
  await validateAll(fixtureValue, [hero, rotated]);
  assert.equal(await main(["pack", "--manifest", fixtureValue.manifest, "--output-dir", fixtureValue.candidate, "--force"]), 2);
  const sourceImage = join(fixtureValue.root, "source.png");
  assert.equal(await mark(fixtureValue, "p0:hero", "pending"), 0);
  assert.equal(await mark(fixtureValue, "p0:hero", "generating"), 0);
  assert.equal(await mark(fixtureValue, "p0:hero", "generated", sourceImage), 2);
  await writeFile(fixtureValue.skeleton, "tampered");
  assert.equal(await main(["pack", "--manifest", fixtureValue.manifest, "--output-dir", join(fixtureValue.candidate, "atlas-2")]), 2);
});

test("Atlas 输入审计拒绝重复、越界、重叠、尺寸不符和 Page 输出名碰撞", async () => {
  const root = await mkdtemp(join(tmpdir(), "spine-reskin-audit-"));
  const skeleton = join(root, "skeleton.json");
  await writeFile(skeleton, "skeleton");
  const page = join(root, "page.png");
  await writeImage(page, 8, 8, [0, 0, 0, 255]);
  async function rejected(atlasText, expected = 2) {
    const atlas = join(root, `${Math.random().toString(16).slice(2)}.atlas`);
    await writeFile(atlas, atlasText);
    assert.equal(await main(["init", "--atlas", atlas, "--output", join(root, "out", `${Math.random().toString(16).slice(2)}.json`), "--skeleton", skeleton]), expected);
  }
  const duplicate = `page.png\nsize: 8, 8\nformat: RGBA8888\n\na\nxy: 0, 0\nsize: 1, 1\n\na\nxy: 2, 0\nsize: 1, 1\n`;
  const overlap = `page.png\nsize: 8, 8\nformat: RGBA8888\n\na\nxy: 0, 0\nsize: 2, 2\n\nb\nxy: 1, 1\nsize: 2, 2\n`;
  const outOfBounds = `page.png\nsize: 8, 8\nformat: RGBA8888\n\na\nxy: 7, 7\nsize: 2, 2\n`;
  const badOrig = `page.png\nsize: 8, 8\nformat: RGBA8888\n\na\nxy: 0, 0\nsize: 2, 2\norig: 2, 2\noffset: 2, 0\n`;
  await rejected(duplicate);
  await rejected(overlap);
  await rejected(outOfBounds);
  await rejected(badOrig);
  const mismatch = `page.png\nsize: 7, 8\nformat: RGBA8888\n\na\nxy: 0, 0\nsize: 1, 1\n`;
  await rejected(mismatch);
  await writeImage(join(root, "foo.jpg"), 8, 8, [0, 0, 0, 255]);
  await writeImage(join(root, "foo.png"), 8, 8, [0, 0, 0, 255]);
  await rejected(`foo.jpg\nsize: 8, 8\nformat: RGBA8888\n\na\nxy: 0, 0\nsize: 1, 1\n\nfoo.png\nsize: 8, 8\nformat: RGBA8888\n\nb\nxy: 2, 0\nsize: 1, 1\n`);
  await parseAtlas(join(root, "not-created.atlas")).catch(() => {});
});

test("init 直接拒绝绝对 Page、.. 逃逸和空 Page 名", async () => {
  const root = await mkdtemp(join(tmpdir(), "spine-reskin-page-name-"));
  await writeImage(join(root, "page.png"), 4, 4, [0, 0, 0, 255]);
  const skeleton = join(root, "skeleton.json");
  await writeFile(skeleton, "skeleton");
  async function rejected(pageName, index) {
    const atlas = join(root, `bad-${index}.atlas`);
    await writeFile(atlas, `${pageName}\nsize: 4, 4\nformat: RGBA8888\n\na\nxy: 0, 0\nsize: 1, 1\n`);
    assert.equal(await main(["init", "--atlas", atlas, "--output", join(root, `candidate-${index}`, "progress.json"), "--skeleton", skeleton]), 2);
  }
  await rejected("../page.png", 1);
  await rejected("C:/page.png", 2);
  await rejected("/tmp/page.png", 3);
  await rejected("", 4);
});

test("源 Cell 参考文件名在清洗冲突时仍保持唯一", async () => {
  const root = await mkdtemp(join(tmpdir(), "spine-reskin-reference-name-"));
  await writeImage(join(root, "page.png"), 8, 4, [0, 0, 0, 255]);
  const skeleton = join(root, "skeleton.json");
  await writeFile(skeleton, "skeleton");
  const atlas = join(root, "reference.atlas");
  await writeFile(atlas, `page.png\nsize: 8, 4\nformat: RGBA8888\n\na/b\nxy: 0, 0\nsize: 2, 2\n\na?b\nxy: 3, 0\nsize: 2, 2\n`);
  const manifest = join(root, "candidate", "progress.json");
  assert.equal(await main(["init", "--atlas", atlas, "--output", manifest, "--skeleton", skeleton]), 0);
  const names = await readdir(join(root, "candidate", "source-cells"));
  assert.equal(names.length, 2);
  assert.notEqual(names[0], names[1]);
});

test("padding 参数不会在完整尺寸输入时静默吞掉非法 extrusion", async () => {
  const fixtureValue = await fixture();
  const [hero, rotated] = await writeGenerated(fixtureValue);
  await validateAll(fixtureValue, [hero, rotated]);
  assert.equal(await main(["pack", "--manifest", fixtureValue.manifest, "--output-dir", join(fixtureValue.candidate, "bad-padding"), "--padding", "1", "--extrusion", "2"]), 2);
});

test("生成图、审阅证据和运行证据哈希漂移会使 verify 失败", async () => {
  const fixtureValue = await fixture();
  const [hero, rotated] = await writeGenerated(fixtureValue);
  await validateAll(fixtureValue, [hero, rotated]);
  assert.equal(await main(["pack", "--manifest", fixtureValue.manifest, "--output-dir", join(fixtureValue.candidate, "atlas")]), 0);
  const runtime = await reviewFile(fixtureValue, "runtime.txt", "runtime");
  assert.equal(await main(["finalize", "--manifest", fixtureValue.manifest, "--evidence", runtime]), 0);
  await writeFile(runtime, "tampered");
  assert.equal(await main(["verify", "--manifest", fixtureValue.manifest]), 1);
});
