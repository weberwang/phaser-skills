#!/usr/bin/env python3
"""按阶段初始化 Phaser 4 游戏项目的中文协作文档。"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


CORE_TEMPLATES = {
    "project-profile.yaml": """# 项目配置是角色协作的机器可读事实来源。
project:
  名称: 待定
  当前阶段: 立项
  版本: 0.1.0
workflow:
  当前通道: 快速
  升级条件: 跨模块、架构或数据边界、资源权属、目标渠道、质量或发布风险发生变化
channels:
  首发渠道: 待人工指定
  候选渠道: []
capabilities:
  # 可选能力默认关闭；只有实际启用时才需要单独评审实现、数据和合规影响。
  登录: false
  云存档: false
  内购: false
  广告: false
  埋点: false
  推送: false
  排行榜: false
  联机: false
quality_targets:
  当前档位: 原型
  原型验收: 干净环境可构建且核心流程可完成
  发布指标: 待进入发布通道时按目标渠道定义
""",
    "GDD.md": """# 游戏设计文档

## 一句话定义

待人工定义。

## 玩家与核心循环

待人工定义：目标玩家、操作方式、目标、反馈、失败与重试。

## 最小可交付范围

待人工批准。

## 功能验收条件

| 功能 | 玩家行为 | 可观察结果 | 负责人 | 状态 |
| --- | --- | --- | --- | --- |

## 明确排除项

待人工定义。
""",
    "TDD.md": """# 技术设计文档

## 技术基线

- 游戏：Phaser 4 + TypeScript + Vite
- 原生容器：Capacitor
- 渠道适配：小游戏、iOS、Google Play 分别评估

## 模块边界

待技术架构角色补充：场景、状态、输入、资源、存档、平台与可选商业服务。

## 构建与运行

待技术架构角色记录可复现命令、版本和环境要求。

## 风险与待决策

待补充。
""",
    "control-plane.md": """# 项目控制面

标准、发布通道记录当前状态和索引；快速通道仅记录未决决策或阻断项。规则、实现细节与完整证据写入对应交付物。质量门汇合后删除已无后续影响的条目。

## 当前质量门

| 阶段 | 状态 | 通过条件或阻断项 | 最近证据 |
| --- | --- | --- | --- |
| G0 | 待人工决策 | 待制作策划补充 |  |

## 待人工决策与拷问记录

| 日期 | 阶段 | 触发原因 | 已核实事实 | 问题与推荐项 | 人工结论 | 影响与下一步 |
| --- | --- | --- | --- | --- | --- | --- |

## 已确认变更

| 日期 | 变更 | 影响范围 | 复核质量门 | 关联证据 |
| --- | --- | --- | --- | --- |

## 角色交接

| 角色 | 当前输出或范围 | 状态 | 证据或阻断项 | 下游 |
| --- | --- | --- | --- | --- |
""",
}

OPTIONAL_TEMPLATES = {
    "balance": (
        "balance.md",
        """# 数值设计

## 设计目标与玩家节奏

待数值设计角色补充。

## 参数与公式

| 参数 | 含义 | 默认值 | 来源 | 调整影响 | 验证方式 |
| --- | --- | --- | --- | --- | --- |

## 模拟与实测记录

待补充。
""",
    ),
    "assets": (
        "asset-license-register.md",
        """# 资源与授权登记

| 资源 | 类型 | 用途 | 来源 | 授权/生成记录 | 发布可用 | 优化状态 |
| --- | --- | --- | --- | --- | --- | --- |

## 替换计划

临时资源必须标注替换负责人和截止质量门。
""",
    ),
    "qa": (
        "qa-plan.md",
        """# 测试与性能计划

## 缺陷分级

- P0：无法启动、数据丢失、合规阻断或核心流程不可完成。
- P1：关键体验或目标渠道功能不可接受。
- P2：可绕过的功能或体验问题。
- P3：非阻断的优化项。

## 设备与性能矩阵

目标设备和指标待人工指定；未指定前不得判定性能达标。

| 渠道/设备 | 版本 | 测试项 | 帧率 | 启动时间 | 内存/包体 | 结果 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
""",
    ),
    "platform": (
        "platform-matrix.md",
        """# 平台矩阵

