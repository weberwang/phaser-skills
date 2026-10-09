import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { generateVisualLayoutEditor } from "./generate-visual-layout-editor.mjs";

test("在游戏项目新目录生成完整编辑器模板且不覆盖已有目录", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-layout-template-"));
  try {
    const files = await generateVisualLayoutEditor(root, "editor");
    assert.equal(files.length, 11);
    // 加载实际生成模块，验证扁平复制后的依赖能解析且仍使用统一缩放真源。
    const generated = await import(pathToFileURL(join(root, "editor", "page-sketch-editor.mjs")).href);
    const geometry = generated.calculateDevicePreviewGeometry({ width: 1920, height: 1080 }, { width: 2560, height: 1080 }, { width: 800, height: 600 });
    assert.equal(geometry.contentScale, 1);
    assert.equal(geometry.contentLeft, 320);
    const html = await readFile(join(root, "editor", "index.html"), "utf8");
    assert.match(html, /initializePageSketchApplication/);
    assert.match(html, /import Phaser from "phaser"/);
    assert.match(html, /adapters: \{ Phaser \}/);
    const formal = await import(pathToFileURL(join(root, "editor", "visual-layout-game-adapter.mjs")).href);
    assert.equal(typeof formal.createFormalPageSketchScene, "function");
    assert.match(html, /page-sketch-project-root/);
    assert.match(html, /id="stage-device"><div id="stage-surface"/);
    assert.match(html, /#stage-surface[^}]*overflow: visible/);
    assert.match(html, /#stage-device[^}]*overflow: hidden/);
    assert.match(html, /id="workspace-controls"/);
    assert.match(html, /id="layout-controls"/);
    assert.match(html, /id="preview-device"/);
    assert.match(html, /id="toggle-fullscreen"/);
    assert.match(html, /id="reset-sketch"/);
    assert.doesNotMatch(html, /confirmed-by|确认人/);
    assert.doesNotMatch(html, /grid-template-columns: 1fr;/);
    assert.doesNotMatch(html, /visual-layout-game-adapter/);
    for (const file of ["visual-layout-editor.mjs", "page-sketch-contract.mjs", "page-sketch-file-store.mjs", "page-sketch-preview.mjs", "page-sketch-editor.mjs", "page-sketch-layout.mjs", "page-sketch-phaser.mjs", "visual-layout-game-adapter.mjs"]) {
      assert.equal(await readFile(join(root, "editor", file), "utf8").then(Boolean), true);
    }
    await assert.rejects(generateVisualLayoutEditor(root, "editor"), { code: "EEXIST" });
    await assert.rejects(generateVisualLayoutEditor(root, "../escape"), /逃逸/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
