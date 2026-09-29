import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateVisualLayoutEditor } from "./generate-visual-layout-editor.mjs";

test("在游戏项目新目录生成完整编辑器模板且不覆盖已有目录", async () => {
  const root = await mkdtemp(join(tmpdir(), "visual-layout-template-"));
  try {
    const files = await generateVisualLayoutEditor(root, "editor");
    assert.equal(files.length, 4);
    const html = await readFile(join(root, "editor", "index.html"), "utf8");
    assert.match(html, /mountVisualLayoutEditor/);
    assert.match(html, /pickVisualLayoutFileStore/);
    await assert.rejects(generateVisualLayoutEditor(root, "editor"), { code: "EEXIST" });
    await assert.rejects(generateVisualLayoutEditor(root, "../escape"), /逃逸/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
