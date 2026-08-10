#!/usr/bin/env python3
"""验证 Spine 换皮工具的进度状态、失败恢复和透明 Page 重建。"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - 缺少可选依赖时由工具本身给出清晰错误。
    Image = None

import spine_reskin_progress as progress


@unittest.skipUnless(Image is not None, "测试需要 Pillow")
class SpineReskinProgressTests(unittest.TestCase):
    """覆盖多 Cell 进度、失败重试、恢复以及从空白页重建的关键不变量。"""

    def setUp(self) -> None:
        """为每个测试建立隔离的源 Atlas、源 Page 和候选目录。"""
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        source = Image.new("RGBA", (10, 8), (17, 29, 41, 255))
        source.save(self.root / "source.png")
        atlas = """source.png
size: 10, 8
format: RGBA8888
filter: Linear,Linear
repeat: none
pma: false

hero
  rotate: false
  xy: 1, 1
  size: 3, 2
  orig: 5, 4
  offset: 1, 1
  index: -1

rot
  rotate: true
  xy: 5, 1
  size: 2, 3
  orig: 3, 4
  offset: 0, 0
  index: -1
"""
        self.atlas = self.root / "source.atlas"
        self.atlas.write_text(atlas, encoding="utf-8")
        self.manifest = self.root / "candidate" / "progress.json"
        self.generated = self.root / "candidate" / "generated"
        self.generated.mkdir(parents=True)
        result = progress.main(
            [
                "init",
                "--atlas",
                str(self.atlas),
                "--output",
                str(self.manifest),
                "--reference-dir",
                str(self.root / "candidate" / "source-cells"),
            ]
        )
        self.assertEqual(result, 0)
        document = json.loads(self.manifest.read_text(encoding="utf-8"))
        self.assertEqual(len(document["cells"]), 2)
        self.assertTrue((self.root / "candidate" / "source-cells" / "p0_hero.png").is_file())

    def tearDown(self) -> None:
        """清理测试候选，避免源像素或临时状态污染其他用例。"""
        self.temp.cleanup()

    def _mark(self, cell: str, status: str, image: Path | None = None, error: str | None = None) -> int:
        """调用 CLI 标记 Cell，统一构造测试参数。"""
        args = ["mark", "--manifest", str(self.manifest), "--cell", cell, "--status", status]
        if image is not None:
            args.extend(["--image", str(image)])
        if error is not None:
            args.extend(["--error", error])
        return progress.main(args)

    def _write_generated(self) -> tuple[Path, Path]:
        """生成一张未裁剪 hero 图和一张旋转 Cell 图，模拟模型输出而不复制源像素。"""
        hero = Image.new("RGBA", (5, 4), (0, 0, 0, 0))
        for y in range(1, 3):
            for x in range(1, 4):
                hero.putpixel((x, y), (200, 20 + y, 30 + x, 255))
        hero_path = self.generated / "hero.png"
        hero.save(hero_path)

        rotated = Image.new("RGBA", (3, 4), (0, 0, 0, 0))
        colors = [
            [(255, 0, 0, 255), (0, 255, 0, 255), (0, 0, 255, 255)],
            [(255, 255, 0, 255), (255, 0, 255, 255), (0, 255, 255, 255)],
        ]
        for y, row in enumerate(colors, start=2):
            for x, color in enumerate(row):
                rotated.putpixel((x, y), color)
        rotated_path = self.generated / "rot.png"
        rotated.save(rotated_path)
        return hero_path, rotated_path

    def test_progress_failure_retry_recovery_and_incomplete_verify(self) -> None:
        """验证处理中恢复、失败重试和未完成禁止最终校验。"""
        hero_path, _ = self._write_generated()
        self.assertEqual(self._mark("p0:hero", "generating"), 0)
        self.assertEqual(progress.main(["recover", "--manifest", str(self.manifest)]), 0)
        document = json.loads(self.manifest.read_text(encoding="utf-8"))
        self.assertEqual(document["cells"][0]["status"], "pending")
        self.assertEqual(self._mark("p0:hero", "failed", error="生成器超时"), 0)
        self.assertEqual(self._mark("p0:hero", "generating"), 0)
        self.assertEqual(self._mark("p0:hero", "generated", image=hero_path), 0)
        self.assertEqual(progress.main(["verify", "--manifest", str(self.manifest)]), 1)
        summary = progress.main(["status", "--manifest", str(self.manifest)])
        self.assertEqual(summary, 0)

    def test_blank_page_rebuild_preserves_uv_rotation_and_drops_old_pixels(self) -> None:
        """验证 trim/offset、90 度旋转、空白页和非 Region 旧像素不被复制。"""
        hero_path, rotated_path = self._write_generated()
        self.assertEqual(self._mark("p0:hero", "generated", image=hero_path), 0)
        self.assertEqual(self._mark("p0:rot", "generating"), 0)
        self.assertEqual(self._mark("p0:rot", "generated", image=rotated_path), 0)
        self.assertEqual(self._mark("p0:hero", "validating"), 0)
        self.assertEqual(self._mark("p0:rot", "validating"), 0)
        output_dir = self.root / "candidate" / "atlas"
        self.assertEqual(
            progress.main(["pack", "--manifest", str(self.manifest), "--output-dir", str(output_dir)]),
            0,
        )
        rebuilt = Image.open(output_dir / "source.png").convert("RGBA")
        self.assertEqual(rebuilt.getpixel((0, 0)), (0, 0, 0, 0))
        self.assertEqual(rebuilt.getpixel((1, 1)), (200, 21, 31, 255))
        # 正向 rot 的左下黄色像素在顺时针存放后位于矩形左上。
        self.assertEqual(rebuilt.getpixel((5, 1)), (255, 255, 0, 255))
        self.assertEqual(rebuilt.getpixel((6, 3)), (0, 0, 255, 255))
        self.assertEqual(progress.main(["verify", "--manifest", str(self.manifest)]), 0)
        page_path = output_dir / "source.png"
        page_bytes = page_path.read_bytes()
        page_path.write_bytes(page_bytes[:-1] + bytes([page_bytes[-1] ^ 1]))
        self.assertEqual(progress.main(["verify", "--manifest", str(self.manifest)]), 1)
        page_path.write_bytes(page_bytes)
        atlas_path = output_dir / "source.atlas"
        atlas_text_before = atlas_path.read_text(encoding="utf-8")
        atlas_path.write_text(atlas_text_before + "# tampered\n", encoding="utf-8")
        self.assertEqual(progress.main(["verify", "--manifest", str(self.manifest)]), 1)
        atlas_text = (output_dir / "source.atlas").read_text(encoding="utf-8")
        self.assertIn("hero", atlas_text)
        self.assertIn("rot", atlas_text)
        self.assertIn("xy: 5, 1", atlas_text)
        self.assertEqual(len(progress.parse_atlas(output_dir / "source.atlas")["cells"]), 2)

    def test_padding_and_extrusion_only_use_generated_pixels(self) -> None:
        """验证 padding/extrusion 在原矩形内扩展，不把源 Page 颜色带入候选。"""
        document = json.loads(self.manifest.read_text(encoding="utf-8"))
        document["cells"] = [document["cells"][0]]
        cell = document["cells"][0]
        cell.update({"name": "padded", "id": "p0:padded", "xy": [2, 2], "size": [4, 4], "orig": [4, 4], "offset": [0, 0]})
        self.manifest.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
        core = Image.new("RGBA", (2, 2), (90, 40, 10, 255))
        core_path = self.generated / "core.png"
        core.save(core_path)
        self.assertEqual(self._mark("p0:padded", "generated", image=core_path), 0)
        self.assertEqual(self._mark("p0:padded", "validating"), 0)
        output_dir = self.root / "candidate" / "padded-atlas"
        self.assertEqual(
            progress.main(
                [
                    "pack",
                    "--manifest",
                    str(self.manifest),
                    "--output-dir",
                    str(output_dir),
                    "--padding",
                    "1",
                    "--extrusion",
                    "1",
                ]
            ),
            0,
        )
        rebuilt = Image.open(output_dir / "source.png").convert("RGBA")
        for x in range(2, 6):
            for y in range(2, 6):
                self.assertEqual(rebuilt.getpixel((x, y)), (90, 40, 10, 255))

    def test_pma_is_applied_once_when_writing_blank_page(self) -> None:
        """验证 pma Page 的 RGB 只预乘一次，透明背景仍保持全透明。"""
        document = json.loads(self.manifest.read_text(encoding="utf-8"))
        document["cells"] = [document["cells"][0]]
        document["atlas"]["pages"][0]["fields"]["pma"] = "true"
        hero = Image.new("RGBA", (5, 4), (0, 0, 0, 0))
        hero.putpixel((1, 1), (200, 100, 50, 128))
        hero_path = self.generated / "pma.png"
        hero.save(hero_path)
        self.manifest.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
        self.assertEqual(self._mark("p0:hero", "generated", image=hero_path), 0)
        self.assertEqual(self._mark("p0:hero", "validating"), 0)
        output_dir = self.root / "candidate" / "pma-atlas"
        self.assertEqual(progress.main(["pack", "--manifest", str(self.manifest), "--output-dir", str(output_dir)]), 0)
        rebuilt = Image.open(output_dir / "source.png").convert("RGBA")
        self.assertEqual(rebuilt.getpixel((1, 1)), (100, 50, 25, 128))
        self.assertEqual(rebuilt.getpixel((0, 0)), (0, 0, 0, 0))


if __name__ == "__main__":
    unittest.main()