| 渠道 | 优先级 | 打包方式 | 必要适配 | 商店/平台资料 | 合规状态 | 负责人 |
| --- | --- | --- | --- | --- | --- | --- |
| 小游戏 | 首批 | 待评估 | 待评估 | 待评估 | 待评估 | 发布合规 |
| iOS | 首批 | Capacitor | 待评估 | 待评估 | 待评估 | 发布合规 |
| Google Play | 首批 | Capacitor | 待评估 | 待评估 | 待评估 | 发布合规 |
| 其他 | 扩展 | 待评估 | 待评估 | 待评估 | 待评估 | 发布合规 |
""",
    ),
    "release": (
        "release-checklist.md",
        """# 发布检查清单

## 发布候选版本

- 版本号：
- 构建提交：
- 构建命令：
- 候选包位置：

## 必须核验

- [ ] 人工已批准 G3。
- [ ] 每个目标渠道都有对应候选包和测试证据。
- [ ] 商店资料、隐私声明、分级和资源授权已核验。
- [ ] 没有密钥或商店凭据进入仓库。
- [ ] 已知风险、回滚或热修复方案已记录。
""",
    ),
    "worktree": (
        "worktree-plan.md",
        """# Worktree 收敛计划

仅将工作目录干净、已完成必要检查、没有与该分支相关的待人工决策且已更新控制面的分支标为待收敛。无关决策不得阻塞合并；总控将依此自动合并并清理本地 worktree 与分支。

| 批次 | 分支 | Worktree 目录 | 范围 | 检查证据 | 提交 | 状态 | 阻断原因 |
| --- | --- | --- | --- | --- | --- | --- |
""",
    ),
}


def parse_include_list(value: str) -> list[str]:
    """解析可选交付物名称，拒绝拼写错误以避免创建错误文档。"""
    names = [name.strip() for name in value.split(",") if name.strip()]
    unknown = sorted(set(names) - OPTIONAL_TEMPLATES.keys())
    if unknown:
        valid = "、".join(OPTIONAL_TEMPLATES)
        raise argparse.ArgumentTypeError(
            f"不支持的交付物：{'、'.join(unknown)}。可选值：{valid}。"
        )
    return list(dict.fromkeys(names))


def parse_args() -> argparse.Namespace:
    """解析显式项目目录、可选交付物与覆盖授权。"""
    parser = argparse.ArgumentParser(description="按阶段初始化 Phaser 4 游戏协作文档")
    parser.add_argument("--project-root", required=True, type=Path, help="目标游戏项目根目录")
    parser.add_argument(
        "--include",
        type=parse_include_list,
        help="逗号分隔的可选交付物：balance、assets、qa、platform、release、worktree",
    )
    parser.add_argument("--force", action="store_true", help="明确覆盖本次选择的同名文档")
    return parser.parse_args()


def validate_project_root(project_root: Path) -> Path:
    """拒绝文件系统根目录，降低误写入过宽目录的风险。"""
    resolved = project_root.resolve()
    if resolved == resolved.parent:
        raise ValueError("项目目录不能是文件系统根目录。")
    return resolved


def select_templates(include: list[str] | None) -> dict[str, str]:
    """默认选择核心交付物，指定 include 时只创建对应的阶段性交付物。"""
    if include is None:
        return CORE_TEMPLATES
    return {OPTIONAL_TEMPLATES[name][0]: OPTIONAL_TEMPLATES[name][1] for name in include}


def initialize_documents(
    project_root: Path, templates: dict[str, str], force: bool
) -> list[Path]:
    """仅创建或显式覆盖本次选择的交付物，避免影响其他阶段文档。"""
    docs_dir = project_root / "docs"
    targets = [docs_dir / filename for filename in templates]
    existing = [path for path in targets if path.exists()]
    if existing and not force:
        names = "、".join(path.name for path in existing)
        raise FileExistsError(f"拒绝覆盖已有文档：{names}。如确需覆盖，请显式传入 --force。")

    docs_dir.mkdir(parents=True, exist_ok=True)
    for path in targets:
        path.write_text(templates[path.name], encoding="utf-8")
    return targets


def main() -> int:
    """执行阶段初始化并输出可审计的写入结果。"""
    args = parse_args()
    try:
        project_root = validate_project_root(args.project_root)
        templates = select_templates(args.include)
        written = initialize_documents(project_root, templates, args.force)
    except (OSError, ValueError) as error:
        print(f"初始化失败：{error}", file=sys.stderr)
        return 1

    print("已初始化项目交接物：")
    for path in written:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
